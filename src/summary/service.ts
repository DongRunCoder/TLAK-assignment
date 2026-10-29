import type { AnnaRuntime } from '../anna/types';
import { SUMMARY_METHOD, TOOL_ID } from '../anna/constants';
import { parseDocument, type NotesDocument } from '../notes/model';

export interface SummaryResult { text: string; truncated: boolean; stopReason?: string }
export async function summarizeNotes(runtime: AnnaRuntime, snapshot: NotesDocument): Promise<SummaryResult> {
  const document = parseDocument(snapshot);
  if (!document.notes.length) throw new Error('请先保存至少一条笔记');
  const data = await runtime.tools.invoke({ tool_id: TOOL_ID, method: SUMMARY_METHOD,
    args: { notes: document.notes.map(note => note.content) }, timeoutMs: 60_000 }, { timeoutMs: 65_000 });
  if (typeof data !== 'object' || data === null || !('summary' in data) || typeof data.summary !== 'string' || !data.summary.trim()) {
    throw new Error('总结工具返回了无效的 summary 文本，请重试');
  }
  if (Array.from(data.summary).some(point => point.length === 1 && /[\ud800-\udfff]/.test(point))) throw new Error('总结工具返回了无效 Unicode 文本');
  return { text: data.summary, truncated: 'truncated' in data && data.truncated === true,
    ...('stopReason' in data && typeof data.stopReason === 'string' ? { stopReason: data.stopReason } : {}) };
}
