import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { ROOT, environment, annaCommand, run } from './lib.mjs';

const port = 5197;
const url = `http://127.0.0.1:${port}/`;
const [command, args] = annaCommand(['dev', '--no-llm', '--storage', 'legacy', '--bundle', './bundle', '--port', String(port), '--no-watch']);
const child = spawn(command, args, { cwd: ROOT, env: environment(), stdio: ['ignore', 'pipe', 'pipe'] });
let log = '';
child.stdout.on('data', chunk => { log += chunk.toString(); });
child.stderr.on('data', chunk => { log += chunk.toString(); });
const closed = new Promise(resolveExit => child.once('exit', resolveExit));
try {
  await new Promise((ready, reject) => {
    const timer = setTimeout(() => reject(new Error(`Anna harness did not start: ${log}`)), 30_000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`Anna harness exited ${code}: ${log}`)); });
    child.stdout.on('data', () => { if (log.includes(`:${port}/`)) { clearTimeout(timer); ready(); } });
  });
  await run(process.execPath, [resolve(ROOT, 'scripts/test-harness.mjs')], { env: { ...environment(), HARNESS_URL: url } });
} finally {
  // Only terminate the process tree created by this script.
  if (process.platform === 'win32' && child.exitCode === null) {
    await new Promise(resolveStop => {
      const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      killer.once('error', resolveStop); killer.once('exit', resolveStop);
    });
  } else child.kill('SIGTERM');
  await Promise.race([closed, new Promise(resolveExit => setTimeout(resolveExit, 3_000))]);
  await writeFile(resolve(ROOT, 'evidence/ui-harness-server.log'), log.replace(/t=[A-Za-z0-9_.-]+/g, 't=[redacted]'));
}
