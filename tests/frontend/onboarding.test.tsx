import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AnnaRuntime } from '../../src/anna/types';
import { UsageGuide } from '../../src/components/UsageGuide';

const GUIDE_KEY = 'mini-notes:onboarding:v1';
const SEEN = { schemaVersion: 1, seenGuideVersion: 1 };
const TITLE = '开始使用 Mini Notes';
const PRIMARY = '开始使用（无需配置模型）';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function guideHost(initial: unknown = null) {
  const values = new Map<string, unknown>([
    [GUIDE_KEY, initial],
    ['mini-notes:notes:v1', { notes: ['untouched'] }],
  ]);
  const storage = {
    get: vi.fn(async ({ key }: { key: string }) => ({ value: values.get(key) })),
    set: vi.fn(async ({ key, value }: { key: string; value: unknown }): Promise<unknown> => {
      values.set(key, value);
      return { ok: true };
    }),
  };
  const runtime: AnnaRuntime = { storage, tools: { invoke: vi.fn() } };
  return { runtime, storage, values };
}

async function flush() {
  await act(async () => { for (let index = 0; index < 8; index++) await Promise.resolve(); });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('independent usage guide', () => {
  it('opens for a missing Host marker and immediately dismisses before saving its own versioned key', async () => {
    const h = guideHost();
    const localGet = vi.spyOn(Storage.prototype, 'getItem');
    const localSet = vi.spyOn(Storage.prototype, 'setItem');
    render(<UsageGuide runtime={h.runtime} />);
    const dialog = await screen.findByRole('dialog', { name: TITLE });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(h.storage.get).toHaveBeenCalledExactlyOnceWith({ key: GUIDE_KEY });
    expect(h.storage.set).not.toHaveBeenCalled();
    const pending = deferred<unknown>();
    h.storage.set.mockImplementationOnce(() => pending.promise);
    fireEvent.click(within(dialog).getByRole('button', { name: PRIMARY }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(h.storage.set).toHaveBeenCalledExactlyOnceWith({ key: GUIDE_KEY, value: SEEN });
    expect(h.values.get('mini-notes:notes:v1')).toEqual({ notes: ['untouched'] });
    expect(h.runtime.tools.invoke).not.toHaveBeenCalled();
    expect(localGet).not.toHaveBeenCalled();
    expect(localSet).not.toHaveBeenCalled();
    await act(async () => { pending.resolve({ ok: true }); });
  });

  it('does not open for a seen marker, and offers a help button without rewriting it', async () => {
    const h = guideHost(SEEN);
    render(<UsageGuide runtime={h.runtime} />);
    await flush();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    const help = screen.getByRole('button', { name: '使用说明' });
    help.focus(); fireEvent.click(help);
    expect(screen.getByRole('dialog', { name: TITLE })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '关闭使用说明' }));
    expect(help).toHaveFocus();
    expect(h.storage.set).not.toHaveBeenCalled();
  });

  it.each([
    undefined, 'damaged', [], {}, { schemaVersion: 2, seenGuideVersion: 1 },
    { schemaVersion: 1, seenGuideVersion: 2 }, { schemaVersion: 1, seenGuideVersion: 0 },
  ].map(value => [value]))('protects unknown or damaged marker %j while retaining manual help', async value => {
    const h = guideHost(value);
    // The default argument deliberately models null; preserve undefined as a corrupt result here.
    h.values.set(GUIDE_KEY, value);
    render(<UsageGuide runtime={h.runtime} />);
    await flush();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '使用说明' }));
    fireEvent.click(screen.getByRole('button', { name: PRIMARY }));
    await flush();
    expect(h.storage.set).not.toHaveBeenCalled();
    expect(h.values.get(GUIDE_KEY)).toEqual(value);
  });

  it('allows help before a runtime is connected', () => {
    render(<UsageGuide />);
    fireEvent.click(screen.getByRole('button', { name: '使用说明' }));
    expect(screen.getByRole('dialog', { name: TITLE })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('does not automatically reopen after a pre-connection manual visit', async () => {
    const h = guideHost();
    const view = render(<UsageGuide />);
    fireEvent.click(screen.getByRole('button', { name: '使用说明' }));
    fireEvent.click(screen.getByRole('button', { name: PRIMARY }));
    view.rerender(<UsageGuide runtime={h.runtime} />);
    await flush();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(h.storage.get).toHaveBeenCalledExactlyOnceWith({ key: GUIDE_KEY });
    fireEvent.click(screen.getByRole('button', { name: '使用说明' }));
    fireEvent.click(screen.getByRole('button', { name: PRIMARY }));
    expect(h.storage.set).toHaveBeenCalledExactlyOnceWith({ key: GUIDE_KEY, value: SEEN });
  });

  it('explains the default no-llm mode and keeps the two acceptance paths independent', async () => {
    const h = guideHost();
    render(<UsageGuide runtime={h.runtime} />);
    const dialog = await screen.findByRole('dialog', { name: TITLE });
    expect(dialog).toHaveTextContent('无需账号');
    expect(dialog).toHaveTextContent('--no-llm');
    expect(dialog).toHaveTextContent('不会检测或修改 Host 配置');
    expect(dialog).toHaveTextContent('不收集 API Key');
    const details = within(dialog).getByRole('button', { name: '查看验收说明' });
    expect(details).toHaveAttribute('aria-expanded', 'false');
    expect(within(dialog).queryByText('npm run test:sampling')).not.toBeInTheDocument();
    fireEvent.click(details);
    expect(details).toHaveAttribute('aria-expanded', 'true');
    expect(within(dialog).getByText('npm run test:harness')).toBeVisible();
    expect(within(dialog).getByText('npm run test:sampling')).toBeVisible();
    expect(dialog).toHaveTextContent('官方 mock sampling');
    expect(dialog).toHaveTextContent('真实模型');
    expect(h.runtime.tools.invoke).not.toHaveBeenCalled();
  });

  it('keeps manual help usable after a rejected read and hides raw diagnostics', async () => {
    const h = guideHost();
    h.storage.get.mockRejectedValueOnce(new Error('private credential read failed'));
    render(<><textarea aria-label="笔记草稿" /><UsageGuide runtime={h.runtime} /></>);
    await flush();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('偏好未保存');
    expect(document.body).not.toHaveTextContent('private credential');
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'still editable' } });
    expect(screen.getByRole('textbox')).toHaveValue('still editable');
    fireEvent.click(screen.getByRole('button', { name: '使用说明' }));
    fireEvent.click(screen.getByRole('button', { name: PRIMARY }));
    expect(h.storage.set).not.toHaveBeenCalled();
  });

  it('bounds a hanging read and drops its late result after manual dismissal', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const h = guideHost(); const pending = deferred<{ value: unknown }>();
    h.storage.get.mockImplementationOnce(() => pending.promise);
    render(<><textarea aria-label="笔记草稿" /><UsageGuide runtime={h.runtime} /></>);
    fireEvent.click(screen.getByRole('button', { name: '使用说明' }));
    fireEvent.click(screen.getByRole('button', { name: PRIMARY }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'free to edit' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(2_500); });
    expect(screen.getByRole('status')).toHaveTextContent('偏好未保存');
    expect(screen.getByRole('textbox')).toHaveValue('free to edit');
    expect(vi.getTimerCount()).toBe(0);
    await act(async () => { pending.resolve({ value: null }); });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(h.storage.set).not.toHaveBeenCalled();
  });

  it('does not reopen when an in-flight missing-marker read arrives after manual open and dismissal', async () => {
    const h = guideHost(); const pending = deferred<{ value: unknown }>();
    h.storage.get.mockImplementationOnce(() => pending.promise);
    render(<UsageGuide runtime={h.runtime} />);
    fireEvent.click(screen.getByRole('button', { name: '使用说明' }));
    fireEvent.click(screen.getByRole('button', { name: '关闭使用说明' }));
    expect(h.storage.set).not.toHaveBeenCalled();
    await act(async () => { pending.resolve({ value: null }); });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(h.storage.set).toHaveBeenCalledExactlyOnceWith({ key: GUIDE_KEY, value: SEEN });
  });

  it('does not reopen or replace an already manually opened dialog when its read finishes', async () => {
    const h = guideHost(); const pending = deferred<{ value: unknown }>();
    h.storage.get.mockImplementationOnce(() => pending.promise);
    render(<UsageGuide runtime={h.runtime} />);
    fireEvent.click(screen.getByRole('button', { name: '使用说明' }));
    const primary = screen.getByRole('button', { name: PRIMARY });
    expect(primary).toHaveFocus();
    await act(async () => { pending.resolve({ value: null }); });
    expect(primary).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('does not overwrite a future marker returned after a manual dismissal', async () => {
    const h = guideHost(); const pending = deferred<{ value: unknown }>();
    h.storage.get.mockImplementationOnce(() => pending.promise);
    render(<UsageGuide runtime={h.runtime} />);
    fireEvent.click(screen.getByRole('button', { name: '使用说明' }));
    fireEvent.click(screen.getByRole('button', { name: PRIMARY }));
    await act(async () => { pending.resolve({ value: { schemaVersion: 2, seenGuideVersion: 1 } }); });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(h.storage.set).not.toHaveBeenCalled();
  });

  it('closes before a write rejection and reports only a safe preference message', async () => {
    const h = guideHost(); const pending = deferred<unknown>();
    h.storage.set.mockImplementationOnce(() => pending.promise);
    render(<UsageGuide runtime={h.runtime} />);
    await screen.findByRole('dialog', { name: TITLE });
    fireEvent.click(screen.getByRole('button', { name: PRIMARY }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await act(async () => { pending.reject(new Error('secret raw host payload')); });
    expect(screen.getByRole('status')).toHaveTextContent('偏好未保存');
    expect(document.body).not.toHaveTextContent('secret raw host payload');
    fireEvent.click(screen.getByRole('button', { name: '使用说明' }));
    expect(screen.getByRole('dialog', { name: TITLE })).toBeInTheDocument();
  });

  it('bounds a hanging write without blocking help or launching overlapping writes', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const h = guideHost(); const pending = deferred<unknown>();
    h.storage.set.mockImplementationOnce(() => pending.promise);
    render(<UsageGuide runtime={h.runtime} />);
    await flush();
    fireEvent.click(screen.getByRole('button', { name: PRIMARY }));
    fireEvent.click(screen.getByRole('button', { name: '使用说明' }));
    fireEvent.click(screen.getByRole('button', { name: PRIMARY }));
    expect(h.storage.set).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(2_500); });
    expect(screen.getByRole('status')).toHaveTextContent('偏好未保存');
    expect(vi.getTimerCount()).toBe(0);
    await act(async () => { pending.resolve({ ok: true }); });
    expect(screen.getByRole('status')).toHaveTextContent('偏好未保存');
  });

  it('discards old runtime read results and uses only the replacement runtime marker', async () => {
    const first = guideHost(); const second = guideHost(SEEN);
    const pending = deferred<{ value: unknown }>();
    first.storage.get.mockImplementationOnce(() => pending.promise);
    const view = render(<UsageGuide runtime={first.runtime} />);
    view.rerender(<UsageGuide runtime={second.runtime} />);
    await flush();
    await act(async () => { pending.resolve({ value: null }); });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(first.storage.set).not.toHaveBeenCalled();
    expect(second.storage.get).toHaveBeenCalledExactlyOnceWith({ key: GUIDE_KEY });
  });

  it('drops an old write error after a runtime switch', async () => {
    const first = guideHost(); const second = guideHost(SEEN);
    const pending = deferred<unknown>(); first.storage.set.mockImplementationOnce(() => pending.promise);
    const view = render(<UsageGuide runtime={first.runtime} />);
    await screen.findByRole('dialog', { name: TITLE });
    fireEvent.click(screen.getByRole('button', { name: PRIMARY }));
    view.rerender(<UsageGuide runtime={second.runtime} />);
    await act(async () => { pending.reject(new Error('old runtime write failed')); });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(second.storage.set).not.toHaveBeenCalled();
  });

  it.each(['read', 'write'])('clears pending %s timers and ignores completion after unmount', async phase => {
    // jsdom schedules selectionchange with setImmediate when modal focus changes.
    // Fake only our storage timers so this assertion measures request cleanup.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const h = guideHost(); const read = deferred<{ value: unknown }>(); const write = deferred<unknown>();
    if (phase === 'read') h.storage.get.mockImplementationOnce(() => read.promise);
    else h.storage.set.mockImplementationOnce(() => write.promise);
    const view = render(<UsageGuide runtime={h.runtime} />);
    if (phase === 'write') {
      await flush();
      fireEvent.click(screen.getByRole('button', { name: PRIMARY }));
    }
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
    await act(async () => { read.resolve({ value: null }); if (phase === 'write') write.reject(new Error('late write')); });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(h.storage.set).toHaveBeenCalledTimes(phase === 'write' ? 1 : 0);
  });

  it('traps keyboard and programmatic focus, closes with Escape, and restores the opener and body scroll', async () => {
    const h = guideHost(SEEN);
    render(<><button type="button">外部操作</button><UsageGuide runtime={h.runtime} /></>);
    await flush();
    const help = screen.getByRole('button', { name: '使用说明' });
    help.focus(); fireEvent.click(help);
    const dialog = screen.getByRole('dialog', { name: TITLE });
    const first = within(dialog).getByRole('button', { name: '关闭使用说明' });
    const last = within(dialog).getByRole('button', { name: '查看验收说明' });
    expect(within(dialog).getByRole('button', { name: PRIMARY })).toHaveFocus();
    expect(document.body.style.overflow).toBe('hidden');
    last.focus(); fireEvent.keyDown(last, { key: 'Tab' });
    expect(first).toHaveFocus();
    fireEvent.keyDown(first, { key: 'Tab', shiftKey: true });
    expect(last).toHaveFocus();
    screen.getByRole('button', { name: '外部操作' }).focus();
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(help).toHaveFocus();
    expect(document.body.style.overflow).toBe('');
  });

  it('dismisses on the backdrop while clicks within the dialog stay open', async () => {
    const h = guideHost(); render(<UsageGuide runtime={h.runtime} />);
    const dialog = await screen.findByRole('dialog', { name: TITLE });
    fireEvent.click(within(dialog).getByRole('heading', { name: TITLE }));
    expect(dialog).toBeInTheDocument();
    fireEvent.click(dialog.parentElement!);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('restores scroll and releases focus capture when an open guide is unmounted', async () => {
    const h = guideHost();
    render(<button type="button">保留的外部操作</button>);
    const external = screen.getByRole('button', { name: '保留的外部操作' });
    external.focus();
    const view = render(<UsageGuide runtime={h.runtime} />);
    await screen.findByRole('dialog', { name: TITLE });
    expect(document.body.style.overflow).toBe('hidden');
    view.unmount();
    expect(document.body.style.overflow).toBe('');
    expect(external).toHaveFocus();
    external.blur(); external.focus();
    expect(external).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(h.storage.set).not.toHaveBeenCalled();
  });
});
