import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import * as contracts from '../../scripts/security-contracts.mjs';
const check = contracts.assertSecurityContracts;
const json = async path => JSON.parse(await readFile(new URL(`../../${path}`, import.meta.url), 'utf8'));
const fixture = {
  app: await json('manifest.json'),
  executa: await json('executas/mini-notes-summarizer/manifest.json'),
  launcher: await json('executas/mini-notes-summarizer/executa.json'),
  pkg: await json('package.json'),
};

test('the repository keeps its exact permitted App and Executa surfaces', () => {
  const result = check(structuredClone(fixture));
  assert.equal(result.passed, true);
  assert.equal(result.localSamplingAclCompatibility, true);
  assert.equal(result.version, fixture.pkg.version);
});

test('patch versions follow the input package rather than a frozen release version', () => {
  const input = structuredClone(fixture);
  input.pkg.version = input.executa.version = input.app.required_executas[0].min_version = '9.8.7';
  assert.equal(check(input).version, '9.8.7');
});

const mutations = {
  'agent permission': input => input.app.permissions.push('agent.run'),
  'files permission': input => input.app.permissions.push('files.read'),
  'extra tools permission': input => input.app.permissions.push('tools.list'),
  'missing permission': input => input.app.permissions.pop(),
  'duplicate permission': input => input.app.permissions.push('storage.read'),
  'agent Host API': input => input.app.ui.host_api.agent = ['run'],
  'files Host API': input => input.app.ui.host_api.files = ['read'],
  'extra storage method': input => input.app.ui.host_api.storage.push('delete'),
  'extra tool route': input => input.app.ui.host_api.tools.push('required:another-tool'),
  'extra LLM method': input => input.app.ui.host_api.llm.push('stream'),
  'missing bridge compatibility ACL': input => delete input.app.ui.host_api.llm,
  'external origin': input => input.app.ui.bundle.external_origins.push('https://example.invalid'),
  'App capability': input => input.app.host_capabilities.push('agent.run'),
  'Executa capability': input => input.executa.host_capabilities.push('files.read'),
  'second required Executa': input => input.app.required_executas.push({ ...input.app.required_executas[0] }),
  'second tool': input => input.executa.tools.push({ ...input.executa.tools[0], name: 'other' }),
  'renamed method': input => input.executa.tools[0].name = 'other',
  'wrong required identity': input => input.app.required_executas[0].tool_id = 'other',
  'wrong launcher identity': input => input.launcher.tool_id = 'other',
  'jointly renamed identity': input => {
    input.executa.name = input.launcher.tool_id = input.app.required_executas[0].tool_id = 'other';
    input.app.ui.host_api.tools = ['required:other'];
  },
  'stale Executa version': input => input.executa.version = '0.0.0',
  'stale required version': input => input.app.required_executas[0].min_version = '0.0.0',
  'schema downgrade': input => input.app.schema = 1,
  'wrong bundle entry': input => input.app.ui.bundle.entry = 'other.html',
  'non-array parameters': input => input.executa.tools[0].parameters = {},
  'development mocks': input => input.app.dev.mocks = {},
};

for (const [name, mutate] of Object.entries(mutations)) {
  test(`rejects ${name} without reflecting the rejected input`, () => {
    const input = structuredClone(fixture);
    mutate(input);
    assert.throws(() => check(input), /^Error: Contract violation: [A-Za-z /.-]+$/);
  });
}

test('contract errors never include credential-like values or inspectable actual/expected payloads', () => {
  const secret = 'SECRET_CREDENTIAL_49c https://example.invalid/?token=do-not-print';
  for (const mutate of [
    input => input.app.permissions.push(secret),
    input => input.app.ui.host_api[secret] = [secret],
    input => input.app.ui.bundle.external_origins.push(secret),
    input => input.executa.version = secret,
    input => input.pkg.version = input.executa.version = input.app.required_executas[0].min_version = secret,
  ]) {
    const input = structuredClone(fixture);
    mutate(input);
    assert.throws(() => check(input), error => {
      assert.equal(String(error).includes(secret), false);
      assert.equal(Object.hasOwn(error, 'actual'), false);
      assert.equal(Object.hasOwn(error, 'expected'), false);
      return /^Contract violation: /.test(error.message);
    });
  }
});

test('malformed input fails with a bounded contract error', () => {
  for (const input of [null, {}, { app: null }, { ...fixture, executa: null }]) {
    assert.throws(() => check(input), /^Error: Contract violation: /);
  }
});

test('malformed manifest JSON does not reflect its private source in parser diagnostics', () => {
  assert.equal(typeof contracts.parseContractJson, 'function', 'safe contract parser must exist');
  assert.deepEqual(contracts.parseContractJson('{"schema":2}'), { schema: 2 });
  const secret = 'PRIVATE_MANIFEST_TOKEN_927';
  assert.throws(() => contracts.parseContractJson(`{"${secret}": invalid}`), error => {
    assert.equal(String(error).includes(secret), false);
    assert.equal(Object.hasOwn(error, 'cause'), false);
    return error.message === 'Contract violation: manifest JSON';
  });
});
