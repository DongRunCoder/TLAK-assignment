import { describe, expect, it } from 'vitest';
import { classifySessionError, HostSession } from '../../src/anna/session';
import { deferred, host } from './helpers';

describe('observed Anna Host session', () => {
  it.each([
    { code: 'transport', message: '[-32602] unknown session_id: sess-1' },
    { code: -32602, message: 'unknown session_id: sess-1' },
    { code: 'invalid_params', message: '[-32602] unknown session_id: sess-1' },
    new Error('unknown session_id: sess-1'),
  ])('recognizes bounded exact unknown-session diagnostics: %j', error => {
    expect(classifySessionError(error)).toBe('expired');
  });
  it.each([
    { code: -32602, message: 'invalid arguments' },
    new Error('SAMPLING_HOST_ERROR: [-32602] unknown session_id: sess-1'),
    { code: 'llm_error', message: 'unknown session_id: sess-1' },
    new Error('prefix unknown session_id: sess-1'),
    new Error(`unknown session_id: ${'a'.repeat(1024)}`),
    new Error('RPC llm.complete timed out after 30000ms (pass { timeoutMs } as the 2nd arg to override)'),
    new Error('SAMPLING_HOST_ERROR: RPC storage.get timed out after 30000ms (pass { timeoutMs } as the 2nd arg to override)'),
    new Error(`RPC storage.get timed out after ${'1'.repeat(300)}ms (pass { timeoutMs } as the 2nd arg to override)`),
  ])('does not misclassify parameter or LLM failures: %j', error => {
    expect(classifySessionError(error)).toBeNull();
  });
  it.each(['storage.get', 'storage.set', 'tools.invoke'])('recognizes the exact SDK %s timeout envelope', method => {
    expect(classifySessionError(new Error(`RPC ${method} timed out after 30000ms (pass { timeoutMs } as the 2nd arg to override)`))).toBe('unavailable');
  });
  it('blocks new writes on a real SDK timeout until another Host read succeeds', async () => {
    const h = host(); const session = new HostSession(); const runtime = session.observe(h.runtime);
    await runtime.storage.get({ key: 'notes' });
    h.storage.get.mockRejectedValueOnce(new Error('RPC storage.get timed out after 30000ms (pass { timeoutMs } as the 2nd arg to override)'));
    await runtime.storage.get({ key: 'notes' }).catch(() => {}); expect(session.getStatus()).toBe('unavailable');
    await expect(runtime.storage.set({ key: 'notes', value: null })).rejects.toThrow(); expect(h.storage.set).not.toHaveBeenCalled();
    await runtime.storage.get({ key: 'notes' }); expect(session.getStatus()).toBe('online');
  });
  it('requires a successful Host read, recovers from transport loss, and latches expiry against late responses', async () => {
    const h = host(); const session = new HostSession(); const runtime = session.observe(h.runtime);
    expect(session.getStatus()).toBe('checking');
    await runtime.storage.get({ key: 'notes' }); expect(session.getStatus()).toBe('online');
    h.storage.get.mockRejectedValueOnce({ code: 'transport', message: 'connection closed' });
    await runtime.storage.get({ key: 'notes' }).catch(() => {});
    expect(session.getStatus()).toBe('unavailable');
    h.runtime.tools.invoke = async () => ({ summary: 'ok' });
    await runtime.tools.invoke({ tool_id: 't', method: 'm', args: {}, timeoutMs: 1 }).catch(() => {});
    expect(session.getStatus()).toBe('unavailable');
    await runtime.storage.get({ key: 'notes' }); expect(session.getStatus()).toBe('online');
    const late = deferred<{ value: unknown }>(); h.storage.get.mockImplementationOnce(() => late.promise);
    const pending = runtime.storage.get({ key: 'notes' });
    h.storage.get.mockRejectedValueOnce({ code: 'transport', message: '[-32602] unknown session_id: sess-1' });
    await runtime.storage.get({ key: 'notes' }).catch(() => {});
    late.resolve({ value: null }); await pending;
    expect(session.getStatus()).toBe('expired');
  });
  it('prevents a late successful pre-write read from dispatching new writes or tool calls into an expired session', async () => {
    const h = host(); const session = new HostSession(); const runtime = session.observe(h.runtime);
    await runtime.storage.get({ key: 'notes' });
    session.fail({ code: 'transport', message: '[-32602] unknown session_id: sess-1' });
    await expect(runtime.storage.set({ key: 'notes', value: null })).rejects.toThrow();
    await expect(runtime.tools.invoke({ tool_id: 't', method: 'm', args: {}, timeoutMs: 1 })).rejects.toThrow();
    expect(h.storage.set).not.toHaveBeenCalled(); expect(h.runtime.tools.invoke).not.toHaveBeenCalled();
    await runtime.storage.get({ key: 'notes' }); expect(session.getStatus()).toBe('expired');
  });
});
