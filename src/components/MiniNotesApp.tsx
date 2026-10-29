import type { RuntimeConnection } from '../notes/useMiniNotes';
import { useMiniNotes } from '../notes/useMiniNotes';
import { assertCanAdd, MAX_BODY_BYTES, messageOf, notesBodyBytes, utf8Bytes } from '../notes/model';
import { NotesList } from './NotesList';
import { SummaryPanel } from './SummaryPanel';

export function MiniNotesApp({ connection }: { connection: RuntimeConnection }) {
  const app = useMiniNotes(connection);
  const { snapshot } = app;
  const ready = app.runtimeStatus === 'ready' && snapshot.status === 'ready';
  const content = app.composer.trim();
  const existingBytes = notesBodyBytes(snapshot.document.notes);
  const draftBytes = utf8Bytes(content);
  let validInput = true;
  let inputError: string | null = null;
  try { assertCanAdd(snapshot.document.notes, content); }
  catch (error) { validInput = false; if (content) inputError = messageOf(error); }
  const status = app.runtimeStatus === 'connecting' ? '正在连接 Anna…' : app.runtimeStatus === 'failed' ? '连接失败' :
    snapshot.status === 'loading' ? '正在读取笔记…' : snapshot.status === 'mutating' ? '正在保存更改…' :
    snapshot.status === 'reconciling' ? '正在确认写入结果' : snapshot.status === 'failed' ? '读取失败，显示最后已知的笔记' : `已同步 · ${snapshot.notes.length} 条笔记`;
  return <main className="app">
    <header><div><p className="eyebrow">ANNA APP</p><h1>Mini Notes</h1></div><span className="connection-state">{app.runtimeStatus === 'ready' ? 'Anna 已连接' : 'Anna 连接'}</span></header>
    <p className="intro">记下待办和灵感，借助 LLM 整理重点。</p>
    <p role="status" className="storage-status">{status}</p>
    {app.error ? <p role="alert" className="error">{app.error}</p> : null}
    {app.runtimeStatus === 'failed' ? <button type="button" onClick={app.retryConnection}>重试连接</button> : null}
    {snapshot.status === 'reconciling' ? <p className="hint">确认前请保留当前页面并使用“重新读取”。如果始终无法确认，可手动结束本次本地会话；重启 dev 会清空 legacy 内存数据。</p> : null}
    <form onSubmit={event => { event.preventDefault(); if (ready && validInput) void app.save(); }}>
      <label htmlFor="note-content">笔记内容</label>
      <textarea id="note-content" aria-label="笔记内容" value={app.composer} onChange={event => app.changeComposer(event.target.value)}
        readOnly={snapshot.mutation === 'save'} rows={4} placeholder="写下一条简短笔记…" aria-invalid={inputError ? true : undefined}
        aria-describedby={`composer-limit composer-capacity${inputError ? ' composer-error' : ''}`} />
      <div className="composer-footer"><span id="composer-limit" className="hint">{Array.from(app.composer.trim()).length} / 1000 字符 · 最多 100 条</span><button type="submit" disabled={!ready || !validInput}>保存笔记</button></div>
      <p id="composer-capacity" data-testid="composer-capacity" className="hint">正文：已存 {existingBytes} + 草稿 {draftBytes} = {existingBytes + draftBytes} / {MAX_BODY_BYTES} UTF-8 字节</p>
      {inputError ? <p id="composer-error" role="alert" className="error">{inputError}</p> : null}
    </form>
    <section aria-labelledby="notes-heading" className="notes-section">
      <div className="section-header"><h2 id="notes-heading">笔记</h2><button type="button" className="secondary" onClick={() => void app.reread()}
        disabled={app.runtimeStatus !== 'ready' || snapshot.status === 'loading' || snapshot.status === 'mutating'}>重新读取</button></div>
      <NotesList notes={snapshot.notes} canDelete={ready} onDelete={id => void app.remove(id)} />
    </section>
    <section aria-labelledby="summary-heading" className="summary-section">
      <div className="section-header"><h2 id="summary-heading">LLM 总结</h2><button type="button" onClick={() => void app.summarize()}
        disabled={!ready || !snapshot.notes.length || app.summary.running}>Summarize</button></div>
      <SummaryPanel summary={app.summary} />
    </section>
    <footer>笔记通过 Anna Host storage 保存；总结由 Executa sampling 返回。</footer>
  </main>;
}
