import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import * as preview from '../../scripts/preview.mjs';

const launcher = fileURLToPath(new URL('../../scripts/dev-real.mjs', import.meta.url));
const account = 'https://anna.partners';
const secret = 'DO_NOT_ECHO_PRIVATE_ACCOUNT_DETAILS';
const listen = async () => {
  const server = net.createServer(socket => { socket.on('error', () => {}); socket.end(); });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return server;
};
const availablePort = async () => {
  const server = await listen();
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
};

// Every real-entry invocation gets a private, empty or expired account store.
// Never inherit the developer's Anna account, even for help or invalid args.
async function runEntry(args, credentials) {
  const config = await mkdtemp(join(tmpdir(), 'mini-notes-real-test-'));
  if (credentials !== undefined) {
    await mkdir(join(config, 'anna'));
    await writeFile(join(config, 'anna', 'credentials.json'), typeof credentials === 'string' ? credentials : JSON.stringify(credentials));
  }
  const child = spawn(process.execPath, [launcher, ...args], {
    env: { ...process.env, XDG_CONFIG_HOME: config }, stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
  });
  let output = '';
  child.stdout.on('data', data => { output += data; });
  child.stderr.on('data', data => { output += data; });
  const timer = setTimeout(() => { void preview.stopChildTree(child); }, 12_000);
  try {
    const [code] = await once(child, 'exit');
    assert.doesNotMatch(output, new RegExp(secret));
    assert.doesNotMatch(output, /Building Mini Notes|pat_preview|user_id|credentials\.json|\/dev\/apps\/register/i);
    return { code, output };
  } finally {
    clearTimeout(timer);
    await preview.stopChildTree(child);
    await rm(config, { recursive: true, force: true });
  }
}

test('real options are explicit and leave the original off shape intact', () => {
  assert.deepEqual(preview.parsePreviewOptions([]), { port: 5198, hostPort: undefined, help: false });
  assert.deepEqual(preview.parsePreviewOptions([], 'real'), {
    port: 5218, hostPort: undefined, help: false, account, appSlug: 'mini-notes-tlak-real',
  });
  assert.deepEqual(preview.parsePreviewOptions(['--port', '5300', '--host-port', '5301', '--llm-account', 'http://127.0.0.1:9000', '--llm-app-slug', 'notes-2'], 'real'), {
    port: 5300, hostPort: 5301, help: false, account: 'http://127.0.0.1:9000', appSlug: 'notes-2',
  });
  assert.throws(() => preview.parsePreviewOptions([], 'mock'), /mode/i);
  assert.throws(() => preview.parsePreviewOptions(['--llm-account', account]), /option/i);
});

test('real options reject credentials, non-origin URLs, unsafe slugs and port misuse', () => {
  for (const value of [
    'https://user:password@anna.partners', 'https://anna.partners?pat=secret', 'https://anna.partners?',
    'https://anna.partners#secret', 'https://anna.partners#', 'https://anna.partners/path',
    'https://anna.partners/a/..', 'https://anna.partners\\path', 'https://@anna.partners',
    'http://anna.partners', 'ftp://anna.partners', 'anna.partners', ' https://anna.partners', '',
  ]) assert.throws(() => preview.parsePreviewOptions(['--llm-account', value], 'real'), /account/i, value);
  for (const value of ['', 'Upper', '-notes', 'notes-', 'a/b', 'x'.repeat(64), 'notes_1']) {
    assert.throws(() => preview.parsePreviewOptions(['--llm-app-slug', value], 'real'), /slug/i, value);
  }
  for (const args of [
    ['--port', '0'], ['--host-port', '65536'], ['--port', '-1'], ['--port', 'NaN'],
    ['--port', '5218', '--host-port', '5218'], ['--llm', 'real'], ['--mock-llm', 'fixture'],
    ['--api-key', secret], ['--pat', secret], ['--llm-account'], ['--llm-app-slug'],
  ]) assert.throws(() => preview.parsePreviewOptions(args, 'real'), /port|option|account|slug/i);
});

test('the pure Host builder preserves off flags and makes real mode use one isolated build', () => {
  assert.equal(typeof preview.buildPreviewHostArgs, 'function');
  assert.deepEqual(preview.buildPreviewHostArgs({ port: 5301 }), [
    'dev', '--no-llm', '--storage', 'legacy', '--bundle', './bundle', '--port', '5301',
  ]);
  const args = preview.buildPreviewHostArgs({ llm: 'real', port: 5301, bundle: '.tools/real-preview-unique/bundle', account, appSlug: 'notes' });
  assert.deepEqual(args, ['dev', '--storage', 'legacy', '--bundle', '.tools/real-preview-unique/bundle', '--port', '5301', '--no-watch', '--llm-account', account, '--llm-app-slug', 'notes']);
  assert.doesNotMatch(args.join(' '), /--no-llm|--mock-llm|--llm real|api-key|--pat/);
  assert.throws(() => preview.buildPreviewHostArgs({ llm: 'real', port: 5301, bundle: './bundle', account, appSlug: 'notes' }), /bundle/i);
});

test('local whoami metadata is projected without retaining private fields', () => {
  assert.equal(typeof preview.parseRealAccountMetadata, 'function');
  const json = JSON.stringify({ current: 'https://other.invalid', accounts: [
    { host: 'https://other.invalid', expires_at: 1, pat_preview: secret },
    { host: account, expires_at: 200, pat_preview: secret, user_id: secret, scopes: secret },
  ] });
  assert.deepEqual(preview.parseRealAccountMetadata(json, account, 100_000), { host: account, expires_at: 200 });
  for (const bad of [secret, '{}', '{"accounts":{}}', '{"accounts":[null]}']) {
    assert.throws(() => preview.parseRealAccountMetadata(bad, account, 100_000), error => /account|metadata/i.test(error.message) && !error.message.includes(secret));
  }
  for (const accounts of [[], [{ host: 'https://other.invalid', expires_at: 200 }]]) {
    assert.throws(() => preview.parseRealAccountMetadata(JSON.stringify({ accounts }), account, 100_000), /not logged in|login/i);
  }
  assert.throws(() => preview.parseRealAccountMetadata(JSON.stringify({ accounts: [{ host: account, expires_at: 100 }] }), account, 100_000), /expired/i);
  for (const expiry of [null, '200', -1, Number.MAX_VALUE]) {
    assert.throws(() => preview.parseRealAccountMetadata(JSON.stringify({ accounts: [{ host: account, expires_at: expiry }] }), account, 100_000), /metadata|expired/i);
  }
});

test('Host startup diagnostics classify fixed guidance and discard raw chunks after readiness', () => {
  assert.equal(typeof preview.createRealStartupDiagnostics, 'function');
  for (const [input, expected] of [
    [`${secret} developer handle required`, /developer handle/i],
    [`${secret} HTTP 403 Verified developer required`, /developer access/i],
    [`${secret} HTTP 401`, /401\/403/], [`${secret} HTTP 403`, /401\/403/],
    [`${secret} fetch failed ECONNREFUSED`, /network|proxy/i],
    [`${secret} PAT expired`, /expired/i], [`${secret} no developer PAT on disk`, /login|not logged in/i],
    [secret, /could not start/i],
  ]) {
    const diagnostics = preview.createRealStartupDiagnostics();
    for (let i = 0; i < input.length; i += 5) diagnostics.consume(Buffer.from(input.slice(i, i + 5)));
    assert.match(diagnostics.message(), expected);
    assert.doesNotMatch(diagnostics.message(), new RegExp(secret));
    diagnostics.clear();
    diagnostics.consume(Buffer.from('HTTP 401'));
    assert.match(diagnostics.message(), /could not start/i);
  }
});

test('an early Host failure is classified and its stdin-owned bridge exits after parent EOF', async () => {
  assert.equal(typeof preview.waitForPreviewHost, 'function');
  const port = await availablePort();
  // The official PythonBridge pipes stdin; runtime 0.2.0a30 exits on EOF.
  // This fixture follows that lifecycle and proves the grandchild is gone.
  const bridge = "process.stdin.resume();process.stdin.once('end',()=>process.exit(0));process.send({pid:process.pid});setTimeout(()=>process.exit(9),15000);";
  const host = `const bridge=require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(bridge)}],{stdio:['pipe','ignore','ignore','ipc']});bridge.once('message',message=>process.send(message));process.once('message',()=>{process.stderr.write(${JSON.stringify(secret + ' developer handle required')});process.exit(1)});`;
  const child = spawn(process.execPath, ['-e', host], {
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'], detached: process.platform !== 'win32',
  });
  const diagnostics = preview.createRealStartupDiagnostics();
  let timer, bridgePid;
  const alive = pid => {
    try { process.kill(pid, 0); return true; }
    catch (error) { if (error.code === 'ESRCH') return false; throw error; }
  };
  try {
    const [message] = await once(child, 'message');
    bridgePid = message.pid;
    assert.equal(alive(bridgePid), true);
    const readiness = preview.waitForPreviewHost(port, child, () => false, diagnostics);
    child.send('fail');
    await assert.rejects(Promise.race([
      readiness,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Host exit was not observed promptly')), 2000); }),
    ]), error => /developer handle/.test(error.message) && !error.message.includes(secret));
    assert.equal(child.exitCode, 1);
    const deadline = Date.now() + 2000;
    while (alive(bridgePid) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25));
    assert.equal(alive(bridgePid), false, 'bridge must exit after its Host closes stdin');
  } finally {
    clearTimeout(timer);
    diagnostics.clear();
    await preview.stopChildTree(child);
    if (bridgePid && alive(bridgePid)) process.kill(bridgePid);
  }
});

test('real help is offline and does not build even with malformed private credentials', async () => {
  const result = await runEntry(['--help'], secret);
  assert.equal(result.code, 0);
  assert.match(result.output, /dev:real/);
  assert.match(result.output, /--llm-account/);
  assert.match(result.output, /--llm-app-slug/);
  assert.match(result.output, /5218/);
});

test('real entry rejects unsupported options without echoing their values', async () => {
  const result = await runEntry(['--pat', secret]);
  assert.equal(result.code, 1);
  assert.match(result.output, /Invalid real preview options/);
});

test('real entry stops before building for missing, malformed or expired local accounts', async () => {
  for (const credentials of [undefined, secret, {
    version: 1, current: account, accounts: { [account]: { host: account, pat: secret, expires_at: 1 } },
  }]) {
    const result = await runEntry(['--port', String(await availablePort())], credentials);
    assert.equal(result.code, 1);
    assert.match(result.output, credentials && typeof credentials === 'object' ? /expired/i : /not logged in|login/i);
  }
});

test('real entry protects occupied public and Host ports before account lookup', async () => {
  const existing = await listen();
  try {
    const result = await runEntry(['--port', String(existing.address().port)]);
    assert.equal(result.code, 1);
    assert.match(result.output, /Preview port unavailable/);
    const resultHost = await runEntry(['--port', String(await availablePort()), '--host-port', String(existing.address().port)]);
    assert.equal(resultHost.code, 1);
    assert.match(resultHost.output, /Official Host port unavailable/);
    assert.equal(existing.listening, true);
  } finally { await new Promise(resolve => existing.close(resolve)); }
});
