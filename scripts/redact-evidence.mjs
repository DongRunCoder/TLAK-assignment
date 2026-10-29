export const REDACTED = '[REDACTED]';

const normalize = key => key.replace(/[^a-z0-9]/gi, '').toLowerCase();
const errorCodes = new Set(['TOOL_BUSY', 'SAMPLING_UNAVAILABLE', 'SAMPLING_TIMEOUT', 'SAMPLING_CANCELLED',
  'SAMPLING_TRANSPORT', 'SAMPLING_HOST_ERROR', 'SAMPLING_INVALID_RESPONSE']);
const sensitive = key => !['maxtokens', 'maxoutputtokens'].includes(key) &&
  (/credential|apikey|password|passwd|token|auth|session|invokeid|correlationid/.test(key) || key === 'id');
const containers = new Set([
  'args', 'arguments', 'params', 'request', 'response', 'result', 'data', 'value', 'metadata', 'context',
  'notes', 'content', 'messages', 'message', 'tools', 'parameters', 'items', 'capabilities', 'clientcapabilities',
  'sampling', 'error', 'errors', 'consoleerrors', 'httperrors', 'hostwarnings', 'responseerrors', 'headers',
]);
const numbers = new Set(['code', 'hostcode', 'status', 'sequence', 'revision', 'nextsequence', 'schemaversion', 'seenguideversion',
  'schema', 'rpccount', 'checks', 'timeout', 'maxtokens', 'maxoutputtokens', 'maxdepth', 'size']);
const booleans = new Set(['ok', 'success', 'passed', 'truncated', 'required', 'actualannaharness',
  'samplingcapability', 'localsamplingaclcompatibility']);
const text = new Map([
  ['ns', new Set(['storage', 'tools', 'llm', 'sampling'])],
  ['code', errorCodes],
  ['method', new Set(['get', 'set', 'invoke', 'summarize', 'initialize', 'describe', 'health', 'complete', 'createMessage', 'sampling/createMessage'])],
  ['name', new Set(['mini-notes-summarizer', 'summarize', 'notes', 'method', 'prompt', 'messages', 'content', 'summary'])],
  ['toolid', new Set(['mini-notes-summarizer'])],
  ['tool', new Set(['summarize'])],
  ['key', new Set(['mini-notes:document:v1', 'mini-notes:onboarding:v1'])],
  ['type', new Set(['text', 'image', 'array', 'string', 'object', 'number', 'boolean', 'binary'])],
  ['role', new Set(['user', 'assistant', 'system'])],
  ['status', new Set(['ready', 'ok', 'passed', 'failed', 'error'])],
  ['stopreason', new Set(['endTurn', 'maxTokens', 'stopSequence'])],
  ['direction', new Set(['host-to-executa', 'executa-to-host'])],
  ['jsonrpc', new Set(['2.0'])],
  ['protocolversion', new Set(['1.0', '2.0'])],
  ['sourceTest', new Set(['scripts/test-harness.mjs', 'scripts/test-protocol.mjs', 'scripts/test-sampling.mjs'])],
  ['reproduce', new Set(['npm run verify:harness', 'npm run test:protocol', 'npm run test:sampling'])],
  ['browser', new Set(['Playwright; Browser plugin not available'])],
].map(([key, values]) => [normalize(key), values]));
const alwaysRedact = new Set(['summary', 'prompt', 'systemprompt', 'text', 'url', 'raw', 'description', 'stderr', 'stdout', 'stack']);

// This is a bounded evidence projection, not a detector for arbitrary secrets in
// arbitrary text. Free text and unknown fields are omitted/redacted; only known
// protocol enums, booleans, counters and digests survive. Test inputs stay in the
// source tests, and sourceTest/reproduce supply a public reproduction reference.
export function redactEvidence(input) {
  const ancestors = new WeakSet();
  function visit(value, key = '', depth = 0) {
    if (sensitive(key) || alwaysRedact.has(key) || depth > 32) return REDACTED;
    if (value === null) return null;
    if (typeof value === 'string') {
      if (key === 'error') {
        const match = /^([A-Z_]+):(?: \[(-\d{4,6})\])?/.exec(value.slice(0, 100));
        if (match && errorCodes.has(match[1])) return { code: match[1],
          ...(match[2] ? { hostCode: Number(match[2]) } : {}), message: REDACTED };
      }
      if (text.get(key)?.has(value)) return value;
      if (['sha256', 'livesdkhash'].includes(key) && /^[a-f0-9]{64}$/.test(value)) return value;
      if (key === 'version' && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(value)) return value;
      return REDACTED;
    }
    if (typeof value === 'number') return numbers.has(key) && Number.isFinite(value) ? value : REDACTED;
    if (typeof value === 'boolean') return booleans.has(key) ? value : REDACTED;
    if (typeof value !== 'object' || value instanceof Error || ancestors.has(value)) return REDACTED;
    ancestors.add(value);
    try {
      if (Array.isArray(value)) return value.map(entry => visit(entry, key, depth + 1));
      const output = {};
      for (const [field, entry] of Object.entries(value)) {
        const normalized = normalize(field);
        // Unknown/sensitive names themselves can carry secrets. Keep neither
        // their spelling nor their value, including Unicode appended to a key.
        if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(field) || sensitive(normalized)) continue;
        if (alwaysRedact.has(normalized)) output[field] = REDACTED;
        else if (containers.has(normalized) || numbers.has(normalized) || booleans.has(normalized) || text.has(normalized) ||
          ['sha256', 'livesdkhash', 'version'].includes(normalized)) output[field] = visit(entry, normalized, depth + 1);
      }
      return output;
    } finally { ancestors.delete(value); }
  }
  return visit(input);
}
