# Mini Notes with LLM Summary

本地运行的 Anna App 作业。笔记创建、读取和删除走 Anna Host storage；总结走 `anna.tools.invoke → Go Executa → reverse sampling/createMessage`。没有自建 HTTP 后端、浏览器存储兜底或本地规则摘要。

## 环境与安装

- Node **26 LTS**（本项目验证 26.13.0）；也可用当前测试依赖支持的 24.15+ / 22.22.2+。Node 25 不在支持范围。
- Go 1.27.3（构建工具时使用；发布的 binary 不需要 Go）。
- [uv](https://docs.astral.sh/uv/getting-started/installation/) 与 Python 3.10+（Anna 官方 bridge 的开发依赖）。
- npm、Git。无需 Anna 账号、`anna-app login`、真实模型 API key 或云数据库。

```sh
npm ci
npm run doctor
npm run check:contracts
npm run build
npm run validate
```

Anna CLI 为本地 devDependency `@anna-ai/cli@0.1.61`，脚本无需全局 anna-app。npm lockfile 固定 SDK/schema；`python-constraints.txt` 固定 core 0.26.1。doctor 预热 uv 缓存并记录版本，避免首次 bridge 安装超过 CLI 的启动等待。第一次安装需要网络，之后测试不调用真实模型。

脚本会优先使用项目 `.tools/go/bin/go`（Windows 为 go.exe），否则使用 PATH 中的 Go；uv/cache/go cache 都放 `.tools/`。本机便携 Node/Go 不提交仓库，干净 checkout 请自行安装上述工具。

## 项目结构

```text
src/anna/                 SDK 连接、Host 类型、工具 identity
src/notes/                版本化笔记、storage repository、应用状态
src/summary/              tools.invoke 和结果校验
src/components/           composer、列表、总结和提示
manifest.json             Anna App 配置和 Host ACL
app.json                  App 元信息
executas/mini-notes-summarizer/
  main.go / notes.go      双向 JSON-RPC、sampling、输入校验
  manifest.json           describe 返回的工具描述
  executa.json            无登录本地发现与 go run . 启动器
fixtures/sampling/        官方独立 runner 的 sampling fixture
scripts/                  构建、测试、验包、发布入口
tests/                    前端、手动协议 host、打包测试
.github/workflows/        CI 与三平台 Release
docs/acceptance.md        实际验收结果与平台兼容说明
evidence/                 使用测试样本生成的脱敏证据
bundle/                   Vite 构建输出，不提交
dist/                     发布 archive，不提交
```

`manifest.json` 描述 App 的工具依赖和窗口/授权；`bundle/` 是 Anna iframe 载入的静态 UI。`ui.bundle.entry` 相对于 bundle 根目录，因此是 `index.html`，对应构建后的 `bundle/index.html`。

Executa 是持续运行的 stdio 子进程；工具 manifest 与 App manifest 职责不同。工具只请求 sampling，不保存 notes。Host storage 是 App 数据权威入口；本题无登录时使用 legacy in-memory runtime_state，真实 APS 属于平台的持久存储实现，本题不要求访问云端 APS。sampling 让工具借用 host 模型或官方 mock 回复，工具不拥有模型凭证。binary archive 则把 Executa 编译为无需解释器的发布产物。

## UI harness：必须使用 Anna 开发模型

```sh
npm run build
npm run validate
npm run dev:harness
```

validate 执行 `anna-app validate --strict --bundle ./bundle`；harness 执行 `anna-app dev --no-llm --storage legacy --bundle ./bundle`。打开终端打印的 dashboard（默认 [localhost:5180](http://localhost:5180/)），App 在其中 `#app` iframe 运行。不要直接打开 index.html 或用普通 Vite 页面代替 Anna 验收。

开发时也可用 `npm run dev` 运行构建 watch 与 Anna harness。退出时 Ctrl+C。bundle 修改只重载内层 iframe；外层 dashboard 刷新或重启 dev 可能清空 legacy 内存数据，这是题目允许的生命周期。

在新会话按下表验收：

| 步骤 | 操作 | 预期 |
| --- | --- | --- |
| A0 | 打开 App | Runtime 连接、storage.get、空列表 |
| A1 | 输入空白 | 无法保存，未调用 storage.set |
| A2 | 保存“明天联系客户” | 序号1，保存成功后输入清空 |
| A3 | 保存“修复登录 bug” | 序号2，再次清空输入 |
| A4 | 删除序号1 | 立即隐藏，storage 更新，剩余笔记仍为序号2 |
| A5 | 保存“整理 Workshop 想法” | 新序号3 |
| A6 | 点击“重新读取” | 显式 Host get，仍显示序号2/3，不刷新外层 |
| A7 | 点击 Summarize | tools.invoke 的 notes 是上述两条；显示 no-llm 预期错误 |

在 `--no-llm` 模式，Summarize 仍真正调用 `anna.tools.invoke`、本地工具和 reverse sampling。由于 host 禁用 LLM，预期错误类似 `SAMPLING_HOST_ERROR: [-32603] harness started with --no-llm`。这是 UI 调试路径的预期结果，**不代表后端 sampling 实现失败**。本路径不注入假成功摘要；后端成功由下一节单独验证。

可自动驱动同一真实流程：保持 harness 运行，在另一终端执行 `npm run test:harness`。本机使用独立无头 Edge，不读取个人浏览器资料；Linux CI 使用 `PLAYWRIGHT_CHANNEL=chromium` 和 `npx playwright install --with-deps chromium`。截图只保存 App，不保存带临时 window token 的 dashboard 地址栏。

## 后端：官方 mock sampling 单独验证

```sh
npm run test:sampling
```

此脚本使用 argv 数组运行真实官方命令，避免 Windows/Bash 的 JSON 转义差异。等价 Bash 命令为：

```sh
npx anna-app executa dev --dir ./executas/mini-notes-summarizer \
  --mock-sampling ./fixtures/sampling/success.jsonl \
  --invoke summarize --args '{"notes":["明天联系客户","修复登录问题"]}' --json
```

PowerShell 可直接使用 `npm run test:sampling`；不要把 Bash 反斜杠续行照搬到 PowerShell。

fixture 使用官方 runner 格式，一行一条，非完整 JSON-RPC response：

```jsonl
{"ns":"sampling","method":"createMessage","result":{"role":"assistant","content":{"type":"text","text":"MINI_NOTES_FIXTURE_7E91：客户跟进和登录修复。"},"model":"mock-model","stopReason":"endTurn"}}
```

脚本先严格验证 fixture，再断言最终 summary 精确等于 sentinel。CLI0.1.61 在 fixture 错误或未匹配时可能返回 `(mock) no fixture matched` 的成功形态，不能只检查 success=true。

官方 runner 不传 invoke context，所以工具在没有 host invoke_id 时为每次调用生成独立 local-UUID，在 metadata 和 reverse context 携带同一值。App harness 提供的 invoke_id 则原样传回，不用 JSON-RPC id 替代。

## 手动 JSON-RPC 与 sampling 证据

```sh
npm run test:go
npm run test:protocol
```

协议脚本启动真实编译后二进制，相当于一个可交互的手动 host，依次发送 initialize、describe、invoke；读到工具输出的 `sampling/createMessage` 后核对 notes/prompt/context/metadata，向 stdin 回送相同 reverse ID 的 response，再检查最终 invoke response。

主要请求形态：

```jsonl
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2.0","capabilities":{"sampling":{}}}}
{"jsonrpc":"2.0","id":2,"method":"describe"}
{"jsonrpc":"2.0","id":3,"method":"invoke","params":{"tool":"summarize","arguments":{"notes":["明天联系客户"]},"context":{"invoke_id":"manual-1"}}}
```

第三条请求后不要马上关闭 stdin：必须先读取 reverse request，然后写回例如下列消息，`sampling-1` 必须替换为实际输出的 ID：

```json
{"jsonrpc":"2.0","id":"sampling-1","result":{"role":"assistant","content":{"type":"text","text":"手工 host 返回的摘要"},"stopReason":"endTurn"}}
```

最终结果的 `data.summary` 必须等于 host 返回文本。工具参数使用 Anna `parameters[]`，describe.result 本身是 manifest；stdout 仅为 JSON-RPC 消息，包含协议必须的 reverse request，日志只进 stderr。多次请求沿用同一进程；等待 sampling 时继续处理 response/health。单个活动 summarize 以外的调用返回 busy，不影响活动请求。

检查 `evidence/protocol.jsonl` 的 direction、message/raw，串起正向 invoke、reverse sampling request、对应 host response、最终 invoke response。`protocol-report.json` 记录被测 executable 绝对路径和 SHA-256。脚本还测试大数字ID原样保留、busy、连续调用、Host错误、无效内容、显式v1拒绝和EOF；Go测试覆盖取消、deadline、帧大小、Unicode与生命周期竞态。

指定其他已构建二进制：

```sh
node scripts/test-protocol.mjs --executable /absolute/path/to/binary \
  --transcript /tmp/protocol.jsonl --report /tmp/protocol-report.json
```

这条手动 host 检查补充官方 mock runner，不能替代上一节命令。没有任何 summary fixture 注入到 App UI harness。

## 如何核对 storage 与工具调用

- Anna dashboard 右侧 RPC LOG 可直接看 `storage.get`、`storage.set`、`tools.invoke` 实参和结果。笔记读写 key 为 `mini-notes:document:v1`。
- `npm run test:harness` 抓取真实 `/api/session/call` 的 request/response，保存到 `evidence/ui-host-rpc.jsonl`；每行包含 ns/method/args/response，`ui-harness-report.json` 记录断言。这个自定义网络证据格式**不是** Anna recording，不交给 fixture verify。
- 若需要官方 recording，dashboard 点击 record 开始，执行 A0–A7，再点击停止下载 JSONL。要包含首次读取，可开始录制后只重载内层 iframe，不能刷新外层 dashboard。下载的官方格式可用 `npx anna-app fixture verify <file>` 和 `fixture summarize <file>` 检查。提交前去掉 auth/token 等敏感字段。
- UI 记录中只有 storage/tools 和 SDK window 调用；不会出现前端 llm 调用。后端 `protocol.jsonl` 中则必须出现 reverse `sampling/createMessage`。
- `evidence/cli-sampling.json` 是官方独立 runner 的返回值，只有它加上手动协议 transcript 才能共同证明来源与正确请求内容。

## 二进制打包与验包

```sh
npm run package:native
npm run smoke:archive
npm run test:packaging
```

打包脚本检测 Go 工具链宿主/系统架构并核对 GOOS/GOARCH，拒绝不匹配的隐式交叉编译环境变量。Go 使用 CGO_ENABLED=0，最终发布物为独立 executable。macOS 使用 tar.gz，Windows 使用 zip。

archive root 有工具 manifest.json 与 bin/entrypoint，没有额外套层。macOS entrypoint 是 `bin/mini-notes-summarizer`，权限0755；Windows 是 `bin/mini-notes-summarizer.exe`。archive manifest 中 runtime.binary.entrypoint 与实际内容一致，runtime.binary.permissions 与 App 顶层 permissions 是不同概念。

smoke 解压到全新目录，运行其中二进制的 describe 及同一完整双向协议脚本。报告记录真实路径/hash，不测试旧源码。Windows 本机不假称已运行 macOS binary；三平台原生 smoke 由 workflow 各自完成。

## GitHub Actions 与交付

`.github/workflows/ci.yml` 执行依赖、测试、构建、strict validation、官方 sampling 和本机包检查。`.github/workflows/release.yml` 使用三个原生 runner，构建并验包后统一上传 **GitHub Release assets**；workflow artifacts 只负责 job 间传递。

发布触发方式：推送 `v0.1.0` 等版本 tag，或在 Actions 的 Release workflow 中手动输入已经存在的 tag。tag 必须对应源码版本，dispatch checkout 的实际 commit 与 release metadata 一致；不把默认分支误贴到其他版本。

预期 Release 文件：

```text
mini-notes-summarizer-0.1.0-darwin-arm64.tar.gz
mini-notes-summarizer-0.1.0-darwin-x86_64.tar.gz
mini-notes-summarizer-0.1.0-windows-x86_64.zip
SHA256SUMS
release-metadata.json
```

三个构建全部成功才发布，任一个失败不公开半套包。公开 Release 重跑优先下载既有三包、checksum和元数据核验，完整一致则跳过重建，不覆盖公开资产；不要因重新归档的时间戳导致正常重跑误判。无需 Anna PAT、登录或 App 上线，GitHub_TOKEN 的 contents:write 仅用于 Release job。

当前实际执行状态和远程仓库/commit/Release 链接以 `docs/acceptance.md`、`evidence/delivery.md` 为准；workflow 文件存在或静态审阅不等于三平台已成功发布。`npm run verify:harness` 可以自动启动全新官方会话、运行真实 UI 测试并停止自有进程。

## 状态与限制

固定序号递增，删除后允许缺口；相同内容可保存多条。数据有版本且严格校验，读取失败不能当空文档覆盖。明确写入失败保留输入或回滚；超时等结果未知时进入确认隔离，重新读取只确认，不强制解锁；重连也不能证明旧写入取消。最后已知笔记仍可见，结束 legacy 会话前明确提示数据会重置。

单条最多1,000个Unicode code point、最多100条、所有正文UTF-8字节和≤24,576、文档≤192KiB；保存前提示，合法已保存列表都可发起完整总结。summary仅在当前UI保留，笔记变化后旧结果失效，不把迟到结果套到新列表。单实例队列不声称解决多窗口协同。

## 平台兼容说明

- App 使用 schema2 以保留题目要求的顶层 permissions；schema3 已移除此字段。实际授权仍是 ui.host_api。
- runtime-local0.2.0a30 把 reverse sampling 转为 llm.complete 并复查 App ACL，所以额外声明 ui.host_api.llm:[complete]。这是固定本地 bridge 兼容，不是让前端直接调用模型。
- App本地bridge直接invoke，独立runner先initialize。工具支持前者兼容路径，并在后者返回v2 client_capabilities.sampling。
- tools.invoke 实际返回业务payload，Host/Tool失败使SDK reject；不继续套 `.result.data`。
- dashboard favicon404是官方外层页面warning，与App资源错误分开记录。

更详细的发布包源码核对和P0证据见 `docs/p0-contract-notes.md`、`docs/acceptance.md`。

## 常见问题

- bridge超时：先 `npm run doctor` 预热相同uv缓存，检查网络及Python；不需要login。
- 找不到Go/uv：安装对应工具并确认PATH；不要把go run启动器当发布物。
- bundle未找到：先build，manifest entry是相对bundle根目录的index.html。
- 端口占用：停止旧harness或在 `npm run dev:harness -- --port 5181` 指定端口，自动测试同时设置HARNESS_URL。
- 工具找不到：核对executa.json必须同时有tool_id与type，及App引用完全一致。
- no-llm错误：按上述两条独立路径分别验收，不以规则摘要掩盖。
- 输出不是JSON：业务日志必须stderr，stdio不能有banner；用test:protocol检查。
- 读取异常：用“重新读取”，不要清空底层存储来假装恢复。
