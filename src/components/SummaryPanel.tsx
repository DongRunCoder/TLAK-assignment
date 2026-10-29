import type { SummaryResult } from '../summary/service';
export function SummaryPanel({ summary }: { summary: { status: string; running: boolean; result?: SummaryResult } }) {
  return <div aria-live="polite" className="summary-panel">
    {summary.status === 'idle' ? <p className="hint">保存笔记后，点击 Summarize 生成总结。</p> : null}
    {summary.status === 'running' ? <p className="hint">正在请求 LLM 总结…你可以继续添加或删除笔记。</p> : null}
    {summary.status === 'stale' ? <p className="hint">笔记已变化，请重新总结</p> : null}
    {summary.result ? <><p data-testid="summary-text" className="summary-text">{summary.result.text}</p>{summary.result.truncated ? <p className="hint">总结已截断，可重新请求总结。</p> : null}</> : null}
  </div>;
}
