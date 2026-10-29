# Mini Notes 视觉改版 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将已确认的浅色极简设计稿实现为真实可操作的 Anna Mini Notes，保留 question.md 全部平台契约。

**Architecture:** 沿用现有 hook、repository、summary service。只修改呈现组件与 CSS，增加小型 SVG 图标组件。样式由独立子 agent 实现，主 agent 集成组件、运行真实 harness 并对照截图修正。

**Tech Stack:** React、TypeScript、Vite、CSS、原生 SVG；既有 Vitest 与 Anna harness。

---

### Task 1: 固定设计与回归基线

**Files:** `docs/superpowers/specs/2026-10-29-mini-notes-visual-redesign-design.md`，`docs/superpowers/specs/assets/mini-notes-light-concept.png`，现有 `tests/frontend/*`。

- [x] 读取 question.md、组件、状态逻辑、harness 测试与窗口配置。
- [x] 生成完整设计图，记录颜色、字号、组件、响应式、状态和可访问性；获得用户确认。
- [ ] 提交设计与计划；运行现有 `npm test` 作为回归基线。本次不新增镜像 CSS 的单元测试，视觉通过真实浏览器核验。

### Task 2: 更新组件结构

**Files:** 修改 `src/components/MiniNotesApp.tsx`、`src/components/NotesList.tsx`；新增 `src/components/Icon.tsx`。

- [ ] 页头采用下列真实状态结构，保留 h1 与原有状态文本：

```tsx
<header className="app-header">
  <div><h1>Mini Notes</h1><p className="intro">让想法，清晰起来。</p></div>
  <span className="connection-state" data-status={app.runtimeStatus}>
    <span className="connection-dot" aria-hidden="true" />
    {app.runtimeStatus === 'ready' ? 'Anna 已连接' : 'Anna 连接'}
  </span>
</header>
```

- [ ] 将表单标为 `composer`；将容量行放在表单后，保留 ID、字节内容和 aria-describedby。
- [ ] 增加 `content-layout` 容器，顺序为笔记区、总结区；总结标题、原 `SummaryPanel`、`Summarize` 按钮依次排列。现有业务调用和 disabled 条件保持原样。
- [ ] 添加三个纯展示 SVG 图标，统一 24px viewBox、currentColor、round cap / join、无可访问名称。刷新用双圆弧，删除用垃圾桶，总结用四角星。删除按钮保留 `aria-label` 和 title，按钮至少 36px 点击区域。
- [ ] 保留空态、所有真实异常提示、测试标识及完整纯文本内容。

### Task 3: 落实样式系统

**Files:** `src/styles.css`，由子 agent 独立负责。

- [ ] 用 CSS 变量建立固定色板与字体栈：

```css
:root {
  --canvas: #fff;
  --ink: #1d1d1f;
  --muted: #6e6e73;
  --surface: #f5f5f7;
  --line: #e5e5e7;
  --accent: #0071e3;
}
.content-layout { display: grid; grid-template-columns: minmax(0, 5fr) minmax(0, 3fr); gap: 28px; }
@media (max-width: 879px) { .content-layout { grid-template-columns: minmax(0, 1fr); } }
```

- [ ] 白底、最大内容宽 864px、宽屏约 48px 页边距、56px 标题；640px 与 360px 缩放字号和间距。
- [ ] 输入区细边线、20px 圆角、24px 内边距，文本框约 140px 高；小窗口减小内边距。
- [ ] 笔记开放列表和细分隔线，序号次要，删除图标常驻；总结面板浅灰底，避免强阴影。
- [ ] 所有长文本自动折行，子网格 min-width:0；页头、表单底部允许合理换行；焦点明显，禁用明确，遵循减少动画偏好。

### Task 4: 集成、浏览器验证与交付

**Files:** 上述组件、样式、计划状态；截图置于忽略的临时目录用于 QA，设计稿作为长期参考保留。

- [ ] 运行 `npm test`、`npm run build`、`npm run check:contracts`、`npm run validate`，预期全部成功。
- [ ] 使用运行中的 Anna harness 检查页面，验证空态及保存、删除、重新读取、Summarize；确认真实 no-llm 错误。
- [ ] 用既有独立 harness 测试记录 storage.get / storage.set / tools.invoke；无 iframe 直接 llm 请求。
- [ ] 在 960 × 900 对照主设计比例，在 640 × 640、360 × 640 检查首屏、滚动、长文本和按钮。
- [ ] `view_image` 对照设计图和最终截图；检查至少文案、布局、字号、配色、间距、图标六项。修复可见偏差。
- [ ] 独立评审组件质量与 question.md 契约；修复真实发现后只重跑受影响验证。
- [ ] 更新计划状态，提交实现，保持本地预览运行并打开供用户体验。
