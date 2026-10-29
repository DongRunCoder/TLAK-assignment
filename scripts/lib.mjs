import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export function environment() {
  mkdirSync(resolve(ROOT, '.tools'), { recursive: true });
  return {
    ...process.env,
    PATH: `${resolve(ROOT, '.tools/go/bin')}${process.platform === 'win32' ? ';' : ':'}${process.env.PATH ?? ''}`,
    GOCACHE: resolve(ROOT, '.tools/go-cache'), GOPATH: resolve(ROOT, '.tools/gopath'), GOTOOLCHAIN: 'local',
    UV_CACHE_DIR: resolve(ROOT, '.tools/uv-cache'), UV_TOOL_DIR: resolve(ROOT, '.tools/uv-tools'),
    UV_PYTHON_INSTALL_DIR: resolve(ROOT, '.tools/uv-python'), UV_CONSTRAINT: resolve(ROOT, 'python-constraints.txt'),
    PYTHONUTF8: '1',
  };
}
export function goPath() {
  const local = resolve(ROOT, '.tools/go/bin', process.platform === 'win32' ? 'go.exe' : 'go');
  return existsSync(local) ? local : 'go';
}
export function annaCommand(args) {
  const pkgDir = resolve(ROOT, 'node_modules/@anna-ai/cli');
  const pkg = JSON.parse(readFileSync(resolve(pkgDir, 'package.json'), 'utf8'));
  const entry = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin['anna-app'];
  return [process.execPath, [resolve(pkgDir, entry), ...args]];
}
export function run(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd: ROOT, env: environment(), stdio: 'inherit', ...options });
    child.on('error', reject);
    child.on('exit', (code, signal) => code === 0 ? resolvePromise() : reject(new Error(`${command} exited ${code ?? signal}`)));
  });
}
