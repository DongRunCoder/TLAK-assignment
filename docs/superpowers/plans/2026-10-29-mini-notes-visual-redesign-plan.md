# Mini Notes 视觉改版 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 将已确认的浅色极简设计稿实现为真实可操作的 Anna Mini Notes，保留 question.md 全部平台契约。

**Architecture:** 沿用现有 hook、repository、summary service。只修改呈现组件与 CSS，增加小型 SVG 图标组件。样式由独立子 agent 实现，主 agent 集成组件、运行真实 harness 并对照截图修正。

**Tech Stack:** React、TypeScript、Vite、CSS、原生 SVG；既有 Vitest 与 Anna harness。

---

### Task 1: 固定设计与回归基线

**Files:** `docs/superpowers/specs/2026-10-29-mini-notes-visual-redesign-design.md`，`docs/superpowers/specs/assets/mini-notes-light-concept.png`，现有 `tests/frontend/*`。

- [x] 读取 question.md、组件、状态逻辑、harness 测试与窗口配置。
- [x] 生成完整设计图，记录颜色、字号、组件、响应式、状态和可访问性；获得用户确认。
- [x] 提交设计与计划；运行现有 `npm test` 作为回归基线。本次不新增镜像 CSS 的单元测试，视觉通过真实浏览器核验。

### Task 2: 更新组件结构

**Files:** 修改 `src/components/MiniNotesApp.tsx`、`src/components/NotesList.tsx`；新增 `src/components/Icon.tsx`。

- [x] 页头采用下列真实状态结构，保留 h1 与原有状态文本：

```tsx
<header className="app-header">
  <div><h1>Mini Notes</h1><p className="intro">让想法，清晰起来。</p></div>
  <span className="connection-state" data-status={app.runtimeStatus}>
    <span className="connection-dot" aria-hidden="true" />
    {app.runtimeStatus === 'ready' ? 'Anna 已连接' : 'Anna 连接'}
  </span>
</header>
```

- [x] 将表单标为 `composer`；将容量行放在表单后，保留 ID、字节内容和 aria-describedby。
- [x] 增加 `content-layout` 容器，顺序为笔记区、总结区；总结标题、原 `SummaryPanel`、`Summarize` 按钮依次排列。现有业务调用和 disabled 条件保持原样。
- [x] 添加三个纯展示 SVG 图标，统一 24px viewBox、currentColor、round cap / join、无可访问名称。刷新用双圆弧，删除用垃圾桶，总结用四角星。删除按钮保留 `aria-label` 和 title，按钮至少 36px 点击区域。
- [x] 保留空态、所有真实异常提示、测试标识及完整纯文本内容。

### Task 3: 落实样式系统

**Files:** `src/styles.css`，由子 agent 独立负责。

- [x] 用 CSS 变量建立固定色板与字体栈：

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

- [x] 白底、最大内容宽 864px、宽屏约 48px 页边距、56px 标题；640px 与 360px 缩放字号和间距。
- [x] 输入区细边线、20px 圆角、24px 内边距，文本框约 140px 高；小窗口减小内边距。
- [x] 笔记开放列表和细分隔线，序号次要，删除图标常驻；总结面板浅灰底，避免强阴影。
- [x] 所有长文本自动折行，子网格 min-width:0；页头、表单底部允许合理换行；焦点明显，禁用明确，遵循减少动画偏好。

### Task 4: 集成、浏览器验证与交付

**Files:** 上述组件、样式、计划状态；截图置于忽略的临时目录用于 QA，设计稿作为长期参考保留。

- [x] 运行 `npm test`、`npm run build`、`npm run check:contracts`、`npm run validate`，预期全部成功。
- [x] 使用运行中的 Anna harness 检查页面，验证空态及保存、删除、重新读取、Summarize；确认真实 no-llm 错误。
- [x] 用既有独立 harness 测试记录 storage.get / storage.set / tools.invoke；无 iframe 直接 llm 请求。
- [x] 在 960 × 900 对照主设计比例，在 640 × 640、360 × 640 检查首屏、滚动、长文本和按钮。
- [x] `view_image` 对照设计图和最终截图；检查至少文案、布局、字号、配色、间距、图标六项。修复可见偏差。
- [x] 独立评审组件质量与 question.md 契约；修复真实发现后只重跑受影响验证。
- [x] 更新计划状态，提交实现，保持本地预览运行并打开供用户体验。

## 实际核验与设计对照

2026-10-29 完成：32 项前端测试、生产 build、契约检查、严格 manifest 校验，以及独立 Anna harness 回归（16 次实际 Host 调用）均通过。真实浏览器覆盖空白禁存、创建清空、删除、重读、1000 连续字符换行、no-llm 的真实错误与 Tab 焦点；未发现应用控制台错误。

先通过 IAB 打开实际页面并操作，再使用既有 Playwright/Edge 测试扩展到准确尺寸。当前未安装独立 Browser 插件；IAB 可完成体验检查，Playwright 用于现有自动化和调整 Anna 调试外壳的测试尺寸。宽屏测试同时调整外壳 `#frame` 与内部 iframe，消除宿主默认 640px 容器带来的截图裁切。实际 iframe 视口分别核验为 960 × 900、640 × 640、360 × 640，均无水平溢出。

已在同一轮使用 view_image 查看已确认设计图与最新完整截图，核对如下：

| 对照项 | 实际结果 / 处理 |
| --- | --- |
| 文案与信息架构 | 标题、简介、输入、笔记、总结和页尾顺序与设计一致；无新增首屏装饰文案；取消 ANNA APP 标签 |
| 布局 | 960px 画布内 864px 内容宽；笔记与总结列实测 522.5px / 313.5px；小窗口单栏 |
| 字号与字体 | h1 实测 56 / 40 / 34px；Windows 中文正文实际使用 Microsoft YaHei；系统字体在各平台有自然字形差异 |
| 配色 | 白底、石墨正文、浅灰总结面板和蓝色操作与设计一致 |
| 间距与容器 | 20px 圆角、24px 输入区内边距、开放笔记行和细分隔线；完整宽屏显示全部核心区域 |
| 图标与可访问性 | 统一细线 SVG；删除图标保留可访问名称；焦点可见；占位与序号灰色、悬停蓝色加深以满足普通文字对比度 |

两项有意差异：设计图的示意字节数以真实 UTF-8 计算结果替代；空白输入时保存按钮按原功能契约保持禁用。无未处理的重大视觉偏差。独立评审的契约与代码质量复核通过，对比度问题已修复。

最终截图保存在本次任务的可视化目录：`mini-notes-desktop.png`、`mini-notes-default.png`、`mini-notes-narrow.png`；已有 `evidence/ui-harness*` 与 `evidence/ui-host-rpc.jsonl` 更新为本轮实际 harness 验证结果。提交的 RPC 证据对笔记正文脱敏，保留 16 次接口调用的结构、顺序和返回状态；可复现的固定测试输入见 `scripts/test-harness.mjs`。原始 question.md SHA-256 仍为 `E0CBC6893AD144FA9252650B9285ECC687812E9D80B588E6D52F8CEFC1BD15B3`。
