# Mini Notes Onboarding and Summary Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 实现用户已确认的首次使用说明、准确的无模型提示及必要安全加固，同时保持 question.md 的完整 Anna 平台契约与现有浅色 UI。

**Architecture:** 引导组件使用独立 Anna storage key，作为笔记状态机之外的可失败功能。总结继续固定调用 tools.invoke → Executa → sampling，增加响应限额和受控错误；模型输出始终为文本。契约检查锁定既有权限，公开证据默认脱敏。

**Tech Stack:** React / TypeScript / CSS、Go、Vitest、Node test runner、真实 Anna harness 与官方 mock sampling。

---

### Task 1: 使用引导（子 agent）

**Files:** 新建 `src/onboarding/useUsageGuide.ts`、`src/components/UsageGuide.tsx`、`tests/frontend/onboarding.test.tsx`；扩展 `src/styles.css`。

- [x] 先测试首次缺失标记、已确认标记、未知版本、读取拒绝/挂起、写入拒绝/挂起、切换 runtime 与卸载清理。
- [x] 实现 `UsageGuide({ runtime?: AnnaRuntime })`，连接后通过 `mini-notes:onboarding:v1` 读取 `{ schemaVersion:1, seenGuideVersion:1 }`。只在缺失标记时自动显示；未知值不覆盖。
- [x] 关闭/主按钮先立即关闭，再有限等待写入标记；错误只显示偏好未保存，不暴露原始错误、不接入 NotesRepository。
- [x] 随时可重开的“使用说明”按钮；弹窗具有名称、焦点管理、Esc 关闭与窄屏滚动。
- [x] 文案说明默认无需账号或模型；列出 UI 和独立 sampling 两条验收路径；不收集凭据、不声称改变 Host 模式、不主动调用模型。

### Task 2: Executa 安全边界（子 agent）

**Files:** `executas/mini-notes-summarizer/main.go`、相关 Go 测试。

- [x] 先测试摘要 UTF-8 字节上限 16384、stopReason 64 字节、恶意输入协议隔离和恶意输出只作为文本。
- [x] Go 返回前拒绝超限、空白、非法 Unicode 或非 text 响应，不生成或拼接替代摘要。
- [x] Host 错误仅返回稳定错误码和安全说明。只有 `code=-32603` 且精确消息 `harness started with --no-llm` 才保留该标准说明；其他原始诊断不得回传。
- [x] 保留固定 systemPrompt、includeContext:none、512-token预算、invoke关联、超时、单并发、stdio规范。

### Task 3: 契约与证据（子 agent）

**Files:** `scripts/check-contracts.mjs`、新的纯断言/证据辅助模块、`scripts/test-harness.mjs`、`tests/security/*.test.mjs`。

- [x] 先写变异权限测试：额外工具、agent/files权限、外部origin、额外Executa capability必须拒绝；既有 llm.complete ACL兼容声明必须保留。
- [x] 对 App 权限及 Host API 集合做明确白名单断言，保持 schema2 与工具 identity 对齐。
- [x] 证据序列化前统一脱敏笔记、摘要、凭据、token和会话ID；保留方法、顺序、结果状态及测试需要的结构。内存断言仍检查真实测试输入。
- [x] 原 UI harness 测试先关闭首次引导，验证帮助入口与 no-llm 说明；不注入 UI mock 总结。

### Task 4: 前端集成与摘要安全（主 agent）

**Files:** `src/summary/service.ts`、新增总结错误模块、`src/notes/useMiniNotes.ts`、`src/components/{MiniNotesApp,SummaryPanel}.tsx`、现有前端测试及 helpers。

- [x] 先测试摘要限额、无模型精确识别、其他-32603错误不误判、错误脱敏、恶意文本不产生动作。
- [x] 返回已连接 runtime 给独立引导组件；在页尾放置帮助入口，保持业务 ready 条件。
- [x] 总结状态增加 `no-llm`；在总结面板内以说明样式呈现原标准错误与 `npm run test:sampling`，不设假 summary，不因该状态禁用后续 invoke。
- [x] 前端对返回摘要/stopReason做与Go一致的限额校验；工具异常显示安全错误码与提示，不展示原始敏感内容。
- [x] 更新测试存储适配器以真实区分 notes/guide key，笔记调用计数断言只统计 notes key。

### Task 5: 真实验收与交付

- [x] 运行前端、Go、协议、安全测试以及 build、contracts、validate。
- [x] 独立真实 harness 验证首次引导、关闭/帮助、笔记增删重读、预期 no-llm 与实际 storage/tools RPC；检查360/640/960宽度、键盘和控制台。
- [x] 官方 mock sampling 验证成功路径；mock只证明协议/文本边界，不宣称真实模型抗注入效果。
- [ ] 运行本机 archive 构建与 smoke；保持旧 release 不变，涉及工具版本更新时同步 identity/version并发布新的三平台产物（本机已通过，等待远端原生发布）。
- [x] 独立契约与质量评审，修复发现后重跑受影响检查。
- [x] 更新 README 与验收证据，提交并同步既有授权仓库；保留可体验的本地服务。

用户已明确批准上述方案实施；无需增加模型配置、账号授权或新的权限。
