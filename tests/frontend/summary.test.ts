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
});
