import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import net from 'node:net';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { parsePreviewOptions, stopChildTree } from '../../scripts/preview.mjs';

const launcher = fileURLToPath(new URL('../../scripts/preview.mjs', import.meta.url));
const listen = async () => {
  const server = net.createServer(socket => { socket.on('error', () => {}); socket.end('untouched'); });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return server;
};
const probe = port => new Promise(resolve => {
  const socket = net.createConnection({ host: '127.0.0.1', port });
  socket.once('connect', () => { socket.destroy(); resolve(true); });
  socket.once('error', () => resolve(false));
});

test('launcher defaults to the public preview port and accepts only explicit numeric ports', () => {
  assert.deepEqual(parsePreviewOptions([]), { port: 5198, hostPort: undefined, help: false });
  assert.deepEqual(parsePreviewOptions(['--port', '5298', '--host-port', '5299']), { port: 5298, hostPort: 5299, help: false });
  assert.equal(parsePreviewOptions(['--help']).help, true);
  for (const args of [['--port'], ['--host-port', '0'], ['--port', 'abc'], ['--port', '65536'], ['--port', '5198', '--host-port', '5198'], ['--upstream', 'http://example.invalid'], ['--host', '0.0.0.0']]) {
    assert.throws(() => parsePreviewOptions(args), /port|option/i);
  }
});

test('an occupied preview port exits safely without stopping the existing listener', async () => {
  const existing = await listen();
  const port = existing.address().port;
  const child = spawn(process.execPath, [launcher, '--port', String(port)], { stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', data => { output += data; });
  child.stderr.on('data', data => { output += data; });
  try {
    const [code] = await once(child, 'exit');
    assert.equal(code, 1);
    assert.match(output, /Preview port unavailable/);
    assert.doesNotMatch(output, /token|session_id|EADDRINUSE|127\.0\.0\.1/i);
    assert.equal(await probe(port), true);
  } finally {
    if (child.exitCode === null) await stopChildTree(child);
    await new Promise(resolve => existing.close(resolve));
  }
});

test('an occupied explicit Host port exits without touching either existing listener', async () => {
  const existing = await listen();
  const available = await listen();
  const port = available.address().port;
  await new Promise(resolve => available.close(resolve));
  const child = spawn(process.execPath, [launcher, '--port', String(port), '--host-port', String(existing.address().port)], { stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', data => { output += data; });
  child.stderr.on('data', data => { output += data; });
  try {
    const [code] = await once(child, 'exit');
    assert.equal(code, 1);
    assert.match(output, /Official Host port unavailable/);
    assert.equal(await probe(existing.address().port), true);
    assert.equal(await probe(port), false);
  } finally {
    if (child.exitCode === null) await stopChildTree(child);
    await new Promise(resolve => existing.close(resolve));
  }
});

test('cleanup stops only the spawned process tree and preserves an unrelated listener', async () => {
  const existing = await listen();
  const nestedScript = "const n=require('node:net').createServer(s=>s.end());n.listen(0,'127.0.0.1',()=>process.send(n.address().port));setTimeout(()=>process.exit(),15000);";
  const parentScript = `const c=require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(nestedScript)}],{stdio:['ignore','ignore','ignore','ipc']});c.on('message',port=>process.send({port}));setTimeout(()=>process.exit(),15000);`;
  const child = spawn(process.execPath, ['-e', parentScript], { detached: process.platform !== 'win32', stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
  try {
    const [message] = await once(child, 'message');
    assert.equal(await probe(message.port), true);
    await stopChildTree(child);
    assert.equal(await probe(message.port), false);
    assert.equal(await probe(existing.address().port), true);
  } finally {
    await stopChildTree(child);
    await new Promise(resolve => existing.close(resolve));
  }
});

test('a stop during initial port reservation releases the listener before exiting', async () => {
  const reservation = await listen();
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const moduleUrl = new URL('../../scripts/preview.mjs', import.meta.url).href;
  const source = `import {runPreview} from ${JSON.stringify(moduleUrl)};setTimeout(()=>process.exit(2),1500).unref();const pending=runPreview(['--port',${JSON.stringify(String(port))}]);process.emit('SIGTERM');await pending;`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', source], { stdio: 'ignore' });
  try {
    const [code] = await once(child, 'exit');
    assert.equal(code, 0);
    assert.equal(await probe(port), false);
  } finally { if (child.exitCode === null) await stopChildTree(child); }
});
