import { useRef, useState } from 'react';
import type { RuntimeConnection } from '../notes/useMiniNotes';
import { useMiniNotes } from '../notes/useMiniNotes';
import { assertCanAdd, MAX_BODY_BYTES, messageOf, notesBodyBytes, utf8Bytes } from '../notes/model';
import { NotesList } from './NotesList';
import { SummaryPanel } from './SummaryPanel';
import { Icon } from './Icon';
import { UsageGuide } from './UsageGuide';

export function MiniNotesApp({ connection }: { connection: RuntimeConnection }) {
  const app = useMiniNotes(connection);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const [copyStatus, setCopyStatus] = useState('');
  const { snapshot } = app;
  const ready = app.runtimeStatus === 'ready' && app.hostStatus === 'online' && !app.recovery.recovering && snapshot.status === 'ready';
  const lost = app.hostStatus === 'expired' || app.hostStatus === 'unavailable';
  async function copyDraft() {
    try { await navigator.clipboard.writeText(app.composer); setCopyStatus('草稿已复制。'); }
    catch { composerRef.current?.focus(); composerRef.current?.select(); setCopyStatus('已选中草稿，请按 Ctrl+C 复制。'); }
  }
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
    <header className="app-header">
      <div><h1>Mini Notes</h1><p className="intro">让想法，清晰起来。</p></div>
      <span className="connection-state" data-status={app.hostStatus} role="status" aria-label="Anna 连接状态">
        <span className="connection-dot" aria-hidden="true" />
        {{ checking: '正在检查 Anna…', online: 'Anna 已连接', expired: '会话已失效', unavailable: 'Anna 暂不可用' }[app.hostStatus]}
      </span>
    </header>
    <p role="status" className="storage-status">{status}</p>
    {app.error ? <p role="alert" className="error">{app.error}</p> : null}
    {app.runtimeStatus === 'failed' && app.hostStatus !== 'expired' ? <button type="button" onClick={app.retryConnection}>重试连接</button> : null}
    {lost || app.recovery.recovering || app.recovery.error || app.recovery.hasPendingDraft ? <section aria-label="会话恢复" className="session-recovery">
      <p id="session-recovery-warning" className="hint">草稿仍保留在当前页面。旧会话中的笔记不保证保留，恢复新会话可能影响其他标签页。恢复后请检查草稿，手动点击保存。</p>
      {lost && app.recovery.available ? <button type="button" onClick={app.recovery.recover} disabled={!!snapshot.mutation || app.recovery.recovering || app.recovery.hasPendingDraft}
        aria-busy={app.recovery.recovering} aria-describedby="session-recovery-warning">保留草稿并恢复会话</button>
        : lost && !app.recovery.available ? <p className="hint">请先复制草稿，再手动重新打开 Anna 应用。</p> : null}
      {app.recovery.hasPendingDraft ? <>
        <p id="pending-draft-hint" className="hint">有一份恢复草稿待取回，请先复制当前输入并清空，再取回恢复草稿。写入结果确认前不能取回。</p>
        <button type="button" onClick={app.recovery.takePendingDraft} disabled={!!app.composer || !!snapshot.mutation || app.recovery.recovering}
          aria-describedby="pending-draft-hint">取回恢复草稿</button>
      </> : null}
      {snapshot.mutation ? <p className="hint">写入结果尚未确认，暂不能恢复会话；请保留页面并继续重新读取确认。</p> : null}
      <button type="button" className="secondary" onClick={() => void copyDraft()}>复制草稿</button>
      {app.recovery.recovering ? <p role="status">正在恢复会话并交还草稿…</p> : null}
      {app.recovery.error ? <p role="alert" className="error">{app.recovery.error}</p> : null}
      {copyStatus ? <p role="status">{copyStatus}</p> : null}
    </section> : null}
    {snapshot.status === 'reconciling' ? <p className="hint">确认前请保留当前页面并使用“重新读取”。如果始终无法确认，可手动结束本次本地会话；重启 dev 会清空 legacy 内存数据。</p> : null}
    <form className="composer" onSubmit={event => { event.preventDefault(); if (ready && validInput) void app.save(); }}>
      <label htmlFor="note-content">笔记内容</label>
      <textarea ref={composerRef} id="note-content" aria-label="笔记内容" value={app.composer} onChange={event => app.changeComposer(event.target.value)}
        readOnly={snapshot.mutation === 'save' || app.recovery.recovering} rows={3} placeholder="写下一条简短笔记…" aria-invalid={inputError ? true : undefined}
        aria-describedby={`composer-limit composer-capacity${inputError ? ' composer-error' : ''}`} />
      <div className="composer-footer"><span id="composer-limit" className="hint">{Array.from(app.composer.trim()).length} / 1000 字符 · 最多 100 条</span><button type="submit" disabled={!ready || !validInput}>保存笔记</button></div>
      {inputError ? <p id="composer-error" role="alert" className="error">{inputError}</p> : null}
    </form>
    <p id="composer-capacity" data-testid="composer-capacity" className="composer-capacity hint">正文：已存 {existingBytes} + 草稿 {draftBytes} = {existingBytes + draftBytes} / {MAX_BODY_BYTES} UTF-8 字节</p>
    <div className="content-layout">
      <section aria-labelledby="notes-heading" className="notes-section">
        <div className="section-header"><h2 id="notes-heading">笔记</h2><button type="button" className="secondary" onClick={() => void app.reread()}
          disabled={app.runtimeStatus !== 'ready' || snapshot.status === 'loading' || snapshot.status === 'mutating'}><Icon name="refresh" />重新读取</button></div>
        <NotesList notes={snapshot.notes} canDelete={ready} onDelete={id => void app.remove(id)} />
      </section>
      <section aria-labelledby="summary-heading" className="summary-section">
        <div className="summary-heading-row"><Icon name="sparkle" /><h2 id="summary-heading">LLM 总结</h2></div>
        <SummaryPanel summary={app.summary} />
        <button type="button" className="summary-action" onClick={() => void app.summarize()}
          disabled={!ready || !snapshot.notes.length || app.summary.running} aria-busy={app.summary.running}>Summarize</button>
      </section>
    </div>
    <footer className="app-footer"><p>笔记通过 Anna Host storage 保存；总结由 Executa sampling 返回。</p><UsageGuide runtime={app.anna} initialFocusRef={composerRef} /></footer>
  </main>;
}
