import assert from 'node:assert/strict';
import { test } from 'node:test';
import { redactEvidence as redact } from '../../scripts/redact-evidence.mjs';
const REDACTED = '[REDACTED]';

test('redacts note content and summaries while retaining RPC order, note sequence, and status', () => {
  const rows = [
    { ns: 'storage', method: 'set', args: { key: 'mini-notes:document:v1', value: {
      schemaVersion: 1, revision: 3, nextSequence: 4,
      notes: [{ id: 'private-note-id', content: 'private body', sequence: 3, createdAt: '2026-10-30T00:00:00Z' }],
    } }, response: { ok: true, result: { ok: true } } },
    { ns: 'tools', method: 'invoke', args: { tool_id: 'mini-notes-summarizer', method: 'summarize',
      args: { notes: ['first private body', 'second private body'] } },
    response: { ok: true, result: { success: true, data: { summary: 'private summary', stopReason: 'endTurn', truncated: false } } } },
  ];
  const original = structuredClone(rows);
  const result = redact(rows);
  assert.deepEqual(rows, original, 'redaction must not alter live RPC assertions');
  assert.equal(result[0].method, 'set');
  assert.equal(result[0].args.value.notes[0].sequence, 3);
  assert.equal(result[0].args.value.notes[0].content, REDACTED);
  assert.equal(result[1].args.method, 'summarize');
  assert.deepEqual(result[1].args.args.notes, [REDACTED, REDACTED]);
  assert.equal(result[1].response.result.success, true);
  assert.equal(result[1].response.result.data.summary, REDACTED);
  assert.equal(result[1].response.result.data.stopReason, 'endTurn');
  assert.equal(JSON.stringify(result).includes('private'), false);
});

test('recurses through case variants and arrays without retaining credentials or session identifiers', () => {
  const secrets = ['credential-secret', 'apikey-secret', 'password-secret', 'token-secret', 'auth-secret', 'session-secret'];
  const input = { data: [
    { Credential: secrets[0], API_Key: secrets[1], Password: secrets[2], accessTOKEN: secrets[3], AUTH: secrets[4], Session_ID: secrets[5] },
    { metadata: { headers: { Authorization: 'Bearer auth-secret' }, context: { executa_invoke_id: 'session-secret' },
      Content: 'private-content', SUMMARY: 'private-summary', Prompt: 'private-prompt',
      Messages: [{ role: 'user', content: { type: 'text', text: 'private-message' } }], Notes: ['private-note'] } },
  ] };
  const result = redact(input);
  const serialized = JSON.stringify(result);
  for (const secret of [...secrets, 'private-content', 'private-summary', 'private-prompt', 'private-message', 'private-note']) {
    assert.equal(serialized.includes(secret), false);
  }
  assert.equal(result.data[1].metadata.Messages[0].role, 'user');
  assert.equal(result.data[1].metadata.Messages[0].content.type, 'text');
});

test('replaces complete diagnostics and URLs, including error text that embeds bearer tokens and notes', () => {
  const secret = 'HIDDEN_PRIVATE_BEARER_22';
  const input = {
    error: { code: -32603, message: `failed: note=${secret}; Authorization: Bearer ${secret}`,
      data: { method: `https://example.invalid/${secret}`, summary: secret } },
    responseErrors: [`https://user:${secret}@example.invalid/?token=${secret}`],
    consoleErrors: [{ message: `page body ${secret}`, url: `https://example.invalid/#${secret}` }],
    httpErrors: [{ url: `https://example.invalid/?access_token=${secret}`, status: 401 }],
    url: `https://example.invalid/?t=${secret}`, raw: `unparsed frame ${secret}`,
  };
  const result = redact(input);
  assert.equal(result.error.code, -32603);
  assert.equal(result.error.message, REDACTED);
  assert.equal(result.httpErrors[0].status, 401);
  assert.equal(JSON.stringify(result).includes(secret), false);
});

test('unknown free text is omitted while tool schema method names remain recognizable', () => {
  const secret = 'UNKNOWN_SECRET_65';
  const input = { method: 'describe', result: { name: 'mini-notes-summarizer', tools: [{ name: 'summarize',
    parameters: [{ name: 'notes', type: 'array', items: { type: 'string' } }], description: secret }] },
  [secret]: secret, metadata: { unexpectedField: secret }, status: secret, methodName: secret };
  const result = redact(input);
  assert.equal(result.method, 'describe');
  assert.equal(result.result.tools[0].name, 'summarize');
  assert.equal(result.result.tools[0].parameters[0].name, 'notes');
  assert.equal(JSON.stringify(result).includes(secret), false);
});

test('keeps a bounded reproduction reference and digest without retaining a live harness address', () => {
  const result = redact({ sourceTest: 'scripts/test-harness.mjs', reproduce: 'npm run verify:harness',
    passed: true, actualAnnaHarness: true, rpcCount: 8, liveSdkHash: 'a'.repeat(64), url: 'http://localhost/?t=secret' });
  assert.equal(result.sourceTest, 'scripts/test-harness.mjs');
  assert.equal(result.reproduce, 'npm run verify:harness');
  assert.equal(result.liveSdkHash, 'a'.repeat(64));
  assert.equal(result.passed, true);
  assert.equal(result.url, REDACTED);
});

test('redacts primitive text, unexpected scalar types, cycles, and excessive nesting safely', () => {
  const cycle = { method: 'get' }; cycle.data = cycle;
  assert.equal(redact('root-secret'), REDACTED);
  assert.equal(redact(new Error('error-secret')), REDACTED);
  assert.doesNotThrow(() => JSON.stringify(redact(cycle)));
  let nested = { content: 'deep-secret' };
  for (let depth = 0; depth < 100; depth++) nested = { data: nested };
  assert.equal(JSON.stringify(redact(nested)).includes('deep-secret'), false);
});

test('unknown property names cannot become a second channel for secrets', () => {
  const secrets = ['secret_CREDENTIAL_927', '秘密'];
  const result = redact({ [secrets[0]]: 'value', [`content${secrets[1]}`]: 'value',
    data: { [secrets[0]]: 'value' }, maxTokens: 512,
    tools: [{ name: 'summarize', parameters: [{ name: 'method', type: 'string' }] }] });
  const serialized = JSON.stringify(result);
  for (const secret of secrets) assert.equal(serialized.includes(secret), false);
  assert.equal(result.maxTokens, 512, 'a numeric sampling budget is not an access token');
  assert.equal(result.tools[0].parameters[0].name, 'method');
});

test('retains allowlisted tool and numeric Host error codes without retaining their diagnostic bodies', () => {
  const result = redact({ result: { success: false, error: 'SAMPLING_HOST_ERROR: [-32603] private bearer body' },
    error: { code: 'SAMPLING_INVALID_RESPONSE', message: 'private summary body' } });
  assert.deepEqual(result.result.error, { code: 'SAMPLING_HOST_ERROR', hostCode: -32603, message: REDACTED });
  assert.equal(result.error.code, 'SAMPLING_INVALID_RESPONSE');
  assert.equal(JSON.stringify(result).includes('private'), false);
});
