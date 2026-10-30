import type { AnnaRuntime } from '../anna/types';
import { assertCanAdd, documentFingerprint, EMPTY_DOCUMENT, messageOf, parseDocument, type NotesDocument, type Note } from './model';

export const NOTES_KEY = 'mini-notes:document:v1';
type StorageStatus = 'loading' | 'ready' | 'mutating' | 'reconciling' | 'failed';
export interface RepositorySnapshot {
  document: NotesDocument;
  notes: Note[];
  status: StorageStatus;
  error: string | null;
  mutation: 'save' | 'delete' | null;
}
interface Mutation {
  kind: 'save' | 'delete';
  deletedId?: string;
  expected?: NotesDocument;
  confirmed?: () => void;
}
// Only explicit Host rejections prove that a write did not commit. A timeout,
// transport loss or unclassified internal error must keep the write isolated.
const rejectedCodes = new Set(['permission_denied', 'invalid_arg', 'invalid_params', 'invalid_arguments',
  'quota_exceeded', 'storage_quota_exceeded', 'too_large', 'not_found', 'method_not_found', 'unauthorized', 'forbidden',
  'storage_permission_denied', 'storage_invalid_arg']);
function isRejectedWrite(error: unknown): error is { code: string } {
  return typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string' && rejectedCodes.has(error.code);
}

export class NotesRepository {
  private state: RepositorySnapshot = { document: { ...EMPTY_DOCUMENT, notes: [] }, notes: [], status: 'loading', error: null, mutation: null };
  private listeners = new Set<() => void>();
  private tail: Promise<unknown> = Promise.resolve();
  private active: Mutation | undefined;
  private reading = 0;
  private syncQueued = false;
  private confirmation: Promise<NotesDocument> | undefined;
  private pendingConfirmation = false;
  private disposed = false;
  private hasLoaded = false;

  constructor(private runtime: AnnaRuntime) {}
  getSnapshot = (): RepositorySnapshot => this.state;
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  dispose(): void { this.disposed = true; this.listeners.clear(); }

  private publish(patch: Partial<RepositorySnapshot>): void {
    if (this.disposed) return;
    const document = patch.document ?? this.state.document;
    this.state = { ...this.state, ...patch, document,
      notes: this.active?.deletedId ? document.notes.filter(note => note.id !== this.active?.deletedId) : document.notes };
    for (const listener of this.listeners) listener();
  }
  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const job = this.tail.then(() => { if (this.disposed) throw new Error('会话已结束'); return operation(); });
    this.tail = job.catch(() => {});
    return job;
  }
  private async read(): Promise<NotesDocument> {
    this.reading++;
    try {
      const result = await this.runtime.storage.get({ key: NOTES_KEY });
      if (this.disposed) throw new Error('会话已结束');
      const document = parseDocument(result.value);
      this.hasLoaded = true;
      // A delayed Host snapshot must never roll back a confirmed local revision.
      if (document.revision < this.state.document.revision) return this.state.document;
      this.publish({ document });
      return document;
    } finally { this.reading--; }
  }
  refresh(): Promise<NotesDocument> {
    if (this.active?.expected) return this.confirm();
    return this.enqueue(async () => {
      if (!this.active) this.publish({ status: 'loading', error: null });
      try {
        const document = await this.read();
        if (!this.active) this.publish({ status: 'ready', error: null });
        return document;
      } catch (error) {
        this.hasLoaded = false;
        this.publish({ status: this.active ? 'mutating' : 'failed', error: `读取失败：${messageOf(error)}` });
        throw error;
      }
    });
  }
  requestSync(): void {
    if (this.disposed) return;
    // An ordinary sync read may be queued behind the isolated write. Its
    // coalescing flag must never prevent that write's confirmation channel.
    if (this.active?.expected) {
      if (this.confirmation) this.pendingConfirmation = true;
      else void this.confirm().catch(() => {});
      return;
    }
    // storage.get itself can emit runtime_state_synced. Never recursively read.
    if (this.reading || this.syncQueued) return;
    this.syncQueued = true;
    queueMicrotask(() => {
      void this.refresh().catch(() => {}).finally(() => { this.syncQueued = false; });
    });
  }
  private confirm(): Promise<NotesDocument> {
    if (this.confirmation) return this.confirmation;
    const mutation = this.active;
    if (!mutation?.expected) return this.refresh();
    // Assign the in-flight promise before calling get, since a Host adapter can
    // synchronously emit its sync event from get itself.
    this.confirmation = Promise.resolve().then(async () => {
      let observed: NotesDocument | undefined;
      let readError: unknown;
      // Consume one event received during the first read. A bounded second
      // read prevents Host read -> sync -> read feedback from polling forever.
      for (let attempt = 0; attempt < 2; attempt++) {
        this.pendingConfirmation = false;
        try {
          observed = await this.read(); readError = undefined;
          if (documentFingerprint(observed) === documentFingerprint(mutation.expected!)) {
            mutation.confirmed?.(); return observed;
          }
          this.publish({ status: 'reconciling', error: '写入结果仍未确认；再次读取旧值不能证明写入失败。请继续确认，期间暂停新增、删除和总结。' });
        } catch (error) {
          readError = error;
          this.publish({ status: 'reconciling', error: `确认写入失败：${messageOf(error)}。写入结果仍未知，请重新读取。` });
        }
        if (!this.pendingConfirmation) break;
      }
      if (readError !== undefined) throw readError;
      return observed!;
    }).finally(() => { this.confirmation = undefined; this.pendingConfirmation = false; });
    return this.confirmation;
  }
  private mutate(mutation: Mutation, change: (current: NotesDocument) => NotesDocument): Promise<void> {
    if (this.active) return Promise.reject(new Error('笔记操作正在处理中，请稍候'));
    if (this.state.status !== 'ready' && !(this.state.status === 'loading' && this.hasLoaded)) return Promise.reject(new Error('请先成功读取笔记后再保存或删除'));
    this.active = mutation;
    this.publish({ status: 'mutating', mutation: mutation.kind, error: null });
    return this.enqueue(async () => {
      let hasRead = false;
      try {
        const current = await this.read(); hasRead = true;
        const next = parseDocument(change(current));
        if (documentFingerprint(next) !== documentFingerprint(current)) {
          try { await this.runtime.storage.set({ key: NOTES_KEY, value: next }); }
          catch (error) {
            if (isRejectedWrite(error)) {
              throw error.code === 'too_large' ? new Error('存储空间不足，内容未保存；释放空间后可重试') : error;
            }
            mutation.expected = next;
            const completion = new Promise<void>(resolve => { mutation.confirmed = resolve; });
            this.publish({ status: 'reconciling', error: `正在确认${mutation.kind === 'save' ? '保存' : '删除'}结果：${messageOf(error)}。请重新读取；在结果确认前暂停新增、删除和总结。` });
            // This read belongs to the current operation, not the blocked queue.
            void this.confirm().catch(() => {});
            await completion;
          }
        }
        this.active = undefined;
        this.publish({ document: next, status: 'ready', mutation: null, error: null });
      } catch (error) {
        this.active = undefined;
        this.publish({ status: hasRead ? 'ready' : 'failed', mutation: null, error: `${mutation.kind === 'save' ? '保存' : '删除'}失败：${messageOf(error)}` });
        throw error;
      }
    });
  }
  add(input: string): Promise<void> {
    const content = input.trim();
    try { assertCanAdd(this.state.document.notes, content); } catch (error) { return Promise.reject(error); }
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    return this.mutate({ kind: 'save' }, current => {
      if (current.notes.some(note => note.id === id)) return current;
      return { ...current, revision: current.revision + 1, nextSequence: current.nextSequence + 1,
        notes: [...current.notes, { id, content, createdAt, sequence: current.nextSequence }] };
    });
  }
  remove(id: string): Promise<void> {
    return this.mutate({ kind: 'delete', deletedId: id }, current => {
      if (!current.notes.some(note => note.id === id)) return current;
      return { ...current, revision: current.revision + 1, notes: current.notes.filter(note => note.id !== id) };
    });
  }
}
