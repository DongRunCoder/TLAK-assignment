import { useId, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import type { AnnaRuntime } from '../anna/types';
import { useUsageGuide } from '../onboarding/useUsageGuide';

function GuideDialog({ id, onDismiss, helpButton }: {
  id: string;
  onDismiss: () => void;
  helpButton: RefObject<HTMLButtonElement | null>;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const detailsId = useId();
  const [expanded, setExpanded] = useState(false);
  const dialog = useRef<HTMLDivElement>(null);
  const primary = useRef<HTMLButtonElement>(null);

  useLayoutEffect(() => {
    const panel = dialog.current;
    if (!panel) return;
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    primary.current?.focus();

    const keepFocus = (event: FocusEvent) => {
      if (!panel.contains(event.target as Node)) primary.current?.focus();
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onDismiss();
      } else if (event.key === 'Tab') {
        const buttons = panel.querySelectorAll<HTMLButtonElement>('button:not([disabled])');
        const first = buttons[0];
        const last = buttons[buttons.length - 1];
        if (event.shiftKey && (document.activeElement === first || !panel.contains(document.activeElement))) {
          event.preventDefault(); last?.focus();
        } else if (!event.shiftKey && (document.activeElement === last || !panel.contains(document.activeElement))) {
          event.preventDefault(); first?.focus();
        }
      }
    };
    document.addEventListener('keydown', handleKey, true);
    document.addEventListener('focusin', keepFocus, true);
    return () => {
      document.removeEventListener('keydown', handleKey, true);
      document.removeEventListener('focusin', keepFocus, true);
      document.body.style.overflow = previousOverflow;
      if (previousFocus instanceof HTMLElement && previousFocus !== document.body && previousFocus.isConnected) previousFocus.focus();
      else helpButton.current?.focus();
    };
  }, [helpButton, onDismiss]);

  return createPortal(
    <div className="usage-guide-backdrop" onClick={event => { if (event.target === event.currentTarget) onDismiss(); }}>
      <div id={id} ref={dialog} className="usage-guide-dialog" role="dialog" aria-modal="true"
        aria-labelledby={titleId} aria-describedby={descriptionId} tabIndex={-1}>
        <div className="usage-guide-heading">
          <h2 id={titleId}>开始使用 Mini Notes</h2>
          <button type="button" className="usage-guide-close" aria-label="关闭使用说明" onClick={onDismiss}>
            <span aria-hidden="true">×</span>
          </button>
        </div>
        <p id={descriptionId} className="usage-guide-intro">默认无需账号或模型配置，即可添加、删除和重新读取笔记。</p>
        <p>项目默认启动和界面验收命令使用 <code>--no-llm</code>；本弹窗不会检测或修改 Host 配置。</p>
        <p className="usage-guide-model-note">真实模型由 Host 可选配置；Mini Notes 不收集 API Key 或其他凭据。</p>
        <div className="usage-guide-actions">
          <button ref={primary} type="button" onClick={onDismiss}>开始使用（无需配置模型）</button>
          <button type="button" className="secondary" aria-expanded={expanded} aria-controls={detailsId}
            onClick={() => setExpanded(value => !value)}>查看验收说明</button>
        </div>
        {expanded ? <div id={detailsId} className="usage-guide-details">
          <section aria-labelledby={`${detailsId}-ui`}>
            <h3 id={`${detailsId}-ui`}>1. 界面与无模型验收</h3>
            <p>保持默认的 Anna harness 运行，再执行 <code>npm run test:harness</code>，验证笔记操作及真实 Host storage / tools 调用。</p>
            <p>在 <code>--no-llm</code> 模式点击 Summarize，仍会发起真实调用；Host 返回 <code>harness started with --no-llm</code> 表示当前未启用模型。</p>
          </section>
          <section aria-labelledby={`${detailsId}-sampling`}>
            <h3 id={`${detailsId}-sampling`}>2. 独立 sampling 验收</h3>
            <p>另行执行 <code>npm run test:sampling</code>，使用官方 mock sampling 验证 Executa → sampling 的成功路径。</p>
            <p>此路径独立运行，不会切换当前 Host 配置；mock 验证协议与返回文本，不代表真实模型效果。</p>
          </section>
        </div> : null}
      </div>
    </div>, document.body,
  );
}

export function UsageGuide({ runtime }: { runtime?: AnnaRuntime }) {
  const guide = useUsageGuide(runtime);
  const dialogId = useId();
  const helpButton = useRef<HTMLButtonElement>(null);
  return <div className="usage-guide-entry">
    <button ref={helpButton} type="button" className="secondary usage-guide-help" aria-haspopup="dialog"
      aria-expanded={guide.isOpen} aria-controls={dialogId} onClick={guide.open}>使用说明</button>
    {guide.preferenceFailed ? <p className="usage-guide-preference-status" role="status">使用说明偏好未保存，可随时重新打开。</p> : null}
    {guide.isOpen ? <GuideDialog id={dialogId} onDismiss={guide.dismiss} helpButton={helpButton} /> : null}
  </div>;
}
