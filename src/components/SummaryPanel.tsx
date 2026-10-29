import type { SummaryResult } from '../summary/service';
import { NO_LLM_ERROR } from '../summary/errors';
export function SummaryPanel({ summary }: { summary: { status: string; running: boolean; result?: SummaryResult } }) {
  return <div aria-live="polite" className="summary-panel">
    {summary.status === 'idle' ? <p className="hint">保存笔记后，点击 Summarize 生成总结。</p> : null}
    {summary.status === 'running' ? <p className="hint">正在请求 LLM 总结…你可以继续添加或删除笔记。</p> : null}
    {summary.status === 'stale' ? <p className="hint">笔记已变化，请重新总结</p> : null}
    {summary.status === 'no-llm' ? <div className="mode-notice" data-testid="no-llm-notice">
      <p><strong>当前为无模型验收模式</strong></p>
      <p className="hint">总结请求已提交给本地工具。Host 禁用了模型，这是此模式的预期提示；笔记仍可正常使用。</p>
      <p className="hint">后端 sampling 成功路径请在终端单独验证：</p>
      <code className="test-command">npm run test:sampling</code>
      <details><summary>查看 Host 返回详情</summary><code>{NO_LLM_ERROR}</code></details>
    </div> : null}
    {summary.result ? <><p data-testid="summary-text" className="summary-text">{summary.result.text}</p>{summary.result.truncated ? <p className="hint">总结已截断，可重新请求总结。</p> : null}</> : null}
  </div>;
}
