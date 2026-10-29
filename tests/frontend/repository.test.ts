import { describe, expect, it } from 'vitest';
import { NotesRepository, NOTES_KEY } from '../../src/notes/repository';
import { parseDocument, EMPTY_DOCUMENT, MAX_BODY_BYTES } from '../../src/notes/model';
import { deferred, host, note, doc, denied, flush } from './helpers';

describe('notes model', () => {
  it('only a missing Host value is an empty document', () => {
    expect(parseDocument(null)).toEqual(EMPTY_DOCUMENT);
    for (const value of [undefined, {}, '[]', { ...doc(), schemaVersion: 2 }, doc([note(), note()]), { ...doc(), nextSequence: 1 }]) {
      expect(() => parseDocument(value)).toThrow();
    }
  });
  it('validates Unicode code points, exact UTF-8 body bytes and document bytes', () => {
    expect(parseDocument(doc([note(1, '😀'.repeat(1000))]))).toBeTruthy();
    expect(() => parseDocument(doc([note(1, '😀'.repeat(1001))]))).toThrow('1000');
    expect(() => parseDocument(doc([note(1, '\ud800')]))).toThrow('Unicode');
    expect(() => parseDocument(doc([note(1, '\ufeff\u00a0\u2029')]))).toThrow();
    const notes = Array.from({ length: 25 }, (_, index) => note(index + 1, 'a'.repeat(index === 24 ? 576 : 1000)));
    expect(notes.reduce((sum, entry) => sum + entry.content.length, 0)).toBe(MAX_BODY_BYTES);
    expect(parseDocument(doc(notes))).toBeTruthy();
    notes[24].content += 'a';
    expect(() => parseDocument(doc(notes))).toThrow('24576');
    expect(() => parseDocument({ ...doc(), extra: 'a'.repeat(192 * 1024) })).toThrow('192');
    expect(() => parseDocument(doc(Array.from({ length: 101 }, (_, index) => note(index + 1))))).toThrow('100');
  });
});

describe('Host storage repository', () => {
  it('reads, trims, saves and deletes with stable increasing sequence', async () => {
    const h = host(); const repo = new NotesRepository(h.runtime);
    await repo.refresh();
    await repo.add('  first\n'); await repo.add('second');
    const first = repo.getSnapshot().document.notes[0];
    await repo.remove(first.id); await repo.add('third');
    expect(repo.getSnapshot().document.notes.map(n => [n.sequence, n.content])).toEqual([[2, 'second'], [3, 'third']]);
    expect(repo.getSnapshot().document).toMatchObject({ revision: 4, nextSequence: 4 });
    expect(h.storage.get).toHaveBeenCalledTimes(5);
    expect(h.storage.set).toHaveBeenCalledTimes(4);
    expect(h.storage.get).toHaveBeenCalledWith({ key: NOTES_KEY });
    expect(first.id).toMatch(/^[\da-f-]{36}$/i);
  });
  it('does not write after a failed get or bad schema', async () => {
    const h = host({ schemaVersion: 2 }); const repo = new NotesRepository(h.runtime);
    await expect(repo.refresh()).rejects.toThrow();
    await expect(repo.add('keep safe')).rejects.toThrow();
    h.storage.get.mockRejectedValueOnce(new Error('offline'));
    await expect(repo.refresh()).rejects.toThrow('offline');
    expect(h.storage.set).not.toHaveBeenCalled();
    expect(repo.getSnapshot().status).toBe('failed');
  });
  it('keeps composer failure explicit and rolls back a rejected optimistic delete', async () => {
    const h = host(doc()); const repo = new NotesRepository(h.runtime); await repo.refresh();
    h.storage.set.mockRejectedValueOnce(denied());
    const deleting = repo.remove(note().id);
    expect(repo.getSnapshot().notes).toEqual([]);
    await expect(deleting).rejects.toThrow('write denied');
    expect(repo.getSnapshot().notes).toEqual([note()]);
    expect(repo.getSnapshot().status).toBe('ready');
    h.storage.set.mockRejectedValueOnce(denied());
    await expect(repo.add('retain draft')).rejects.toThrow('write denied');
    expect(repo.getSnapshot().document.notes).toEqual([note()]);
  });
  it('serializes an old read before deletion and keeps its pending overlay applied', async () => {
    const h = host(doc()); const repo = new NotesRepository(h.runtime); await repo.refresh();
    const oldRead = deferred<{ value: unknown }>(); h.storage.get.mockImplementationOnce(() => oldRead.promise);
    const reading = repo.refresh(); await flush();
    const deleting = repo.remove(note().id);
    expect(repo.getSnapshot().notes).toEqual([]);
    oldRead.resolve({ value: doc() }); await reading;
    expect(repo.getSnapshot().notes).toEqual([]);
    await deleting;
    expect(repo.getSnapshot().notes).toEqual([]);
  });
  it('rejects repeated mutations instead of losing an operation', async () => {
    const h = host(); const repo = new NotesRepository(h.runtime); await repo.refresh();
    const write = deferred<unknown>(); h.storage.set.mockImplementationOnce(() => write.promise);
    const saving = repo.add('once');
    await expect(repo.add('twice')).rejects.toThrow('处理中');
    write.resolve({ ok: true }); await saving;
    expect(h.storage.set).toHaveBeenCalledTimes(1);
  });
  it('holds the write lock on timeout and confirms a late commit through an internal read', async () => {
    const h = host(doc()); const repo = new NotesRepository(h.runtime); await repo.refresh();
    let expected: unknown;
    h.storage.set.mockImplementationOnce(async ({ value }) => { expected = value; throw new Error('Host RPC timeout'); });
    let saved = false; const saving = repo.add('late').then(() => { saved = true; });
    await flush();
    expect(repo.getSnapshot().status).toBe('reconciling');
    await repo.refresh();
    expect(saved).toBe(false); expect(repo.getSnapshot().status).toBe('reconciling');
    await expect(repo.remove(note().id)).rejects.toThrow('处理中');
    expect(h.storage.set).toHaveBeenCalledTimes(1);
    h.put(expected); await repo.refresh(); await saving;
    expect(repo.getSnapshot().status).toBe('ready');
    expect(repo.getSnapshot().notes.map(n => n.content)).toEqual(['first', 'late']);
    expect(h.storage.set).toHaveBeenCalledTimes(1);
  });
  it('routes late-commit sync events past a normal read queued behind the uncertain write', async () => {
    const h = host(); const repo = new NotesRepository(h.runtime); await repo.refresh();
    let expected: unknown;
    h.storage.set.mockImplementationOnce(async ({ value }) => {
      expected = value; repo.requestSync(); await Promise.resolve(); throw new Error('Host RPC timeout');
    });
    let complete = false; const saving = repo.add('late').then(() => { complete = true; });
    await flush(); await flush();
    expect(repo.getSnapshot().status).toBe('reconciling');
    const reads = h.storage.get.mock.calls.length;
    h.put(expected); repo.requestSync(); await flush(); await flush();
    expect(h.storage.get.mock.calls.length).toBeGreaterThan(reads);
    expect(complete).toBe(true); expect(repo.getSnapshot().status).toBe('ready');
    await saving; expect(h.storage.set).toHaveBeenCalledTimes(1);
  });
  it('merges a sync event during an in-flight confirmation into one follow-up read', async () => {
    const h = host(); const repo = new NotesRepository(h.runtime); await repo.refresh();
    const oldConfirmation = deferred<{ value: unknown }>(); let expected: unknown;
    h.storage.set.mockImplementationOnce(async ({ value }) => {
      expected = value; h.storage.get.mockImplementationOnce(() => oldConfirmation.promise); throw new Error('Host RPC timeout');
    });
    let complete = false; const saving = repo.add('late').then(() => { complete = true; });
    await flush(); expect(repo.getSnapshot().status).toBe('reconciling');
    h.put(expected); repo.requestSync(); repo.requestSync();
    oldConfirmation.resolve({ value: null }); await flush(); await flush();
    expect(complete).toBe(true); await saving;
    expect(h.storage.get).toHaveBeenCalledTimes(4);
    expect(h.storage.set).toHaveBeenCalledTimes(1);
  });
  it('bounds follow-up confirmation reads when every get emits its own sync event', async () => {
    const h = host(); const repo = new NotesRepository(h.runtime); await repo.refresh();
    let expected: unknown;
    h.storage.get.mockImplementation(async () => { repo.requestSync(); return { value: h.value() }; });
    h.storage.set.mockImplementationOnce(async ({ value }) => { expected = value; throw new Error('Host RPC timeout'); });
    const saving = repo.add('late'); await flush(); await flush();
    expect(repo.getSnapshot().status).toBe('reconciling');
    expect(h.storage.get.mock.calls.length).toBeLessThanOrEqual(4);
    const count = h.storage.get.mock.calls.length; await flush();
    expect(h.storage.get).toHaveBeenCalledTimes(count);
    h.put(expected); repo.requestSync(); await flush(); await flush();
    expect(repo.getSnapshot().status).toBe('ready'); await saving;
  });
  it('keeps uncertain deletes hidden and does not unlock after failed confirmation', async () => {
    const h = host(doc()); const repo = new NotesRepository(h.runtime); await repo.refresh();
    let expected: unknown;
    h.storage.set.mockImplementationOnce(async ({ value }) => { expected = value; throw new Error('transport closed'); });
    const deleting = repo.remove(note().id); await flush();
    h.storage.get.mockRejectedValueOnce(new Error('still offline'));
    await expect(repo.refresh()).rejects.toThrow('still offline');
    expect(repo.getSnapshot().notes).toEqual([]);
    expect(repo.getSnapshot().status).toBe('reconciling');
    await repo.refresh(); expect(repo.getSnapshot().status).toBe('reconciling');
    h.put(expected); await repo.refresh(); await deleting;
    expect(repo.getSnapshot().status).toBe('ready');
  });
  it('coalesces sync events and ignores events caused by its own reads', async () => {
    const h = host(); const repo = new NotesRepository(h.runtime);
    h.storage.get.mockImplementation(async () => { repo.requestSync(); return { value: h.value() }; });
    await repo.refresh(); await flush();
    expect(h.storage.get).toHaveBeenCalledTimes(1);
    repo.requestSync(); repo.requestSync(); repo.requestSync(); await flush();
    expect(h.storage.get).toHaveBeenCalledTimes(2);
  });
  it('rejects blank/capacity inputs without storage writes', async () => {
    const h = host(); const repo = new NotesRepository(h.runtime); await repo.refresh();
    for (const content of ['\ufeff\u2000', '😀'.repeat(1001), '\ud800']) await expect(repo.add(content)).rejects.toThrow();
    expect(h.storage.set).not.toHaveBeenCalled();
    h.put(doc(Array.from({ length: 100 }, (_, index) => note(index + 1)))); await repo.refresh();
    const reads = h.storage.get.mock.calls.length;
    await expect(repo.add('over capacity')).rejects.toThrow('100');
    expect(h.storage.get).toHaveBeenCalledTimes(reads);
    expect(h.storage.set).not.toHaveBeenCalled();
  });
  it('does not begin a write after an unmounted session finishes its read', async () => {
    const h = host(); const repo = new NotesRepository(h.runtime); await repo.refresh();
    const reading = deferred<{ value: unknown }>(); h.storage.get.mockImplementationOnce(() => reading.promise);
    const operation = repo.add('unmounted'); await flush();
    repo.dispose(); reading.resolve({ value: null });
    await expect(operation).rejects.toThrow('会话已结束');
    expect(h.storage.set).not.toHaveBeenCalled();
  });
});
