# Real LLM Delivery Implementation Plan

**Goal:** 用户已授权把已实测的真实LLM体验整理为可复现启动命令、文档及脱敏证据，提交推送并确认CI；默认启动与CI仍无模型，不自动重复付费请求。

**Architecture:** 复用现有预览生命周期与透传代理，增加显式 `scripts/dev-real.mjs` → `runPreview(argv, { llm: 'real' })`。默认off路径参数与行为保持。real默认5218、Anna正式站、`mini-notes-tlak-real`，使用唯一的`.tools/real-preview-*/bundle`，构建一次、官方Host `--no-watch`，不共享/重载当前无模型bundle。账号仅通过官方 `whoami --json` 捕获元数据作本地预检，不读取/打印PAT，也不自动login、开通开发者、选择handle、充值或请求总结。

**Tech stack:** Node ESM、官方CLI0.1.61、Vite、Node test；无新增依赖，App/Executa/manifest/question.md不改。

## Interfaces and boundaries

- `parsePreviewOptions(argv, 'off'|'real')` 保持off原返回shape。real新增`account`、`appSlug`，接受官方同名 `--llm-account` / `--llm-app-slug` 和原数值端口选项；help不读凭据、不构建、不发网络。
- account只接受无userinfo/query/hash/path的HTTPS origin（HTTP仅loopback），appSlug为有界小写字母数字/连字符；不接受API Key/PAT或`--llm real`等伪兼容选项。
- real启动先保护占用端口，再跑官方`whoami --json`本地元数据检查（host匹配/过期/损坏）。捕获内容不进入日志；账号状态不足时在build和远程注册之前退出。
- mode与官方Host参数组装为纯函数可测试：off必有`--no-llm`；real不含off/mock开关，含`--storage legacy`、选定账号/slug、独立bundle和`--no-watch`。不添加自动Summarize或收费模型调用。
- real启动日志只允许固定错误分类：未登录/过期、开发者未开通/handle缺失、401/403、网络/代理、通用启动失败。不得回显原始Host正文、凭据片段或诊断URL。就绪后停止保留启动诊断。
- real失败/取消/退出只释放自己端口与进程树；目录只在自身`.tools`下生成，不递归删除任何已有用户目录。当前5218会话保持；正式启动烟测用其他空闲端口，只检查页面可达，不付费调用模型。
- CI只运行离线参数/元数据/负路径和原有mock测试，不能要求Anna账号或访问真实模型；真实成功证据保留原实测来源与时间，不能伪称由新命令重跑付费总结。

## Tasks

- [x] TDD：real选项、参数、auth元数据、help与缺账号/过期/占用端口负路径，先RED再实现。
- [x] 复用preview生命周期，补真实模式固定诊断与独立构建；加入package script。
- [x] README写注册/开发者控制台/handle/设备授权/代理/启动/额度与排错，区分真实体验、默认无模型和官方独立mock sampling。
- [x] 公开证据只投影统计、路径、状态码、模型名、摘要哈希；不含账号ID、PAT、临时token、笔记/摘要正文或个人路径。
- [x] 本地离线回归、构建/strict/contracts、已有真实会话测试；正式real命令另端口GET烟测，不执行Summarize，不影响当前5218。
- [x] 独立只读评审，修复发现；question.md校验原哈希。
- [ ] 提交推送，跟踪本轮CI并将实际链接写入验收记录，再确认最终head CI success与工作区干净。
