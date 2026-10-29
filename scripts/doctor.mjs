import { spawnSync } from 'node:child_process';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { ROOT, goPath, environment } from './lib.mjs';

function capture(command, args) {
  const output = spawnSync(command, args, { cwd: ROOT, env: environment(), encoding: 'utf8', timeout: 120_000 });
  if (output.error || output.status !== 0) throw new Error(`${command}: ${output.error?.message ?? output.stderr}`);
  return output.stdout.trim();
}
const [major, minor, patch] = process.versions.node.split('.').map(Number);
assert(major >= 26 || major === 24 && minor >= 15 || major === 22 && (minor > 22 || minor === 22 && patch >= 2), 'Use Node 26 LTS, 24.15+, or 22.22.2+ (Node 25 is unsupported by test dependencies).');
const packages = {};
for (const name of ['@anna-ai/cli', '@anna-ai/app-runtime', '@anna-ai/app-schema']) packages[name] = JSON.parse(readFileSync(resolve(ROOT, 'node_modules', name, 'package.json'), 'utf8')).version;
assert.equal(packages['@anna-ai/cli'], '0.1.61');
const sdk = readFileSync(resolve(ROOT, 'node_modules/@anna-ai/app-runtime/dist/index.js'));
const pythonVersions = JSON.parse(capture(process.platform === 'win32' ? 'uvx.exe' : 'uvx', ['--from', 'anna-app-runtime-local@0.2.0a30', 'python', '-c', 'import json,importlib.metadata as m;print(json.dumps({"runtime-local":m.version("anna-app-runtime-local"),"core":m.version("anna-app-core")}))']));
assert.equal(pythonVersions.core, '0.26.1');
const evidence = { generatedAt: new Date().toISOString(), node: process.version, go: capture(goPath(), ['version']), uv: capture('uv', ['--version']), packages, pythonVersions, sdkSha256: createHash('sha256').update(sdk).digest('hex'), requiresAnnaLogin: false };
mkdirSync(resolve(ROOT, 'evidence'), { recursive: true });
writeFileSync(resolve(ROOT, 'evidence/environment.json'), JSON.stringify(evidence, null, 2));
console.log(JSON.stringify(evidence, null, 2));
