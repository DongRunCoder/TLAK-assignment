import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MiniNotesApp } from '../../src/components/MiniNotesApp';
import { useMiniNotes } from '../../src/notes/useMiniNotes';
import { deferred, doc, flush, host, notesGetCount } from './helpers';
import { RECOVERY_CHANNEL } from '../../src/anna/recoveryBridge';
import { NotesRepository } from '../../src/notes/repository';

afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });
const expired = () => ({ code: 'transport', message: '[-32602] unknown session_id: sess-SECRET' });

describe('Host session loss in the app', () => {
  it('retains an actual SDK storage.set timeout as an unknown write until confirmation', async () => {
    const h = host(); const repo = new NotesRepository(h.runtime); await repo.refresh();
    h.storage.set.mockRejectedValueOnce(new Error('RPC storage.set timed out after 30000ms (pass { timeoutMs } as the 2nd arg to override)'));
    let complete = false; void repo.add('SDK timeout draft').then(() => { complete = true; }); await flush();
    expect(repo.getSnapshot()).toMatchObject({ mutation: 'save', status: 'reconciling' }); expect(complete).toBe(false);
    expect(h.storage.set).toHaveBeenCalledOnce(); repo.dispose();
  });
  it.each(['transport', 'invalid_params', -32602])('keeps actual unknown-session Host set failures uncertain even with code %s', async code => {
    const h = host(); const repo = new NotesRepository(h.runtime); await repo.refresh();
    h.storage.set.mockRejectedValueOnce({ code, message: '[-32602] unknown session_id: sess-1' });
    let completed = false; void repo.add('unknown write').then(() => { completed = true; }); await flush();
    expect(repo.getSnapshot()).toMatchObject({ mutation: 'save', status: 'reconciling' });
    expect(completed).toBe(false); expect(h.storage.set).toHaveBeenCalledOnce();
    await expect(repo.add('do not replay')).rejects.toThrow();
    expect(h.storage.set).toHaveBeenCalledOnce(); repo.dispose();
  });
  it('shows checking until a real read succeeds and does not reset a failed expired handshake in the same document', async () => {
    const pending = deferred<{ value: unknown }>(); const h = host(); h.storage.get.mockImplementation(() => pending.promise);
    const connection = { connect: async () => h.runtime }; render(<MiniNotesApp connection={connection} />);
    await act(flush); expect(screen.getByText('正在检查 Anna…')).toBeInTheDocument(); expect(screen.queryByText('Anna 已连接')).not.toBeInTheDocument();
    cleanup();
    render(<MiniNotesApp connection={{ connect: async () => { throw expired(); } }} />);
    await screen.findByText('会话已失效');
    expect(screen.queryByRole('button', { name: '重试连接' })).not.toBeInTheDocument();
  });
  function adapter() {
    const original = window.parent; const parent = { postMessage: vi.fn() };
    Object.defineProperty(window, 'parent', { configurable: true, value: parent });
    const send = (data: unknown) => act(() => { window.dispatchEvent(new MessageEvent('message', { data, source: parent as unknown as Window, origin: location.origin })); });
    return { parent, send, restore: () => Object.defineProperty(window, 'parent', { configurable: true, value: original }) };
  }
  it('shows a manual recovery action only with adapter capability and unlocks the original draft on safe failure', async () => {
    const f = adapter();
    try {
      const h = host(); const connection = { connect: async () => h.runtime }; render(<MiniNotesApp connection={connection} />);
      await screen.findByText('Anna 已连接');
      expect(f.parent.postMessage).toHaveBeenCalledWith(expect.objectContaining({ channel: RECOVERY_CHANNEL, type: 'hello' }), location.origin);
      const hello = f.parent.postMessage.mock.calls[0][0]; f.send({ ...hello, type: 'available' });
      fireEvent.change(screen.getByRole('textbox'), { target: { value: 'retain draft' } });
      h.storage.get.mockRejectedValueOnce(expired()); fireEvent.click(screen.getByRole('button', { name: '重新读取' }));
      const recover = await screen.findByRole('button', { name: '保留草稿并恢复会话' });
      expect(recover).toHaveAccessibleDescription(/旧会话.*其他标签页/);
      expect(f.parent.postMessage).toHaveBeenCalledTimes(1);
      fireEvent.click(recover);
      const request = f.parent.postMessage.mock.calls[1][0];
      expect(request).toMatchObject({ type: 'recover', draft: 'retain draft', uncertain: false });
      expect(screen.getByRole('textbox')).toHaveAttribute('readonly'); expect(recover).toBeDisabled();
      f.send({ channel: RECOVERY_CHANNEL, type: 'error', documentId: hello.documentId, requestId: request.requestId });
      expect(screen.getByRole('textbox')).toHaveValue('retain draft'); expect(screen.getByRole('textbox')).not.toHaveAttribute('readonly');
      expect(screen.getByText(/恢复会话未完成/)).toBeInTheDocument(); expect(recover).toBeEnabled();
      expect(h.storage.set).not.toHaveBeenCalled();
    } finally { cleanup(); f.restore(); }
  });
  it('applies restored text before acknowledging it and never automatically saves it', async () => {
    const f = adapter();
    try {
      const h = host(); const connection = { connect: async () => h.runtime }; render(<MiniNotesApp connection={connection} />);
      await screen.findByText('Anna 已连接');
      expect(f.parent.postMessage).toHaveBeenCalledTimes(1);
      const hello = f.parent.postMessage.mock.calls[0][0]; f.send({ ...hello, type: 'available' });
      f.parent.postMessage.mockImplementation(message => {
        if (message.type === 'restored') expect(screen.getByRole('textbox')).toHaveValue('returned draft');
      });
      f.send({ ...hello, type: 'restore', requestId: crypto.randomUUID(), draft: 'returned draft' });
      await waitFor(() => expect(f.parent.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'restored' }), location.origin));
      expect(screen.getByRole('textbox')).toHaveValue('returned draft'); expect(h.storage.set).not.toHaveBeenCalled();
    } finally { cleanup(); f.restore(); }
  });
  it('keeps a conflicting handoff visible until the user clears current input and explicitly retrieves it', async () => {
    const f = adapter();
    try {
      const h = host(); const connection = { connect: async () => h.runtime }; render(<MiniNotesApp connection={connection} />);
      await screen.findByText('Anna 已连接');
      expect(f.parent.postMessage).toHaveBeenCalledTimes(1); const hello = f.parent.postMessage.mock.calls[0][0]; f.send({ ...hello, type: 'available' });
      fireEvent.change(screen.getByRole('textbox'), { target: { value: 'new typing' } });
      f.send({ ...hello, type: 'restore', requestId: crypto.randomUUID(), draft: 'older recovery draft' });
      expect(screen.getByRole('textbox')).toHaveValue('new typing'); expect(f.parent.postMessage).toHaveBeenCalledTimes(1);
      expect(screen.getByText(/有一份恢复草稿待取回/)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: '取回恢复草稿' })).toBeDisabled(); expect(screen.getByRole('button', { name: '复制草稿' })).toBeEnabled();
      h.storage.get.mockRejectedValueOnce(expired()); fireEvent.click(screen.getByRole('button', { name: '重新读取' })); await screen.findByText('会话已失效');
      expect(screen.getByRole('button', { name: '保留草稿并恢复会话' })).toBeDisabled();
      fireEvent.change(screen.getByRole('textbox'), { target: { value: '' } });
      fireEvent.click(screen.getByRole('button', { name: '取回恢复草稿' }));
      expect(screen.getByRole('textbox')).toHaveValue('older recovery draft');
      await waitFor(() => expect(f.parent.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'restored' }), location.origin));
      expect(screen.queryByText(/有一份恢复草稿待取回/)).not.toBeInTheDocument(); expect(h.storage.set).not.toHaveBeenCalled();
    } finally { cleanup(); f.restore(); }
  });
  it('retains an incoming handoff during an unknown mutation without acknowledging or allowing recovery', async () => {
    const f = adapter();
    try {
      const h = host(); const connection = { connect: async () => h.runtime }; render(<MiniNotesApp connection={connection} />); await screen.findByText('Anna 已连接');
      expect(f.parent.postMessage).toHaveBeenCalledTimes(1); const hello = f.parent.postMessage.mock.calls[0][0]; f.send({ ...hello, type: 'available' });
      fireEvent.change(screen.getByRole('textbox'), { target: { value: 'uncertain draft' } });
      h.storage.set.mockRejectedValueOnce(expired()); fireEvent.click(screen.getByRole('button', { name: '保存笔记' })); await screen.findByText('会话已失效');
      f.send({ ...hello, type: 'restore', requestId: crypto.randomUUID(), draft: 'incoming handoff' });
      expect(screen.getByText(/有一份恢复草稿待取回/)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: '取回恢复草稿' })).toBeDisabled();
      expect(screen.getByRole('button', { name: '保留草稿并恢复会话' })).toBeDisabled();
      expect(screen.getByRole('textbox')).toHaveValue('uncertain draft'); expect(f.parent.postMessage).toHaveBeenCalledTimes(1);
    } finally { cleanup(); f.restore(); }
  });
  it('keeps recovery failure feedback visible when the old Host becomes reachable during the recovery request', async () => {
    const f = adapter();
    try {
      const h = host(); const connection = { connect: async () => h.runtime }; render(<MiniNotesApp connection={connection} />); await screen.findByText('Anna 已连接');
      expect(f.parent.postMessage).toHaveBeenCalledTimes(1); const hello = f.parent.postMessage.mock.calls[0][0]; f.send({ ...hello, type: 'available' });
      fireEvent.change(screen.getByRole('textbox'), { target: { value: 'retain draft' } });
      h.storage.get.mockRejectedValueOnce({ code: 'transport', message: 'socket lost' }); fireEvent.click(screen.getByRole('button', { name: '重新读取' }));
      fireEvent.click(await screen.findByRole('button', { name: '保留草稿并恢复会话' })); const request = f.parent.postMessage.mock.calls[1][0];
      fireEvent.click(screen.getByRole('button', { name: '重新读取' })); await screen.findByText('Anna 已连接');
      expect(screen.getByText('正在恢复会话并交还草稿…')).toBeInTheDocument();
      f.send({ ...hello, type: 'error', requestId: request.requestId });
      expect(screen.getByText(/恢复会话未完成/)).toBeInTheDocument(); expect(screen.getByRole('textbox')).not.toHaveAttribute('readonly');
      expect(screen.getByRole('textbox')).toHaveValue('retain draft');
    } finally { cleanup(); f.restore(); }
  });
  it('blocks recovery while an expired write is reconciling and permits copying without exposing diagnostics', async () => {
    const f = adapter();
    try {
      const h = host(); const connection = { connect: async () => h.runtime }; render(<MiniNotesApp connection={connection} />); await screen.findByText('Anna 已连接');
      expect(f.parent.postMessage).toHaveBeenCalledTimes(1); const hello = f.parent.postMessage.mock.calls[0][0]; f.send({ ...hello, type: 'available' });
      fireEvent.change(screen.getByRole('textbox'), { target: { value: 'uncertain draft' } });
      h.storage.set.mockRejectedValueOnce(expired()); fireEvent.click(screen.getByRole('button', { name: '保存笔记' }));
      await screen.findByText('会话已失效');
      expect(screen.getByRole('button', { name: '保留草稿并恢复会话' })).toBeDisabled();
      expect(screen.getByText(/写入结果尚未确认，暂不能恢复会话/)).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: '保留草稿并恢复会话' }));
      expect(f.parent.postMessage).toHaveBeenCalledTimes(1);
      fireEvent.click(screen.getByRole('button', { name: '复制草稿' }));
      await screen.findByText(/Ctrl\+C/);
      expect(screen.getByRole('textbox')).toHaveFocus(); expect(screen.getByRole('textbox')).toHaveValue('uncertain draft');
      expect(document.body.textContent).not.toContain('sess-SECRET');
    } finally { cleanup(); f.restore(); }
  });
  it('disables CRUD and summary on expiry while keeping an editable copyable draft and hiding raw session IDs', async () => {
    const h = host(doc()); const connection = { connect: async () => h.runtime };
    render(<MiniNotesApp connection={connection} />);
    await screen.findByText('Anna 已连接');
    fireEvent.change(screen.getByRole('textbox', { name: '笔记内容' }), { target: { value: 'keep me' } });
    h.storage.get.mockRejectedValueOnce(expired());
    fireEvent.click(screen.getByRole('button', { name: '重新读取' }));
    await screen.findByText('会话已失效');
    expect(screen.getByRole('button', { name: '保存笔记' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '删除笔记 1' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Summarize' })).toBeDisabled();
    expect(screen.getByRole('textbox')).not.toHaveAttribute('readonly');
    expect(screen.getByRole('textbox')).toHaveValue('keep me');
    expect(screen.getByRole('button', { name: '复制草稿' })).toBeEnabled();
    expect(document.body.textContent).not.toContain('sess-SECRET');
    expect(screen.queryByRole('button', { name: '保留草稿并恢复会话' })).not.toBeInTheDocument();
    expect(screen.getByText(/手动重新打开/)).toBeInTheDocument();
    h.storage.get.mockResolvedValueOnce({ value: doc() });
    fireEvent.click(screen.getByRole('button', { name: '重新读取' }));
    await act(flush);
    expect(screen.getByText('会话已失效')).toBeInTheDocument();
    expect(h.storage.set).not.toHaveBeenCalled();
  });
  it('marks a transport outage unavailable, recovers with a read, and rejects stale action callbacks', async () => {
    const h = host(doc()); const connection = { connect: async () => h.runtime };
    const { result } = renderHook(() => useMiniNotes(connection));
    await waitFor(() => expect(result.current.snapshot.status).toBe('ready'));
    act(() => result.current.changeComposer('draft'));
    const save = result.current.save; const summarize = result.current.summarize;
    h.storage.get.mockRejectedValueOnce({ code: 'transport', message: 'socket closed' });
    await act(async () => { await result.current.reread(); });
    expect(result.current.hostStatus).toBe('unavailable');
    await act(async () => { await save(); await summarize(); });
    expect(h.storage.set).not.toHaveBeenCalled(); expect(h.runtime.tools.invoke).not.toHaveBeenCalled();
    await act(async () => { await result.current.reread(); });
    expect(result.current.hostStatus).toBe('online');
    expect(result.current.composer).toBe('draft');
  });
  it('preserves the draft and releases an operation that was blocked before Host set was sent', async () => {
    const h = host(); const connection = { connect: async () => h.runtime };
    const { result } = renderHook(() => useMiniNotes(connection));
    await waitFor(() => expect(result.current.snapshot.status).toBe('ready'));
    act(() => result.current.changeComposer('keep'));
    const prewrite = deferred<{ value: unknown }>(); h.storage.get.mockImplementationOnce(() => prewrite.promise);
    let operation!: Promise<void>;
    act(() => { operation = result.current.save(); }); await act(flush);
    // A separate observed tool call discovers expiry while the prewrite read
    // is still in flight. Its subsequent success cannot re-authorize a write.
    h.runtime.tools.invoke = vi.fn().mockRejectedValue(expired());
    await act(async () => { await result.current.anna!.tools.invoke({ tool_id: 't', method: 'm', args: {}, timeoutMs: 1 }).catch(() => {}); });
    await act(async () => { prewrite.resolve({ value: null }); await operation; });
    expect(h.storage.set).not.toHaveBeenCalled(); expect(result.current.composer).toBe('keep');
    expect(result.current.snapshot.mutation).toBeNull(); expect(result.current.hostStatus).toBe('expired');
  });
  it('keeps the original draft when a dispatched save resolves after session expiry', async () => {
    const h = host(); const connection = { connect: async () => h.runtime };
    const { result } = renderHook(() => useMiniNotes(connection)); await waitFor(() => expect(result.current.snapshot.status).toBe('ready'));
    const write = deferred<unknown>(); h.storage.set.mockImplementationOnce(() => write.promise);
    act(() => result.current.changeComposer('retain late save'));
    let operation!: Promise<void>; act(() => { operation = result.current.save(); });
    await waitFor(() => expect(h.storage.set).toHaveBeenCalledOnce());
    h.runtime.tools.invoke = vi.fn().mockRejectedValue(expired());
    await act(async () => { await result.current.anna!.tools.invoke({ tool_id: 't', method: 'm', args: {}, timeoutMs: 1 }).catch(() => {}); });
    await act(async () => { write.resolve({ ok: true }); await operation; });
    expect(result.current.composer).toBe('retain late save'); expect(result.current.hostStatus).toBe('expired');
  });
  it('invalidates a running summary and ignores its late success after session expiry', async () => {
    const h = host(doc()); const summary = deferred<unknown>(); h.runtime.tools.invoke = vi.fn(() => summary.promise);
    const connection = { connect: async () => h.runtime }; const { result } = renderHook(() => useMiniNotes(connection));
    await waitFor(() => expect(result.current.snapshot.status).toBe('ready'));
    let operation!: Promise<void>;
    act(() => { operation = result.current.summarize(); });
    await waitFor(() => expect(h.runtime.tools.invoke).toHaveBeenCalledOnce());
    h.storage.get.mockRejectedValueOnce(expired());
    await act(async () => { await result.current.reread(); });
    await act(async () => { summary.resolve({ summary: 'late result' }); await operation; });
    expect(result.current.hostStatus).toBe('expired');
    expect(result.current.summary).toMatchObject({ status: 'stale', running: false });
    expect(result.current.summary.result).toBeUndefined();
  });
  it('checks visible pages every 15 seconds and on focus/visibility, using only Host reads', async () => {
    vi.useFakeTimers();
    const h = host(); const connection = { connect: async () => h.runtime };
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    renderHook(() => useMiniNotes(connection)); await act(flush);
    expect(notesGetCount(h)).toBe(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    expect(notesGetCount(h)).toBe(2);
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); window.dispatchEvent(new Event('focus')); await flush(); });
    expect(notesGetCount(h)).toBe(2);
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); await flush(); });
    expect(notesGetCount(h)).toBe(3);
    await act(async () => { window.dispatchEvent(new Event('focus')); await flush(); });
    expect(notesGetCount(h)).toBe(4);
    expect(h.storage.set).not.toHaveBeenCalled(); expect(h.runtime.tools.invoke).not.toHaveBeenCalled();
    cleanup(); await vi.advanceTimersByTimeAsync(30_000); expect(notesGetCount(h)).toBe(4);
  });
});
