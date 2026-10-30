import http from 'node:http';
import net from 'node:net';

// Development chrome only. The official dashboard, SDK and App payloads remain
// upstream-owned. Never accept an upstream URL or a non-loopback bind address.
const LOOPBACK = '127.0.0.1';
export const MAX_HTML_BYTES = 1024 * 1024;
export const PREVIEW_CSS = `
html { min-width: 0; overflow-x: hidden; }
body {
  box-sizing: border-box; width: 100%; min-width: 0;
  height: 100vh; height: 100dvh; min-height: 100vh;
  grid-template-columns: minmax(0, 1fr) 320px;
  grid-template-rows: 48px minmax(440px, 1fr);
  overflow-x: hidden;
}
header, main, aside { box-sizing: border-box; min-width: 0; min-height: 0; }
header { gap: 10px; padding: 0 16px; overflow: hidden; }
header h1, header .badge, header button { flex-shrink: 0; white-space: nowrap; }
header .meta { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
main { padding: 20px; align-items: center; }
#frame {
  box-sizing: border-box; width: 100% !important; height: 100% !important;
  min-width: 0; min-height: 0; max-width: 1280px; max-height: 1200px;
  flex: 1 1 auto;
}
#frame iframe { width: 100%; min-width: 0; min-height: 0; flex: 1 1 0; }
#frame .titlebar {
  box-sizing: border-box; height: 36px; min-height: 36px; padding: 4px 10px;
  gap: 8px; flex-wrap: nowrap; overflow: hidden; white-space: nowrap;
}
#iframe-src, #size { display: none; }
/* These official debug controls have no corresponding Mini Notes feature.
   Hide their whole group in the experience entry, leaving upstream intact. */
#ff-mobile, #ctx-theme, #ctx-lang,
#frame .titlebar [aria-label="Host context"] { display: none !important; }
#frame .titlebar::after {
  content: 'Mini Notes · 自适应预览'; margin-left: auto;
  min-width: 0; overflow: hidden; text-overflow: ellipsis; font-size: 11px;
}
aside { overflow: auto; overflow-wrap: anywhere; }
@media (max-width: 1100px) {
  body {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: 48px minmax(440px, 1fr) 160px;
    grid-template-areas: 'header' 'main' 'side';
  }
  aside { border-left: 0; border-top: 1px solid var(--border); padding: 10px 16px; }
}
@media (max-width: 700px) {
  body { grid-template-rows: 40px minmax(408px, 1fr) 120px; }
  header { padding: 0 10px; gap: 6px; }
  header h1 { font-size: 12px; }
  header .meta { display: none; }
  header #rec-btn { margin-left: auto !important; }
  main { padding: 0; }
  #frame { border: 0; border-radius: 0; }
  #frame .titlebar { height: 30px; min-height: 30px; padding: 3px 6px; gap: 4px; }
  #frame .ff-toggle button { padding: 2px 5px; font-size: 10px; }
  #frame .titlebar::after { font-size: 10px; }
  aside { padding: 8px 10px; }
}
@media (max-height: 500px) {
  #frame iframe { min-height: 360px; }
}
`;

const STYLE = `<style id="mini-notes-responsive-preview">${PREVIEW_CSS}</style>`;
const isOriginPath = path => typeof path === 'string' && path.startsWith('/') && !path.startsWith('//') && !path.includes('\\');
const validPort = (port, ephemeral = false) => Number.isInteger(port) && port >= (ephemeral ? 0 : 1) && port <= 65535;

function writeResponse(res, upstream, headers = upstream.rawHeaders) {
  res.writeHead(upstream.statusCode, upstream.statusMessage, headers);
}

function forwardResponse(req, res, upstream) {
  upstream.on('error', () => res.destroy());
  const path = req.url.split('?')[0];
  const html = /^text\/html(?:\s*;|$)/i.test(upstream.headers['content-type'] ?? '');
  const encoding = upstream.headers['content-encoding'];
  if (req.method !== 'GET' || !['/', '/dashboard'].includes(path) || upstream.statusCode !== 200 || !html || (encoding && encoding !== 'identity')) {
    writeResponse(res, upstream);
    upstream.pipe(res);
    return;
  }
  let chunks = [], size = 0, streaming = false;
  const onData = chunk => {
    chunks.push(chunk);
    size += chunk.length;
    if (size <= MAX_HTML_BYTES) return;
    // Over the injection limit: immediately resume byte-for-byte streaming.
    streaming = true;
    writeResponse(res, upstream);
    for (const buffered of chunks) res.write(buffered);
    chunks = [];
    upstream.off('data', onData);
    upstream.pipe(res);
  };
  upstream.on('data', onData);
  upstream.on('end', () => {
    if (streaming || res.destroyed) return;
    const original = Buffer.concat(chunks);
    const source = original.toString('utf8');
    const updated = source.includes('id="mini-notes-responsive-preview"') ? source : source.replace(/<\/head\s*>/i, `${STYLE}</head>`);
    if (source === updated) { writeResponse(res, upstream); res.end(original); return; }
    const headers = [];
    for (let i = 0; i < upstream.rawHeaders.length; i += 2) {
      if (!['content-length', 'etag', 'content-md5', 'digest'].includes(upstream.rawHeaders[i].toLowerCase())) headers.push(upstream.rawHeaders[i], upstream.rawHeaders[i + 1]);
    }
    writeResponse(res, upstream, headers);
    res.end(updated);
  });
}

export async function startResponsivePreview(options = {}) {
  if (Object.keys(options).some(key => !['hostPort', 'port'].includes(key))) throw new Error('Unsupported preview option.');
  const { hostPort, port = 5198 } = options;
  if (!validPort(hostPort) || !validPort(port, true) || hostPort === port) throw new Error('Invalid preview port.');
  const sockets = new Set();
  const track = socket => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  };
  const upstreamRequest = req => {
    const upstream = http.request({ hostname: LOOPBACK, port: hostPort, method: req.method, path: req.url, headers: req.rawHeaders, agent: false });
    upstream.on('socket', track);
    return upstream;
  };
  const server = http.createServer((req, res) => {
    if (!isOriginPath(req.url)) { res.writeHead(400); res.end('Invalid preview request.'); return; }
    const upstream = upstreamRequest(req);
    upstream.on('response', response => forwardResponse(req, res, response));
    upstream.on('error', () => {
      if (res.headersSent) res.destroy();
      else { res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' }); res.end('Preview upstream unavailable.'); }
    });
    req.on('aborted', () => upstream.destroy());
    req.on('error', () => upstream.destroy());
    res.on('close', () => upstream.destroy());
    req.pipe(upstream);
  });
  server.on('connection', track);
  server.on('connect', (_req, socket) => socket.end('HTTP/1.1 405 Method Not Allowed\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'));
  server.on('upgrade', (req, socket, head) => {
    if (!isOriginPath(req.url)) { socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'); return; }
    // Once upgraded, tunnel raw TCP so rejected handshakes (including HTTP
    // chunk framing), protocols, and binary WebSocket frames stay untouched.
    const upstream = net.createConnection({ host: LOOPBACK, port: hostPort });
    track(upstream);
    let connected = false;
    socket.on('error', () => upstream.destroy());
    socket.on('close', () => upstream.destroy());
    upstream.on('error', () => {
      if (connected) socket.destroy();
      else if (!socket.destroyed) socket.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
    });
    upstream.on('connect', () => {
      connected = true;
      const lines = [`${req.method} ${req.url} HTTP/${req.httpVersion}`];
      for (let i = 0; i < req.rawHeaders.length; i += 2) lines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
      upstream.write(`${lines.join('\r\n')}\r\n\r\n`);
      if (head.length) upstream.write(head);
      upstream.pipe(socket);
      socket.pipe(upstream);
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, LOOPBACK, () => { server.off('error', reject); resolve(); });
  });
  return {
    server, port: server.address().port,
    close: () => new Promise(resolve => {
      server.close(resolve);
      for (const socket of sockets) socket.destroy();
    }),
  };
}
