import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { before, test } from 'node:test';
import vm from 'node:vm';
import { startResponsivePreview } from '../../scripts/responsive-preview.mjs';

const channel = 'mini-notes:session-recovery:v1';
let source = '', prelude = '';
before(async () => {
  const upstream = http.createServer((_req, res) => {
    res.setHeader('content-type', 'text/html');
    res.end('<!doctype html><head></head><body><iframe id="app"></iframe></body>');
  });
  upstream.listen(0, '127.0.0.1'); await once(upstream, 'listening');
  const preview = await startResponsivePreview({ hostPort: upstream.address().port, port: 0 });
  try {
    const html = await (await fetch(`http://127.0.0.1:${preview.port}/`)).text();
    source = /<script id="mini-notes-session-recovery">([\s\S]*?)<\/script>/.exec(html)?.[1] ?? '';
    prelude = /<script id="mini-notes-preserve-editor">([\s\S]*?)<\/script>/.exec(html)?.[1] ?? '';
  } finally { await preview.close(); await new Promise(resolve => upstream.close(resolve)); }
});

function fixture(fetcher) {
  const sent = [], requests = [], mounts = [], sockets = [];
  let listener;
  const child = { postMessage: (data, origin) => sent.push({ data, origin }) };
  const location = { origin: 'http://localhost:5198', protocol: 'http:', host: 'localhost:5198' };
  const context = vm.createContext({
    window: { addEventListener: (type, callback) => { if (type === 'message') listener = callback; } },
    document: { getElementById: id => id === 'app' ? { contentWindow: child } : null },
    iframe: { contentWindow: child }, location,
    sessionId: 'sess-old', windowUuid: 'old-window', currentToken: 'old-token',
    desktopSize: { w: 864, h: 760 }, harnessCfg: {},
    mount: ff => mounts.push(ff), relayEventToIframe: () => {},
    fetch: async (...args) => { requests.push(args); return fetcher ? fetcher(...args) : { ok: true, json: async () => ({ session_id: 'sess-new', window_uuid: '00000000-0000-4000-8000-000000000001', token: 'test-token', view_meta: {} }) }; },
    WebSocket: class { constructor(url) { this.url = url; sockets.push(this); } close() { this.closed = true; } },
    TextEncoder, AbortController, setTimeout, clearTimeout, URL,
  });
  vm.runInContext(source, context);
  const send = (data, overrides = {}) => listener?.({ source: child, origin: location.origin, data: { channel, ...data }, ...overrides });
  return { send, sent, requests, mounts, context, child, sockets };
}
const flush = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };
const hello = documentId => ({ type: 'hello', documentId });
const recover = (extra = {}) => ({ type: 'recover', documentId: 'document-old', requestId: 'request-1', draft: '恢复草稿😀', uncertain: false, ...extra });

test('preview injects an opt-in recovery bridge after the official dashboard', () => {
  assert(source.length > 0, 'manual recovery script must be present');
});
test('handshake advertises capability without creating or remounting a session', () => {
  const h = fixture(); h.send(hello('document-old'));
  assert.equal(h.sent.at(-1)?.data.type, 'available');
  assert.equal(h.sent.at(-1)?.origin, 'http://localhost:5198');
  assert.equal(h.requests.length, 0); assert.equal(h.mounts.length, 0);
});
test('manual recovery hands the exact draft to a new document once and clears it after ACK', async () => {
  const h = fixture(); h.send(hello('document-old')); h.send(recover()); await flush();
  assert.equal(h.requests.length, 1); assert.equal(h.requests[0][0], '/api/session/create');
  assert.equal(h.requests[0][1].method, 'POST'); assert.equal(h.requests[0][1].body, undefined);
  assert.equal(h.context.sessionId, 'sess-new'); assert.equal(h.mounts.length, 1);
  h.send(hello('document-old'));
  assert.equal(h.sent.filter(row => row.data.type === 'restore').length, 0);
  h.send(hello('document-new'));
  const restored = h.sent.find(row => row.data.type === 'restore').data;
  assert.equal(restored.draft, '恢复草稿😀'); assert.equal(restored.documentId, 'document-new');
  h.send({ type: 'restored', documentId: 'document-new', requestId: 'wrong' });
  h.send(hello('document-new'));
  assert.equal(h.sent.filter(row => row.data.type === 'restore').length, 2);
  h.send({ type: 'restored', documentId: 'document-new', requestId: 'request-1' });
  h.send(hello('document-new'));
  assert.equal(h.sent.filter(row => row.data.type === 'restore').length, 2);
});
test('rejects forged origins, sources, protocol messages, uncertain and oversized recovery requests', async () => {
  const h = fixture(); h.send(hello('document-old'));
  for (const [data, override] of [
    [recover(), { origin: 'https://example.invalid' }], [recover(), { source: {} }],
    [recover({ uncertain: true }), {}], [recover({ documentId: 'not-announced' }), {}],
    [recover({ draft: 'x'.repeat(65537) }), {}], [recover({ requestId: '' }), {}],
    [{ ...recover(), channel: 'different' }, {}],
  ]) h.send(data, override);
  await flush(); assert.equal(h.requests.length, 0); assert.equal(h.mounts.length, 0);
});
test('failed recovery keeps the original document and returns only a bounded error', async () => {
  const h = fixture(async () => { throw new Error('SECRET_CANARY'); });
  h.send(hello('document-old')); h.send(recover()); await flush();
  assert.equal(h.mounts.length, 0); assert.equal(h.context.sessionId, 'sess-old');
  assert.equal(h.sent.at(-1)?.data.type, 'error');
  assert.equal(JSON.stringify(h.sent).includes('SECRET_CANARY'), false);
  h.send(recover({ requestId: 'request-2' })); await flush();
  assert.equal(h.requests.length, 2);
});
test('coalesces duplicate recovery clicks and validates the official response before mounting', async () => {
  let finish;
  const h = fixture(() => new Promise(resolve => { finish = resolve; }));
  h.send(hello('document-old')); h.send(recover()); h.send(recover());
  assert.equal(h.requests.length, 1);
  finish({ ok: true, json: async () => ({ session_id: 'missing-fields' }) }); await flush();
  assert.equal(h.mounts.length, 0); assert.equal(h.context.sessionId, 'sess-old');
  assert.equal(h.sent.at(-1)?.data.type, 'error');
});
test('reoffers an unacknowledged draft after another iframe document loads', async () => {
  const h = fixture(); h.send(hello('document-old')); h.send(recover()); await flush();
  h.send(hello('document-first')); h.send(hello('document-reloaded'));
  const restored = h.sent.filter(row => row.data.type === 'restore');
  assert.equal(restored.length, 2); assert.equal(restored[1].data.documentId, 'document-reloaded');
  h.send(recover({ documentId: 'document-reloaded', requestId: 'request-again' })); await flush();
  assert.equal(h.requests.length, 1);
  assert(h.sent.some(row => row.data.type === 'error' && row.data.requestId === 'request-again'));
});
test('a late creation response never remounts a newer editor document', async () => {
  let finish;
  const h = fixture(() => new Promise(resolve => { finish = resolve; }));
  h.send(hello('document-old')); h.send(recover()); h.send(hello('document-newer'));
  finish({ ok: true, json: async () => ({ session_id: 'sess-new', window_uuid: '00000000-0000-4000-8000-000000000001', token: 'test-token' }) }); await flush();
  assert.equal(h.mounts.length, 0); assert.equal(h.context.sessionId, 'sess-old');
  assert.equal(h.sent.at(-1).data.type, 'restore'); assert.equal(h.sent.at(-1).data.documentId, 'document-newer');
});
test('preview watch messages preserve the editor and all other socket messages pass through', () => {
  const notices = [], received = [];
  class NativeSocket extends EventTarget { constructor(url) { super(); this.url = url; } }
  const context = vm.createContext({
    window: { WebSocket: NativeSocket }, location: { href: 'http://localhost:5198/', origin: 'http://localhost:5198', host: 'localhost:5198' }, URL,
    document: { getElementById: () => ({ setAttribute: (...args) => notices.push(args) }) },
  });
  vm.runInContext(prelude, context);
  const socket = new context.window.WebSocket('ws://localhost:5198/ws?session_id=test');
  socket.addEventListener('message', event => received.push(event.data));
  socket.dispatchEvent(new MessageEvent('message', { data: '{"kind":"reload","path":"bundle"}' }));
  assert.equal(received.length, 0, 'official reload handler must not run in preview');
  assert.equal(notices.length, 1);
  socket.dispatchEvent(new MessageEvent('message', { data: '{"kind":"event","event":"runtime_state_synced"}' }));
  assert.equal(received.length, 1);
  const other = new context.window.WebSocket('ws://localhost:5198/other');
  other.addEventListener('message', event => received.push(event.data));
  other.dispatchEvent(new MessageEvent('message', { data: '{"kind":"reload"}' }));
  assert.equal(received.length, 2, 'unrelated sockets must stay untouched');
});
