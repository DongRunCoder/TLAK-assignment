export interface Note { id: string; content: string; sequence: number; createdAt: string }
export interface NotesDocument { schemaVersion: 1; revision: number; nextSequence: number; notes: Note[] }
export const MAX_NOTES = 100;
export const MAX_NOTE_CODE_POINTS = 1000;
export const MAX_BODY_BYTES = 24_576;
export const MAX_DOCUMENT_BYTES = 192 * 1024;
export const EMPTY_DOCUMENT: NotesDocument = { schemaVersion: 1, revision: 0, nextSequence: 1, notes: [] };
const encoder = new TextEncoder();
const uuid = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
const integer = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value);
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
export const utf8Bytes = (text: string): number => encoder.encode(text).byteLength;
export const notesBodyBytes = (notes: readonly Pick<Note, 'content'>[]): number => notes.reduce((total, note) => total + utf8Bytes(note.content), 0);

export function assertCanAdd(notes: readonly Pick<Note, 'content'>[], content: string): void {
  assertContent(content);
  if (notes.length >= MAX_NOTES) throw new Error('最多保存 100 条笔记，请先删除部分笔记');
  if (notesBodyBytes(notes) + utf8Bytes(content) > MAX_BODY_BYTES) throw new Error('笔记正文合计不能超过 24576 个 UTF-8 字节，请缩短草稿或删除部分笔记');
}

export function assertContent(content: string): void {
  if (!content.trim()) throw new Error('笔记内容不能为空');
  const points = Array.from(content);
  if (points.some(point => point.length === 1 && /[\ud800-\udfff]/.test(point))) throw new Error('笔记必须包含有效 Unicode 字符');
  if (points.length > MAX_NOTE_CODE_POINTS) throw new Error('每条笔记最多 1000 个 Unicode 字符');
}

export function assertNotes(notes: Note[]): void {
  if (notes.length > MAX_NOTES) throw new Error('最多保存 100 条笔记');
  for (const note of notes) assertContent(note.content);
  if (notesBodyBytes(notes) > MAX_BODY_BYTES) throw new Error('笔记正文合计不能超过 24576 个 UTF-8 字节');
}

export function parseDocument(value: unknown): NotesDocument {
  if (value === null) return { ...EMPTY_DOCUMENT, notes: [] };
  if (encoder.encode(JSON.stringify(value)).byteLength > MAX_DOCUMENT_BYTES) throw new Error('笔记文档不能超过 192 KiB，原数据已保护');
  if (!object(value) || value.schemaVersion !== 1 || !integer(value.revision) || value.revision < 0 ||
      !integer(value.nextSequence) || value.nextSequence < 1 || !Array.isArray(value.notes)) {
    throw new Error('笔记文档格式或版本不受支持，原数据已保护；请重新读取');
  }
  const ids = new Set<string>(); const sequences = new Set<number>();
  const notes = value.notes.map((entry: unknown): Note => {
    if (!object(entry) || typeof entry.id !== 'string' || !uuid.test(entry.id) || ids.has(entry.id) ||
        typeof entry.content !== 'string' || !integer(entry.sequence) || entry.sequence < 1 ||
        entry.sequence >= (value.nextSequence as number) || sequences.has(entry.sequence) ||
        typeof entry.createdAt !== 'string' || entry.createdAt.length > 40 || !Number.isFinite(Date.parse(entry.createdAt))) {
      throw new Error('笔记文档含无效笔记、重复 ID 或序号，原数据已保护');
    }
    ids.add(entry.id); sequences.add(entry.sequence);
    return { id: entry.id, content: entry.content, sequence: entry.sequence, createdAt: entry.createdAt };
  });
  assertNotes(notes);
  notes.sort((a, b) => a.sequence - b.sequence);
  return { schemaVersion: 1, revision: value.revision, nextSequence: value.nextSequence, notes };
}

export const documentFingerprint = (document: NotesDocument): string => JSON.stringify(document);
export const messageOf = (error: unknown): string => error instanceof Error ? error.message : String(error);
