export const RECOVERY_CHANNEL = 'mini-notes:session-recovery:v1';
export interface RecoverySnapshot { available: boolean; recovering: boolean; error: string | null }
const failure = '恢复会话未完成，草稿仍保留在当前页面。请复制草稿后手动重新打开，或稍后重试。';
const nonce = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9-]{16,128}$/.test(value);
export const validRecoveryDraft = (value: unknown): value is string => typeof value === 'string' && value.length <= 65_536 && new TextEncoder().encode(value).byteLength <= 262_144;

export function createRecoveryBridge(win: Window, restore: (draft: string, acknowledge: () => void) => void, safe: () => boolean) {
  const documentId = crypto.randomUUID();
  const parent = win.parent;
  const origin = win.location.origin;
  let state: RecoverySnapshot = { available: false, recovering: false, error: null };
  let started = false; let restoreUsed = false; let requestId: string | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const listeners = new Set<() => void>();
  const publish = (patch: Partial<RecoverySnapshot>) => { state = { ...state, ...patch }; for (const listener of listeners) listener(); };
  const post = (message: Record<string, unknown>) => parent.postMessage({ channel: RECOVERY_CHANNEL, documentId, ...message }, origin);
  const fail = () => { clearTimeout(timer); requestId = undefined; publish({ recovering: false, error: failure }); };
  const receive = (event: MessageEvent<unknown>) => {
    if (!started || event.source !== parent || event.origin !== origin || typeof event.data !== 'object' || event.data === null || Array.isArray(event.data)) return;
    const message = event.data as Record<string, unknown>;
    if (message.channel !== RECOVERY_CHANNEL || message.documentId !== documentId) return;
    const keys = Object.keys(message).sort().join(',');
    if (message.type === 'available' && keys === 'channel,documentId,type') { publish({ available: true }); return; }
    if (!state.available || !nonce(message.requestId)) return;
    if (message.type === 'error' && keys === 'channel,documentId,requestId,type' && message.requestId === requestId) { fail(); return; }
    if (message.type !== 'restore' || keys !== 'channel,documentId,draft,requestId,type' || !validRecoveryDraft(message.draft) || restoreUsed || state.recovering) return;
    restoreUsed = true;
    const restoredRequest = message.requestId;
    let acknowledged = false;
    restore(message.draft, () => {
      if (!started || acknowledged) return;
      acknowledged = true;
      post({ type: 'restored', requestId: restoredRequest });
    });
  };
  return {
    start() {
      if (started || parent === win || origin === 'null') return;
      started = true; win.addEventListener('message', receive);
      try { post({ type: 'hello' }); } catch { /* Raw entries keep the manual recovery path. */ }
    },
    dispose() { started = false; clearTimeout(timer); requestId = undefined; win.removeEventListener('message', receive); },
    recover(draft: string) {
      if (!started || !state.available || state.recovering || !safe()) return;
      if (!validRecoveryDraft(draft)) { publish({ error: '草稿超过恢复长度限制，请复制草稿后手动重新打开。' }); return; }
      requestId = crypto.randomUUID(); publish({ recovering: true, error: null });
      timer = setTimeout(fail, 20_000);
      try { post({ type: 'recover', requestId, draft, uncertain: false }); } catch { fail(); }
    },
    getSnapshot: () => state,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
}
