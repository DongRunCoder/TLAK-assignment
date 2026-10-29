import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { ROOT, environment, annaCommand, run } from './lib.mjs';

await run(process.execPath, [resolve(ROOT, 'node_modules/typescript/bin/tsc'), '--noEmit']);
await run(process.execPath, [resolve(ROOT, 'node_modules/vite/bin/vite.js'), 'build']);
const [anna, args] = annaCommand(['dev', '--no-llm', '--storage', 'legacy', '--bundle', './bundle']);
const children = [
  spawn(process.execPath, [resolve(ROOT, 'node_modules/vite/bin/vite.js'), 'build', '--watch'], { cwd: ROOT, env: environment(), stdio: 'inherit' }),
  spawn(anna, args, { cwd: ROOT, env: environment(), stdio: 'inherit' }),
];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill('SIGTERM');
  process.exitCode = code;
}
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
for (const child of children) {
  child.on('error', error => { console.error(error.message); stop(1); });
  child.on('exit', code => stop(code ?? 1));
}
