import { describe, expect, it, vi } from 'vitest';
import { createRecoveryBridge, RECOVERY_CHANNEL } from '../../src/anna/recoveryBridge';

function frame() {
  const parent = { postMessage: vi.fn() };
  const win = new EventTarget() as EventTarget & { parent: unknown; location: { origin: string } };
  win.parent = parent; win.location = { origin: 'http://localhost:5200' };
  const send = (data: unknown, source: unknown = parent, origin = win.location.origin) => {
    win.dispatchEvent(new MessageEvent('message', { data, source: source as Window, origin }));
  };
  return { win: win as unknown as Window, parent, send };
}

describe('memory-only draft recovery bridge', () => {
  it('handshakes with a per-document nonce and transfers a draft only after an explicit recovery request', () => {
    const f = frame(); const restore = vi.fn(); const bridge = createRecoveryBridge(f.win, restore, () => true);
    bridge.start();
    expect(f.parent.postMessage).toHaveBeenCalledTimes(1);
    const hello = f.parent.postMessage.mock.calls[0][0];
    expect(hello).toMatchObject({ channel: RECOVERY_CHANNEL, type: 'hello', documentId: expect.any(String) });
    expect(bridge.getSnapshot().available).toBe(false);
    f.send({ ...hello, type: 'available' }); expect(bridge.getSnapshot().available).toBe(true);
    expect(f.parent.postMessage).toHaveBeenCalledTimes(1);
    bridge.recover('draft');
    const request = f.parent.postMessage.mock.calls[1][0];
    expect(request).toEqual({ ...hello, type: 'recover', requestId: expect.any(String), draft: 'draft', uncertain: false });
    expect(request.requestId).not.toBe(hello.documentId);
    expect(bridge.getSnapshot().recovering).toBe(true);
    bridge.recover('again'); expect(f.parent.postMessage).toHaveBeenCalledTimes(2);
    bridge.dispose();
  });
  it('rejects wrong source, origin, document nonce, message type and schema without affecting Anna RPC', () => {
    const f = frame(); const restore = vi.fn(); const bridge = createRecoveryBridge(f.win, restore, () => true); bridge.start();
    expect(f.parent.postMessage).toHaveBeenCalledTimes(1);
    const hello = f.parent.postMessage.mock.calls[0][0]; const available = { ...hello, type: 'available' };
    f.send(available, f.win); f.send(available, f.parent, 'https://evil.example');
    f.send({ ...available, documentId: 'wrong' }); f.send({ ...available, extra: true });
    f.send({ ...available, channel: 'anna', type: 'response', result: {} });
    expect(bridge.getSnapshot().available).toBe(false); expect(restore).not.toHaveBeenCalled();
    bridge.dispose();
  });
  it('restores once after capability, and sends ACK only after the consumer applies the text', () => {
    const f = frame(); let acknowledge!: () => void;
    const restore = vi.fn((_text: string, ack: () => void) => { acknowledge = ack; });
    const bridge = createRecoveryBridge(f.win, restore, () => true); bridge.start();
    expect(f.parent.postMessage).toHaveBeenCalledTimes(1);
    const hello = f.parent.postMessage.mock.calls[0][0];
    const message = { ...hello, type: 'restore', requestId: crypto.randomUUID(), draft: 'unsaved text' };
    f.send(message); expect(restore).not.toHaveBeenCalled();
    f.send({ ...hello, type: 'available' }); f.send(message);
    expect(restore).toHaveBeenCalledOnce(); expect(restore.mock.calls[0][0]).toBe('unsaved text');
    expect(f.parent.postMessage).toHaveBeenCalledTimes(1);
    acknowledge();
    expect(f.parent.postMessage).toHaveBeenLastCalledWith({ ...hello, type: 'restored', requestId: message.requestId }, f.win.location.origin);
    f.send({ ...message, draft: 'overwrite' }); expect(restore).toHaveBeenCalledOnce(); bridge.dispose();
  });
  it('refuses uncertain recovery and oversized restore/request text', () => {
    const f = frame(); const restore = vi.fn(); let safe = false;
    const bridge = createRecoveryBridge(f.win, restore, () => safe); bridge.start();
    expect(f.parent.postMessage).toHaveBeenCalledTimes(1);
    const hello = f.parent.postMessage.mock.calls[0][0]; f.send({ ...hello, type: 'available' });
    bridge.recover('draft'); expect(f.parent.postMessage).toHaveBeenCalledTimes(1);
    safe = true; bridge.recover('a'.repeat(65537)); expect(f.parent.postMessage).toHaveBeenCalledTimes(1);
    f.send({ ...hello, type: 'restore', requestId: crypto.randomUUID(), draft: 'a'.repeat(65537) });
    expect(restore).not.toHaveBeenCalled(); bridge.dispose();
  });
  it('handles only a matching error and times out safely after 20 seconds', () => {
    vi.useFakeTimers();
    try {
      const f = frame(); const bridge = createRecoveryBridge(f.win, vi.fn(), () => true); bridge.start();
      expect(f.parent.postMessage).toHaveBeenCalledTimes(1);
    const hello = f.parent.postMessage.mock.calls[0][0]; f.send({ ...hello, type: 'available' }); bridge.recover('draft');
      const request = f.parent.postMessage.mock.calls[1][0];
      f.send({ ...hello, type: 'error', requestId: 'stale', message: 'secret' });
      expect(bridge.getSnapshot().recovering).toBe(true);
      f.send({ ...hello, type: 'error', requestId: request.requestId });
      expect(bridge.getSnapshot()).toMatchObject({ recovering: false, error: expect.stringContaining('草稿') });
      bridge.recover('draft'); vi.advanceTimersByTime(20_000);
      expect(bridge.getSnapshot()).toMatchObject({ recovering: false, error: expect.stringContaining('草稿') });
      bridge.dispose();
    } finally { vi.useRealTimers(); }
  });
  it('does not advertise a recovery adapter in the top-level raw entry', () => {
    const post = vi.spyOn(window, 'postMessage'); const bridge = createRecoveryBridge(window, vi.fn(), () => true); bridge.start();
    expect(post).not.toHaveBeenCalled(); expect(bridge.getSnapshot().available).toBe(false); bridge.dispose();
  });
  it('uses distinct document nonces and ignores malformed or replayed restore envelopes', () => {
    const f = frame(); const restore = vi.fn(); const bridge = createRecoveryBridge(f.win, restore, () => true); bridge.start();
    expect(f.parent.postMessage).toHaveBeenCalledTimes(1); const hello = f.parent.postMessage.mock.calls[0][0];
    f.send({ ...hello, type: 'available' });
    const message = { ...hello, type: 'restore', requestId: crypto.randomUUID(), draft: 'valid' };
    f.send(message, f.win); f.send(message, f.parent, 'https://evil.example');
    f.send({ ...message, documentId: crypto.randomUUID() }); f.send({ ...message, requestId: 'a'.repeat(129) });
    f.send({ ...message, draft: {} }); f.send({ ...message, uncertain: false });
    expect(restore).not.toHaveBeenCalled(); bridge.dispose();
    const another = createRecoveryBridge(f.win, restore, () => true); another.start();
    expect(f.parent.postMessage.mock.calls.at(-1)![0].documentId).not.toBe(hello.documentId); another.dispose();
  });
});
