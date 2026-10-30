# First Screen and Focus Implementation Plan

> **For agentic workers:** Use subagent-driven development for the guide fix and independent review; keep shared-file edits with the primary agent.

**Goal:** 按用户已批准的截图评审建议，修复首次引导关闭后的焦点跳页，改善默认窗口首屏并精简引导，保留 Anna 调用链。

**Architecture:** 修改呈现、模态焦点恢复与 manifest 窗口尺寸。笔记 repository、Host API 权限、Executa 和 sampling 协议保持现有实现。原始官方 Harness 验收入口保留；按用户后续“随浏览器自适应”要求，另加本地预览代理，仅为官方 dashboard 注入布局CSS，其余HTTP/WS原样透传。不修改第三方包。

**Tech Stack:** React / TypeScript / CSS；Vitest 与真实 Anna Harness + Playwright / Edge。无新增依赖。

## 批准范围与视觉约定

- 继续白底、石墨文字、蓝色操作、系统字体和开放式笔记列表。
- 原始验收窗口由640×640调整为864×760；最小360×360、最大1280×1200保留。960宽会使官方外壳在1280浏览器溢出82px，因此采用更稳妥的固定回退尺寸。最终体验入口按浏览器可用空间自适应，不固定为864宽。
- 宽窗口展示笔记/总结双栏，较窄窗口单栏；较矮窗口适度压缩页边距、标题和输入高度。完整正文自然滚动，不固定高度裁切内容。
- 首层引导只说明笔记可直接使用和默认无模型验收的总结行为；技术说明展开查看。不检测或修改 Host 模型配置，不生成替代总结。
- 首次自动引导关闭回到输入框；用户手动打开帮助则恢复原焦点，均使用 preventScroll 保持位置。

## Task 1: 复现与焦点修复

**Files:** `src/components/UsageGuide.tsx`、`src/components/MiniNotesApp.tsx`、`tests/frontend/onboarding.test.tsx`。

- [x] 在独立真实 Harness 会话记录关闭前后 scrollY、输入框位置与 activeElement。
- [x] 增加失败测试：初次关闭聚焦输入 ref；手动关闭恢复 opener，focus 不引起额外滚动。
- [x] 使用可选 `initialFocusRef` 传递输入框；恢复焦点时调用 `focus({ preventScroll: true })`。
- [x] 真实浏览器复验后再开始布局修改，确认 scrollY 不变、输入框获得焦点。

红态证据：2026-10-30，原始640×614实际视口；关闭前scrollY=0，关闭后358，焦点为页尾使用说明，inputTop=-125。

## Task 2: 首屏和引导

**Files:** `manifest.json`、`src/styles.css`、`src/components/UsageGuide.tsx`、`scripts/test-harness.mjs`、`README.md`。

- [x] 首层主操作“开始记笔记”，次操作“验收与模型说明”；开发命令、Host和凭据说明仅在展开区域。
- [x] 设置固定回退864×760，双栏断点800以适配常见浏览器；优化宽/窄/短视口的字号、间距与输入高度；完整保留容量提示、笔记内容与操作。
- [x] 真实Harness回归增加首次关闭和手动帮助的滚动/焦点断言，防止 locator 自动滚动掩盖问题。
- [x] 浏览器检查默认首屏可找到笔记和总结；360宽和360高保持可滚动、无水平溢出。
- [x] 更新README中当前交互名称、默认尺寸与无模型说明；历史交付证据不改写为本次结果。

## Task 3: 验收和本地体验

- [x] 新增 `scripts/responsive-preview.mjs` / `scripts/preview.mjs`，启动真实Anna，固定loopback上游，仅根HTML增强布局；HTTP/WS透传、无敏感日志，退出清理自身子进程。
- [x] Node单测覆盖预览代理注入边界、原始POST/查询/响应、WS双向与非开放代理限制；真实浏览器缩放证明App视口实际随浏览器变化。
- [x] `npm run dev` / `dev:preview` 提供自适应体验，`dev:harness` 保持题目原始验收路径。

- [x] `npm test`、`npm run build`、`npm run check:contracts`、`npm run validate`。
- [x] `npm run test:security`、`npm run verify:harness`；后者验证真实 storage/tools 调用及 no-llm 提示。
- [x] `npm run test:sampling` 独立验证 Executa reverse sampling 成功链路。
- [x] 独立评审改动，对照question.md确认权限、存储和调用链未改变，原文件SHA256保持。
- [x] 在本地5198启动最终Harness，在应用内浏览器打开可体验页面；保留运行服务。

## 真实回归补充：总结读取交接

- [x] 用真实repository与deferred Host读取复现：已读非空快照在同版本后台读取中，已捕获的总结点击被ready guard无声丢弃。
- [x] 只允许无mutation的ready/loading已读非空快照继续排队刷新；发起/接收总结均核对最新fingerprint，真实笔记变化、写入未确认与失败状态仍保护。
- [x] 回归证明首次点击、刷新交接、同版本读取下返回、真实笔记变化/未知写入保护；再顺序执行原始与自适应真实Harness，避免并发写同一证据文件。

不增加真实模型配置、不替换官方Harness、不伪造UI总结、不改历史Release。Browser插件未安装，既有Playwright用于精确尺寸验证，IAB用于最终体验。
