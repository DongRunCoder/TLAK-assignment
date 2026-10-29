import test from 'node:test';
import assert from 'node:assert/strict';
import { describeFingerprint } from '../../scripts/describe-fingerprint.mjs';

const base = { name: 'mini-notes-summarizer', version: '0.1.1', host_capabilities: ['llm.sample'],
  tools: [{ name: 'summarize', description: 'public tool description', parameters: [{ name: 'notes', type: 'array' }] }] };

test('binary/archive comparison uses complete descriptions independent of JSON key order', () => {
  const reordered = { tools: [{ parameters: [{ type: 'array', name: 'notes' }], description: 'public tool description', name: 'summarize' }],
    host_capabilities: ['llm.sample'], version: '0.1.1', name: 'mini-notes-summarizer', runtime: { type: 'binary' } };
  assert.equal(describeFingerprint(base), describeFingerprint(reordered));
});

test('changed tool descriptions, parameters, capabilities or versions cannot pass archive consistency', () => {
  for (const change of [
    value => { value.tools[0].description = 'different description'; },
    value => { value.tools[0].parameters[0].type = 'string'; },
    value => { value.host_capabilities.push('files.delete'); },
    value => { value.version = '0.1.2'; },
  ]) {
    const changed = structuredClone(base); change(changed);
    assert.notEqual(describeFingerprint(base), describeFingerprint(changed));
  }
});
