import assert from 'node:assert/strict';
import { once } from 'node:events';
import http from 'node:http';
import net from 'node:net';
import { test } from 'node:test';
import { startResponsivePreview, MAX_HTML_BYTES, PREVIEW_CSS } from '../../scripts/responsive-preview.mjs';

async function fixture(handler, action, upgrade) {
  const upstream = http.createServer(handler);
  if (upgrade) upstream.on('upgrade', upgrade);
  const sockets = new Set();
  upstream.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  let preview;
  try {
    preview = await startResponsivePreview({ hostPort: upstream.address().port, port: 0 });
    await action(preview, upstream);
  } finally {
    await preview?.close();
    for (const socket of sockets) socket.destroy();
    await new Promise(resolve => upstream.close(resolve));
  }
}

function request(port, path = '/', { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, method, headers }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, statusMessage: res.statusMessage, headers: res.headers, body: Buffer.concat(chunks) }));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end(body);
  });
}

const dashboard = '<!doctype html><head><title>Official Harness</title></head><body><main id="frame"></main><script>const opaque = "unchanged";</script></body>';

test('forwards POST bytes, query, opaque headers, status and response bytes without rewriting', async () => {
  const payload = Buffer.from([0, 255, 13, 10, 123, 1, 128]);
  let observed;
  await fixture(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    observed = { method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks) };
    res.writeHead(422, 'Upstream status', { 'content-type': 'application/octet-stream', 'x-upstream': 'intact' });
    res.end(payload);
  }, async ({ port }) => {
    const response = await request(port, '/api/session/call?opaque=a%2Fb&x=1&x=2', {
      method: 'POST', headers: { host: 'localhost:5198', authorization: 'Bearer test-only', 'x-opaque': 'keep', 'content-length': payload.length }, body: payload,
    });
    assert.deepEqual(observed.body, payload);
    assert.equal(observed.method, 'POST');
    assert.equal(observed.url, '/api/session/call?opaque=a%2Fb&x=1&x=2');
    assert.equal(observed.headers.host, 'localhost:5198');
    assert.equal(observed.headers.authorization, 'Bearer test-only');
    assert.equal(observed.headers['x-opaque'], 'keep');
    assert.equal(response.status, 422);
    assert.equal(response.statusMessage, 'Upstream status');
    assert.equal(response.headers['x-upstream'], 'intact');
    assert.deepEqual(response.body, payload);
  });
});

test('injects only root and dashboard HTML while retaining the official scripts', async () => {
  await fixture((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-length': Buffer.byteLength(dashboard), etag: 'stale' });
    res.end(dashboard);
  }, async ({ port }) => {
    for (const path of ['/', '/?view=main', '/dashboard', '/dashboard?view=main']) {
      const response = await request(port, path);
      assert.match(response.body.toString(), /<style id="mini-notes-responsive-preview">/);
      assert.match(response.body.toString(), /<script>const opaque = "unchanged";<\/script>/);
      assert.equal(response.headers['content-length'], undefined);
      assert.equal(response.headers.etag, undefined);
    }
    for (const path of ['/anna-apps/example/dev/index.html', '/static/anna-apps/_sdk/latest/index.js', '/api/session/create', '/dashboard/other']) {
      const response = await request(port, path);
      assert.equal(response.body.toString(), dashboard);
      assert.equal(Number(response.headers['content-length']), Buffer.byteLength(dashboard));
      assert.equal(response.headers.etag, 'stale');
    }
  });
});

test('does not mutate non-HTML, compressed HTML, non-GET, or oversized dashboard responses', async () => {
  const oversized = dashboard + ' '.repeat(MAX_HTML_BYTES);
  await fixture((req, res) => {
    const kind = req.url.slice(2);
    const body = kind === 'large' ? oversized : dashboard;
    res.writeHead(200, { 'content-type': kind === 'json' ? 'application/json' : 'text/html',
      'content-length': Buffer.byteLength(body), ...(kind === 'encoded' ? { 'content-encoding': 'gzip' } : {}) });
    res.end(body);
  }, async ({ port }) => {
    for (const path of ['/?json', '/?encoded', '/?large']) {
      const response = await request(port, path);
      assert.equal(response.body.toString(), path === '/?large' ? oversized : dashboard);
      assert.ok(response.headers['content-length']);
    }
    assert.equal((await request(port, '/', { method: 'POST' })).body.toString(), dashboard);
    const head = await request(port, '/', { method: 'HEAD' });
    assert.equal(head.body.length, 0);
    assert.equal(Number(head.headers['content-length']), Buffer.byteLength(dashboard));
  });
});

test('passes WebSocket upgrade headers and bidirectional bytes, including upgrade head bytes', async () => {
  let received = Buffer.alloc(0), upgradeRequest;
  const serverHello = Buffer.from([0x82, 3, 0, 254, 255]);
  const clientBytes = Buffer.from([0x82, 4, 255, 0, 128, 1]);
  await fixture((_req, res) => res.end(), async ({ port }) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    await once(socket, 'connect');
    try {
      const chunks = [];
      const result = new Promise((resolve, reject) => {
        socket.on('data', chunk => {
          chunks.push(chunk);
          const all = Buffer.concat(chunks), boundary = all.indexOf('\r\n\r\n');
          if (boundary >= 0 && all.length >= boundary + 4 + serverHello.length + clientBytes.length) resolve(all);
        });
        socket.on('error', reject);
      });
      socket.write(Buffer.concat([Buffer.from('GET /socket?raw=%2F&x=1 HTTP/1.1\r\nHost: localhost:5198\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Protocol: test-protocol\r\nAuthorization: Bearer test-only\r\n\r\n'), clientBytes]));
      const timeout = setTimeout(() => socket.destroy(new Error('Upgrade timed out')), 3000);
      let all;
      try { all = await result; } finally { clearTimeout(timeout); }
      const boundary = all.indexOf('\r\n\r\n');
      assert.match(all.subarray(0, boundary).toString(), /^HTTP\/1\.1 101 Switching Protocols/);
      assert.match(all.subarray(0, boundary).toString(), /x-upgrade: intact/i);
      assert.deepEqual(all.subarray(boundary + 4), Buffer.concat([serverHello, clientBytes]));
      assert.deepEqual(received, clientBytes);
      assert.equal(upgradeRequest.url, '/socket?raw=%2F&x=1');
      assert.equal(upgradeRequest.headers.authorization, 'Bearer test-only');
      assert.equal(upgradeRequest.headers['sec-websocket-protocol'], 'test-protocol');
    } finally { socket.destroy(); }
  }, (req, socket, head) => {
    upgradeRequest = req;
    socket.write(Buffer.concat([Buffer.from('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nX-Upgrade: intact\r\n\r\n'), serverHello]));
    if (head.length) { received = Buffer.concat([received, head]); socket.write(head); }
    socket.on('data', chunk => { received = Buffer.concat([received, chunk]); socket.write(chunk); });
  });
});

test('binds only loopback and rejects absolute-form, authority-form, and CONNECT targets', async () => {
  let requests = 0;
  await fixture((_req, res) => { requests++; res.end('upstream'); }, async ({ port, server }) => {
    assert.equal(server.address().address, '127.0.0.1');
    for (const path of ['http://example.invalid/private', '//example.invalid/private', 'example.invalid:80']) {
      assert.equal((await request(port, path)).status, 400);
    }
    const socket = net.createConnection({ host: '127.0.0.1', port });
    await once(socket, 'connect');
    try {
      socket.end('CONNECT example.invalid:443 HTTP/1.1\r\nHost: example.invalid\r\n\r\n');
      const [response] = await once(socket, 'data');
      assert.match(response.toString(), /^HTTP\/1\.1 405 /);
    } finally { socket.destroy(); }
    assert.equal(requests, 0);
    assert.equal((await request(port, '/ordinary?url=http://example.invalid')).body.toString(), 'upstream');
  });
});

test('requires a numeric upstream port rather than a configurable upstream URL or host', async () => {
  for (const hostPort of [undefined, 0, -1, 65536, '5180', 'http://example.invalid/']) {
    await assert.rejects(() => startResponsivePreview({ hostPort, port: 0 }), /port/i);
  }
  await assert.rejects(() => startResponsivePreview({ hostPort: 5180, port: 0, host: '0.0.0.0' }), /option/i);
  await assert.rejects(() => startResponsivePreview({ hostPort: 5180, port: 0, upstream: 'http://example.invalid' }), /option/i);
});

test('preserves an upstream rejected upgrade response and its chunked body', async () => {
  await fixture((_req, res) => {
    res.writeHead(403, { 'content-type': 'text/plain', 'x-rejected': 'intact' });
    res.write('Denied ');
    res.end('by upstream.');
  }, async ({ port }) => {
    const response = await request(port, '/socket', { headers: { connection: 'Upgrade', upgrade: 'websocket' } });
    assert.equal(response.status, 403);
    assert.equal(response.headers['x-rejected'], 'intact');
    assert.equal(response.body.toString(), 'Denied by upstream.');
  });
});

test('upstream connection errors return a generic response', async () => {
  const vacant = net.createServer().listen(0, '127.0.0.1');
  await once(vacant, 'listening');
  const hostPort = vacant.address().port;
  await new Promise(resolve => vacant.close(resolve));
  const preview = await startResponsivePreview({ hostPort, port: 0 });
  try {
    const response = await request(preview.port, '/api/session/call?token=test-only');
    assert.equal(response.status, 502);
    assert.equal(response.body.toString(), 'Preview upstream unavailable.');
    assert.doesNotMatch(response.body.toString(), /token|test-only|ECONN|127\.0/);
  } finally { await preview.close(); }
});

test('responsive layout overrides fixed frame sizing without changing the Host or App', () => {
  assert.match(PREVIEW_CSS, /minmax\(0,\s*1fr\)\s+320px/);
  assert.match(PREVIEW_CSS, /#frame\s*\{[^}]*width:\s*100%\s*!important/s);
  assert.match(PREVIEW_CSS, /#frame\s*\{[^}]*height:\s*100%\s*!important/s);
  assert.match(PREVIEW_CSS, /max-width:\s*1280px/);
  assert.match(PREVIEW_CSS, /max-height:\s*1200px/);
  assert.match(PREVIEW_CSS, /#iframe-src,\s*#size\s*\{\s*display:\s*none/);
  assert.match(PREVIEW_CSS, /@media\s*\(max-width:\s*1100px\)/);
  assert.match(PREVIEW_CSS, /@media\s*\(max-width:\s*700px\)/);
  assert.match(PREVIEW_CSS, /min-height:\s*360px/);
});
