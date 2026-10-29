import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ROOT } from './lib.mjs';
import { readdir } from 'node:fs/promises';
const json = async file => JSON.parse(await readFile(resolve(ROOT, file), 'utf8'));
const app = await json('manifest.json'), executa = await json('executas/mini-notes-summarizer/manifest.json'), launcher = await json('executas/mini-notes-summarizer/executa.json'), pkg = await json('package.json');
const id = executa.name;
assert.equal(app.schema, 2);
assert.equal(app.required_executas[0].tool_id, id); assert.equal(launcher.tool_id, id);
assert(app.ui.host_api.tools.includes(`required:${id}`));
assert.deepEqual(app.ui.host_api.storage, ['get', 'set']);
assert.equal(app.ui.bundle.entry, 'index.html');
assert.equal(executa.version, pkg.version);
assert(executa.host_capabilities.includes('llm.sample'));
assert.equal(executa.tools[0].name, 'summarize');
assert(Array.isArray(executa.tools[0].parameters));
assert.equal(app.dev.mocks, undefined);
async function files(directory) {
  const entries = await readdir(resolve(ROOT, directory), { withFileTypes: true });
  return (await Promise.all(entries.map(entry => entry.isDirectory() ? files(`${directory}/${entry.name}`) : [`${directory}/${entry.name}`]))).flat();
}
for (const path of await files('src')) {
  if (!/\.(ts|tsx)$/.test(path)) continue;
  const source = await readFile(resolve(ROOT, path), 'utf8');
  assert(!/\b(?:localStorage|indexedDB)\b|\.llm\s*\.\s*complete\s*\(|\bfetch\s*\(/.test(source), `Forbidden data/summary bypass in ${path}`);
}
const result = { passed: true, toolId: id, version: pkg.version, schema: app.schema, bundleEntry: 'bundle/index.html', samplingCapability: true, localSamplingAclCompatibility: app.ui.host_api.llm?.includes('complete') ?? false };
await mkdir(resolve(ROOT, 'evidence'), { recursive: true });
await writeFile(resolve(ROOT, 'evidence/contracts.json'), JSON.stringify(result, null, 2));
console.log('App/Executa identities, parameters, permissions, and entry contracts: PASS');
