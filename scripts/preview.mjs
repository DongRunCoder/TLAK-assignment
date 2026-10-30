import { spawn } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, annaCommand, environment } from './lib.mjs';
import { startResponsivePreview } from './responsive-preview.mjs';

export function parsePreviewOptions(argv) {
  const options = { port: 5198, hostPort: undefined, help: false };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--help' || flag === '-h') { options.help = true; continue; }
    if (flag !== '--port' && flag !== '--host-port') throw new Error('Unsupported preview option.');
    const value = argv[++i];
    if (!/^\d+$/.test(value ?? '') || Number(value) < 1 || Number(value) > 65535) throw new Error('Invalid preview port.');
    options[flag === '--port' ? 'port' : 'hostPort'] = Number(value);
  }
  if (options.port === options.hostPort) throw new Error('Preview and Host ports must differ.');
  return options;
}

// Only children created in this launcher are supplied here. On Windows the
// Anna Host may own executa descendants, so terminate that exact PID tree.
export async function stopChildTree(child) {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise(resolveExit => child.once('exit', resolveExit));
  if (process.platform === 'win32') {
    await new Promise(resolveKill => {
      const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
      killer.once('error', () => { child.kill(); resolveKill(); });
      killer.once('exit', resolveKill);
    });
  } else {
    try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill('SIGTERM'); }
  }
  if (child.exitCode === null && child.signalCode === null) {
    let timer;
    await Promise.race([exited, new Promise(resolveTimeout => { timer = setTimeout(resolveTimeout, 3000); })]);
    clearTimeout(timer);
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  }
}

function reservePort(port, message) {
  return new Promise((resolvePort, reject) => {
    const server = net.createServer();
    server.once('error', () => reject(new Error(message)));
    server.listen(port, '127.0.0.1', () => resolvePort(server));
  });
}
const release = server => new Promise(resolveClose => server.close(resolveClose));

async function waitForHost(port, child, isStopping) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (isStopping() || child.exitCode !== null || child.signalCode !== null) throw new Error('Official Anna Host stopped during startup.');
    const ready = await new Promise(resolveReady => {
      const req = http.get({ hostname: '127.0.0.1', port, path: '/', agent: false }, res => {
        res.resume();
        resolveReady(res.statusCode === 200);
      });
      req.setTimeout(500, () => req.destroy());
      req.once('error', () => resolveReady(false));
    });
    if (ready) return;
    await new Promise(resolveDelay => setTimeout(resolveDelay, 150));
  }
  throw new Error('Official Anna Host startup timed out.');
}

export async function runPreview(argv = process.argv.slice(2)) {
  const { port, hostPort, help } = parsePreviewOptions(argv);
  if (help) {
    console.log('Usage: npm run dev:preview -- [--port 5198] [--host-port 5199]\nThe official Anna Host uses an available internal port by default.');
    return;
  }
  const children = new Set();
  const reservations = new Set();
  let preview, stopping = false, stopPromise;
  const stop = (code = 0) => {
    if (stopPromise) return stopPromise;
    stopping = true;
    process.exitCode = code;
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
    stopPromise = (async () => {
      await Promise.allSettled([...reservations].map(release));
      await preview?.close();
      await Promise.allSettled([...children].map(stopChildTree));
    })();
    return stopPromise;
  };
  const onSignal = () => { void stop(); };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  async function reserveOwned(portNumber, message) {
    const reservation = await reservePort(portNumber, message);
    if (stopping) { await release(reservation); return; }
    reservations.add(reservation);
    return reservation;
  }
  function ownedChild(command, args, persistent = false) {
    const child = spawn(command, args, { cwd: ROOT, env: environment(), stdio: 'ignore', windowsHide: true, detached: process.platform !== 'win32' });
    children.add(child);
    child.on('error', () => {
      if (persistent && !stopping) { console.error('Preview process unavailable.'); void stop(1); }
    });
    child.on('exit', () => {
      children.delete(child);
      if (persistent && !stopping) { console.error('Preview process stopped.'); void stop(1); }
    });
    return child;
  }
  async function build(args) {
    if (stopping) throw new Error('Preview startup stopped.');
    const child = ownedChild(process.execPath, args);
    await new Promise((resolveBuild, reject) => {
      child.once('error', () => reject(new Error('Preview build could not start.')));
      child.once('exit', code => code === 0 && !stopping ? resolveBuild() : reject(new Error('Preview build failed; run npm run build for diagnostics.')));
    });
  }
  try {
    const publicReservation = await reserveOwned(port, 'Preview port unavailable; choose another --port.');
    if (!publicReservation) return;
    const hostReservation = await reserveOwned(hostPort ?? 0, 'Official Host port unavailable; choose another --host-port.');
    if (!hostReservation) return;
    const internalPort = hostReservation.address().port;
    console.log('Building Mini Notes for the official Anna Harness…');
    await build([resolve(ROOT, 'node_modules/typescript/bin/tsc'), '--noEmit']);
    await build([resolve(ROOT, 'node_modules/vite/bin/vite.js'), 'build']);
    if (stopping) return;
    await release(hostReservation);
    reservations.delete(hostReservation);
    if (stopping) return;
    const [command, args] = annaCommand(['dev', '--no-llm', '--storage', 'legacy', '--bundle', './bundle', '--port', String(internalPort)]);
    const host = ownedChild(command, args, true);
    await waitForHost(internalPort, host, () => stopping);
    if (stopping) return;
    await release(publicReservation);
    reservations.delete(publicReservation);
    if (stopping) return;
    preview = await startResponsivePreview({ hostPort: internalPort, port });
    if (stopping) { await preview.close(); return; }
    ownedChild(process.execPath, [resolve(ROOT, 'node_modules/vite/bin/vite.js'), 'build', '--watch'], true);
    console.log(`Mini Notes responsive preview: http://localhost:${port}/`);
    console.log('Official Anna Host connected; LLM disabled; legacy storage. Press Ctrl+C to stop.');
    return { preview, stop };
  } catch (error) {
    if (!stopping) console.error(error.message.startsWith('Preview') || error.message.startsWith('Official') ? error.message : 'Preview could not start.');
    await stop(stopping ? process.exitCode ?? 0 : 1);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await runPreview(); }
  catch { console.error('Invalid preview options. Run npm run dev:preview -- --help.'); process.exitCode = 1; }
}
