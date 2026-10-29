// Keep validation independent of the filesystem so rejected manifests can be
// tested without changing the real App, starting a Host, or writing evidence.
const TOOL_ID = 'mini-notes-summarizer';
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exactSet = (actual, expected) => Array.isArray(actual) && actual.length === expected.length &&
  new Set(actual).size === expected.length && expected.every(value => actual.includes(value));
function requireContract(condition, label) {
  // Do not use assert.equal/deepEqual here: their diagnostic payload can expose
  // untrusted values such as an origin containing a token.
  if (!condition) throw new Error(`Contract violation: ${label}`);
}

export function parseContractJson(source) {
  try { return JSON.parse(source); }
  catch { throw new Error('Contract violation: manifest JSON'); }
}

export function assertSecurityContracts(input) {
  requireContract(record(input), 'manifest input');
  const { app, executa, launcher, pkg } = input;
  requireContract([app, executa, launcher, pkg].every(record), 'manifest objects');
  requireContract(app.schema === 2, 'App schema');
  requireContract(typeof pkg.version === 'string' && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(pkg.version), 'package version');
  requireContract(executa.name === TOOL_ID && launcher.tool_id === TOOL_ID, 'Executa identity');
  requireContract(Array.isArray(app.required_executas) && app.required_executas.length === 1 &&
    app.required_executas[0]?.tool_id === TOOL_ID, 'required Executa identity');
  requireContract(executa.version === pkg.version && app.required_executas[0].min_version === pkg.version, 'version alignment');
  requireContract(exactSet(app.permissions, ['storage.read', 'storage.write', 'tools.invoke']), 'App permissions');
  requireContract(exactSet(app.host_capabilities, ['aps.kv', 'llm.sample']), 'App host capabilities');
  requireContract(record(app.ui?.host_api) && exactSet(Object.keys(app.ui.host_api), ['storage', 'tools', 'llm']), 'Host API namespaces');
  requireContract(exactSet(app.ui.host_api.storage, ['get', 'set']), 'storage methods');
  requireContract(exactSet(app.ui.host_api.tools, [`required:${TOOL_ID}`]), 'tool routes');
  // This ACL is required by the pinned Anna reverse-sampling bridge. The App
  // still must call tools.invoke rather than call llm.complete directly.
  requireContract(exactSet(app.ui.host_api.llm, ['complete']), 'sampling bridge ACL');
  requireContract(app.ui.bundle?.entry === 'index.html', 'bundle entry');
  requireContract(exactSet(app.ui.bundle.external_origins, []), 'external origins');
  requireContract(exactSet(executa.host_capabilities, ['llm.sample']), 'Executa host capabilities');
  requireContract(Array.isArray(executa.tools) && executa.tools.length === 1 && executa.tools[0]?.name === 'summarize', 'Executa tools');
  requireContract(Array.isArray(executa.tools[0].parameters), 'tool parameters');
  requireContract(app.dev?.mocks === undefined, 'development mocks');
  return { passed: true, toolId: TOOL_ID, version: pkg.version, schema: app.schema,
    bundleEntry: 'bundle/index.html', samplingCapability: true, localSamplingAclCompatibility: true };
}
