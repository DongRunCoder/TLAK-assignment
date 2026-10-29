import { describe, expect, it, vi } from 'vitest';
import { summarizeNotes } from '../../src/summary/service';
import { host, doc, note } from './helpers';

describe('Executa summary adapter', () => {
  it('sends ordered original content and consumes the SDK direct business payload', async () => {
    const h = host();
    h.runtime.tools.invoke = vi.fn().mockResolvedValue({ summary: ' Host\nsummary <script> ', stopReason: 'maxTokens', truncated: true });
    const result = await summarizeNotes(h.runtime, doc([note(2, '  second \n'), note(1, 'first')], 2, 3));
    expect(h.runtime.tools.invoke).toHaveBeenCalledWith({ tool_id: 'mini-notes-summarizer', method: 'summarize',
      args: { notes: ['first', '  second \n'] }, timeoutMs: 60_000 }, { timeoutMs: 65_000 });
    expect(result).toEqual({ text: ' Host\nsummary <script> ', truncated: true, stopReason: 'maxTokens' });
  });
  it('propagates host failures and rejects empty or envelope-shaped results without fallback', async () => {
    const h = host();
    for (const result of [{ summary: '  ' }, { data: { summary: 'wrong shape' } }, { summary: 4 }, null]) {
      h.runtime.tools.invoke = vi.fn().mockResolvedValue(result);
      await expect(summarizeNotes(h.runtime, doc())).rejects.toThrow();
    }
    h.runtime.tools.invoke = vi.fn().mockRejectedValue(new Error('[-32603] harness started with --no-llm'));
    await expect(summarizeNotes(h.runtime, doc())).rejects.toThrow('harness started with --no-llm');
  });
  it('does not invoke a tool for an empty snapshot', async () => {
    const h = host();
    await expect(summarizeNotes(h.runtime, doc([], 0, 1))).rejects.toThrow();
    expect(h.runtime.tools.invoke).not.toHaveBeenCalled();
  });
  it('enforces UTF-8 summary and stop reason limits while retaining exact valid text', async () => {
    const h = host();
    const boundary = '😀'.repeat(4096);
    h.runtime.tools.invoke = vi.fn().mockResolvedValue({ summary: boundary, stopReason: 'x'.repeat(64) });
    await expect(summarizeNotes(h.runtime, doc())).resolves.toMatchObject({ text: boundary, stopReason: 'x'.repeat(64) });
    for (const result of [
      { summary: boundary + 'a' },
      { summary: 'a'.repeat(16385) },
      { summary: 'valid', stopReason: 'x'.repeat(65) },
      { summary: 'valid', stopReason: '😀'.repeat(17) },
      { summary: 'valid', stopReason: '\ud800' },
    ]) {
      h.runtime.tools.invoke = vi.fn().mockResolvedValue(result);
      await expect(summarizeNotes(h.runtime, doc())).rejects.toThrow();
    }
  });
  it('keeps only the exact no-llm host failure identifiable and omits sensitive diagnostics', async () => {
    const h = host();
    h.runtime.tools.invoke = vi.fn().mockRejectedValue(new Error('SAMPLING_HOST_ERROR: [-32603] harness started with --no-llm'));
    await expect(summarizeNotes(h.runtime, doc())).rejects.toMatchObject({ kind: 'no-llm' });
    for (const message of [
      'SAMPLING_HOST_ERROR: [-32603] provider unavailable API_KEY=SECRET_CANARY',
      'SAMPLING_HOST_ERROR: [-32603] harness started with --no-llm token=SECRET_CANARY',
      'Unknown transport failed Bearer SECRET_CANARY',
    ]) {
      h.runtime.tools.invoke = vi.fn().mockRejectedValue(new Error(message));
      const error = await summarizeNotes(h.runtime, doc()).catch(value => value as Error & { kind?: string });
      expect(error).toBeInstanceOf(Error);
      expect((error as Error & { kind?: string }).kind).not.toBe('no-llm');
      expect((error as Error).message).not.toContain('SECRET_CANARY');
      expect((error as Error).message.length).toBeLessThan(512);
    }
  });
});
