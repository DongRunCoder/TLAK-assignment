import type { AnnaRuntime } from '../anna/types';
import { SUMMARY_METHOD, TOOL_ID } from '../anna/constants';
import { parseDocument, utf8Bytes, type NotesDocument } from '../notes/model';
import { safeSummaryError } from './errors';

export const MAX_SUMMARY_BYTES = 16_384;
export const MAX_STOP_REASON_BYTES = 64;
const invalidUnicode = (text: string) => Array.from(text).some(point => point.length === 1 && /[\ud800-\udfff]/.test(point));

export interface SummaryResult { text: string; truncated: boolean; stopReason?: string }
export async function summarizeNotes(runtime: AnnaRuntime, snapshot: NotesDocument): Promise<SummaryResult> {
  const document = parseDocument(snapshot);
  if (!document.notes.length) throw new Error('请先保存至少一条笔记');
  let data: unknown;
  try {
    data = await runtime.tools.invoke({ tool_id: TOOL_ID, method: SUMMARY_METHOD,
      args: { notes: document.notes.map(note => note.content) }, timeoutMs: 60_000 }, { timeoutMs: 65_000 });
  } catch (error) {
    throw safeSummaryError(error);
  }
  if (typeof data !== 'object' || data === null || !('summary' in data) || typeof data.summary !== 'string') {
    throw new Error('总结工具返回了无效的 summary 文本，请重试');
  }
  if (data.summary.length > MAX_SUMMARY_BYTES || utf8Bytes(data.summary) > MAX_SUMMARY_BYTES) throw new Error('总结工具返回的 summary 超过 16384 UTF-8 字节限制');
  if (!data.summary.trim()) throw new Error('总结工具返回了无效的 summary 文本，请重试');
  if (invalidUnicode(data.summary)) throw new Error('总结工具返回了无效 Unicode 文本');
  if ('stopReason' in data && data.stopReason != null && (typeof data.stopReason !== 'string' ||
    data.stopReason.length > MAX_STOP_REASON_BYTES || utf8Bytes(data.stopReason) > MAX_STOP_REASON_BYTES || invalidUnicode(data.stopReason))) {
    throw new Error('总结工具返回了无效的 stopReason');
  }
  return { text: data.summary, truncated: 'truncated' in data && data.truncated === true,
    ...('stopReason' in data && typeof data.stopReason === 'string' ? { stopReason: data.stopReason } : {}) };
}
