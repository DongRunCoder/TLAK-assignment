// Injected after the pinned official dashboard's classic script. This adapter
// uses its existing session bindings and mount function, never the App's data.
// Keep compatibility covered by both unit tests and the real Host smoke test.
function preservePreviewEditor() {
  const NativeSocket = window.WebSocket;
  window.WebSocket = class extends NativeSocket {
    constructor(...args) {
      super(...args);
      const url = new URL(this.url, location.href);
      if (url.host !== location.host || url.pathname !== '/ws') return;
      this.addEventListener('message', event => {
        try {
          if (typeof event.data === 'string' && JSON.parse(event.data).kind === 'reload') {
            event.stopImmediatePropagation();
            document.getElementById('frame')?.setAttribute('data-update-pending', 'true');
          }
        } catch { /* Preserve all ordinary Host and SDK messages unchanged. */ }
      });
    }
  };
}

function installPreviewRecovery() {
  const channel = 'mini-notes:session-recovery:v1';
  const appFrame = document.getElementById('app');
  if (!appFrame || typeof mount !== 'function' || typeof harnessCfg === 'undefined') return;
  const validId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
  const validDraft = value => typeof value === 'string' && value.length <= 65536 && new TextEncoder().encode(value).length <= 262144;
  let announcedId, pending, busy = false, socket;
  const post = (documentId, type, extra = {}) => appFrame.contentWindow?.postMessage({ channel, type, documentId, ...extra }, location.origin);
  const handoff = documentId => {
    if (!pending || documentId === pending.previousDocumentId) return;
    pending.targetDocumentId = documentId;
    post(documentId, 'restore', { requestId: pending.requestId, draft: pending.draft });
  };
  window.addEventListener('message', async event => {
    if (event.source !== appFrame.contentWindow || event.origin !== location.origin) return;
    const data = event.data;
    if (!data || data.channel !== channel || !validId(data.documentId)) return;
    if (data.type === 'hello') {
      announcedId = data.documentId;
      post(announcedId, 'available');
      handoff(announcedId);
      return;
    }
    if (data.type === 'restored') {
      if (pending && data.documentId === pending.targetDocumentId && data.requestId === pending.requestId) pending = undefined;
      return;
    }
    if (data.type !== 'recover' || data.documentId !== announcedId || !validId(data.requestId) ||
        data.uncertain !== false || !validDraft(data.draft) || busy) return;
    if (pending && data.documentId !== pending.previousDocumentId) {
      post(data.documentId, 'error', { requestId: data.requestId });
      handoff(data.documentId);
      return;
    }
    busy = true;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    const snapshot = { previousDocumentId: data.documentId, requestId: data.requestId, draft: data.draft };
    try {
      // Session control belongs to the local development shell. No note or
      // summary payload is sent here; the new App still uses the official SDK.
      const response = await fetch('/api/session/create', { method: 'POST', signal: controller.signal });
      if (!response.ok) throw new Error('unavailable');
      const out = await response.json();
      if (!validId(out?.session_id) || typeof out.window_uuid !== 'string' ||
          !/^[a-f0-9-]{36}$/i.test(out.window_uuid) || typeof out.token !== 'string' || !out.token || out.token.length > 16384) throw new Error('invalid response');
      pending = snapshot;
      // A newer document may have begun editing while the request was in
      // flight. Return the cached draft without destroying that editor.
      if (announcedId !== snapshot.previousDocumentId) { handoff(announcedId); return; }
      sessionId = out.session_id;
      windowUuid = out.window_uuid;
      currentToken = out.token;
      socket?.close();
      const freshSessionId = sessionId;
      try { socket = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws?session_id=${encodeURIComponent(freshSessionId)}`); }
      catch { socket = undefined; } // Read-only probes still detect availability.
      if (socket) socket.onmessage = event => {
        if (sessionId !== freshSessionId) return;
        try {
          const envelope = JSON.parse(event.data);
          if (envelope.kind === 'event') relayEventToIframe(envelope);
          // Never reload an editor in response to transport or watch events.
        } catch { /* Ignore malformed Host events, without logging payloads. */ }
      };
      mount('desktop');
    } catch {
      // No navigation on failure, and never expose the Host response or draft.
      post(snapshot.previousDocumentId, 'error', { requestId: snapshot.requestId });
    } finally { clearTimeout(timer); busy = false; }
  });
}

export const PREVIEW_RECOVERY_SCRIPT = `<script id="mini-notes-session-recovery">(${installPreviewRecovery.toString()})();</script>`;
export const PREVIEW_PRESERVE_SCRIPT = `<script id="mini-notes-preserve-editor">(${preservePreviewEditor.toString()})();</script>`;
