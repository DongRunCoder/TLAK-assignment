import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ROOT } from './lib.mjs';
import { readdir } from 'node:fs/promises';
import { assertSecurityContracts, parseContractJson } from './security-contracts.mjs';
const json = async file => parseContractJson(await readFile(resolve(ROOT, file), 'utf8'));
const app = await json('manifest.json'), executa = await json('executas/mini-notes-summarizer/manifest.json'), launcher = await json('executas/mini-notes-summarizer/executa.json'), pkg = await json('package.json');
const result = assertSecurityContracts({ app, executa, launcher, pkg });
async function files(directory) {
  const entries = await readdir(resolve(ROOT, directory), { withFileTypes: true });
  return (await Promise.all(entries.map(entry => entry.isDirectory() ? files(`${directory}/${entry.name}`) : [`${directory}/${entry.name}`]))).flat();
}
for (const path of await files('src')) {
  if (!/\.(ts|tsx)$/.test(path)) continue;
  const source = await readFile(resolve(ROOT, path), 'utf8');
  assert(!/\b(?:localStorage|indexedDB)\b|\.llm\s*\.\s*complete\s*\(|\bfetch\s*\(/.test(source), `Forbidden data/summary bypass in ${path}`);
}
await mkdir(resolve(ROOT, 'evidence'), { recursive: true });
await writeFile(resolve(ROOT, 'evidence/contracts.json'), JSON.stringify(result, null, 2));
console.log('App/Executa identities, parameters, permissions, and entry contracts: PASS');
