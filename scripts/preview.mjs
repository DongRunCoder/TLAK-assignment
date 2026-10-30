import { spawn } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import { mkdtemp } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, annaCommand, environment } from './lib.mjs';
import { startResponsivePreview } from './responsive-preview.mjs';
import { REAL_DEFAULT_ACCOUNT, REAL_DEFAULT_APP_SLUG, REAL_STARTUP_MESSAGES, validateRealAccount, validateRealAppSlug, buildPreviewHostArgs, parseRealAccountMetadata, createRealStartupDiagnostics } from './real-mode.mjs';
export { buildPreviewHostArgs, parseRealAccountMetadata, createRealStartupDiagnostics } from './real-mode.mjs';

export function parsePreviewOptions(argv, llm = 'off') {
  if (!['off', 'real'].includes(llm)) throw new Error('Unsupported preview LLM mode.');
  const options = { port: llm === 'real' ? 5218 : 5198, hostPort: undefined, help: false };
  if (llm === 'real') Object.assign(options, { account: REAL_DEFAULT_ACCOUNT, appSlug: REAL_DEFAULT_APP_SLUG });
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--help' || flag === '-h') { options.help = true; continue; }
    if (llm === 'real' && flag === '--llm-account') { options.account = validateRealAccount(argv[++i]); continue; }
    if (llm === 'real' && flag === '--llm-app-slug') { options.appSlug = validateRealAppSlug(argv[++i]); continue; }
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

export async function waitForPreviewHost(port, child, isStopping, diagnostics) {
  // Register before polling: exit and close can both occur during the delay.
  // Waiting for a new close listener after exit would miss an already-fired event.
  const closed = new Promise(resolveClose => child.once('close', resolveClose));
  if (diagnostics) {
    child.stdout.on('data', chunk => diagnostics.consume(chunk));
    child.stderr.on('data', chunk => diagnostics.consume(chunk));
  }
  try {
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
  } catch (error) {
    if (diagnostics) {
      if (child.exitCode !== null || child.signalCode !== null) await closed;
      throw new Error(diagnostics.message());
    }
    throw error;
  }
}

export async function runPreview(argv = process.argv.slice(2), { llm = 'off' } = {}) {
  const { port, hostPort, help, account, appSlug } = parsePreviewOptions(argv, llm);
  const real = llm === 'real';
  if (help) {
    console.log(real
      ? `Usage: npm run dev:real -- [--port 5218] [--host-port <port>] [--llm-account <origin>] [--llm-app-slug <slug>]\nDefaults: ${REAL_DEFAULT_ACCOUNT}, ${REAL_DEFAULT_APP_SLUG}.\nUses the official saved Anna account; builds once in an isolated directory. No model request is sent automatically.`
      : 'Usage: npm run dev:preview -- [--port 5198] [--host-port 5199]\nThe official Anna Host uses an available internal port by default.');
    return;
  }
  const children = new Set();
  const reservations = new Set();
  const failedChildren = new WeakSet();
  const diagnostics = real ? createRealStartupDiagnostics() : undefined;
  let hostReady = false;
  let preview, stopping = false, stopPromise;
  const stop = (code = 0) => {
    if (stopPromise) return stopPromise;
    stopping = true;
    diagnostics?.clear();
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
  function ownedChild(command, args, persistent = false, capture = false) {
    const child = spawn(command, args, { cwd: ROOT, env: environment(), stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'ignore', windowsHide: true, detached: process.platform !== 'win32' });
    children.add(child);
    child.on('error', () => {
      failedChildren.add(child);
      if (persistent && !stopping && (!real || hostReady)) { console.error(real ? REAL_STARTUP_MESSAGES.startup : 'Preview process unavailable.'); void stop(1); }
    });
    child.on('exit', () => {
      children.delete(child);
      if (persistent && !stopping && (!real || hostReady)) { console.error(real ? REAL_STARTUP_MESSAGES.startup : 'Preview process stopped.'); void stop(1); }
    });
    return child;
  }
  async function preflightAccount() {
    const [command, args] = annaCommand(['whoami', '--json']);
    const child = ownedChild(command, args, false, true);
    let output = '', size = 0;
    let timer;
    try {
      await new Promise((resolveAccount, reject) => {
        const fail = () => reject(new Error(REAL_STARTUP_MESSAGES.metadata));
        timer = setTimeout(() => { fail(); void stopChildTree(child); }, 5000);
        child.stdout.on('data', chunk => {
          size += chunk.length;
          if (size > 1024 * 1024) { fail(); void stopChildTree(child); }
          else output += chunk.toString('utf8');
        });
        // Official error output may contain credential fragments; drain only.
        child.stderr.resume();
        child.once('error', fail);
        child.once('close', code => code === 0 && !stopping ? resolveAccount() : fail());
      });
      parseRealAccountMetadata(output, account);
    } finally { clearTimeout(timer); output = ''; }
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
    if (real) await preflightAccount();
    if (stopping) return;
    const bundle = real ? resolve(await mkdtemp(resolve(ROOT, '.tools/real-preview-')), 'bundle') : './bundle';
    if (stopping) return;
    console.log('Building Mini Notes for the official Anna Harness…');
    await build([resolve(ROOT, 'node_modules/typescript/bin/tsc'), '--noEmit']);
    await build([resolve(ROOT, 'node_modules/vite/bin/vite.js'), 'build', ...(real ? ['--outDir', bundle] : [])]);
    if (stopping) return;
    await release(hostReservation);
    reservations.delete(hostReservation);
    if (stopping) return;
    const [command, args] = annaCommand(buildPreviewHostArgs({ llm, port: internalPort, bundle, account, appSlug }));
    const host = ownedChild(command, args, true, real);
    await waitForPreviewHost(internalPort, host, () => stopping || failedChildren.has(host), diagnostics);
    hostReady = true;
    diagnostics?.clear();
    if (stopping) return;
    await release(publicReservation);
    reservations.delete(publicReservation);
    if (stopping) return;
    preview = await startResponsivePreview({ hostPort: internalPort, port });
    if (stopping) { await preview.close(); return; }
    if (!real) ownedChild(process.execPath, [resolve(ROOT, 'node_modules/vite/bin/vite.js'), 'build', '--watch'], true);
    console.log(`Mini Notes responsive preview: http://localhost:${port}/`);
    console.log(real ? 'Official Anna Host connected; real LLM enabled; legacy storage. Model requests may use account quota. Press Ctrl+C to stop.' : 'Official Anna Host connected; LLM disabled; legacy storage. Press Ctrl+C to stop.');
    return { preview, stop };
  } catch (error) {
    if (!stopping) {
      const safe = [...Object.values(REAL_STARTUP_MESSAGES), 'Preview port unavailable; choose another --port.', 'Official Host port unavailable; choose another --host-port.', 'Preview build could not start.', 'Preview build failed; run npm run build for diagnostics.'].includes(error.message);
      const offMessage = error.message.startsWith('Preview') || error.message.startsWith('Official') ? error.message : 'Preview could not start.';
      console.error(real ? (safe ? error.message : REAL_STARTUP_MESSAGES.startup) : offMessage);
    }
    await stop(stopping ? process.exitCode ?? 0 : 1);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await runPreview(); }
  catch { console.error('Invalid preview options. Run npm run dev:preview -- --help.'); process.exitCode = 1; }
}
