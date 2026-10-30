# Mini Notes with LLM Summary

本地运行的 Anna App 作业。笔记创建、读取和删除走 Anna Host storage；总结走 `anna.tools.invoke → Go Executa → reverse sampling/createMessage`。没有自建 HTTP 后端、浏览器存储兜底或本地规则摘要。

公开仓库：[DongRunCoder/TLAK-assignment](https://github.com/DongRunCoder/TLAK-assignment)。实际验收见 [docs/acceptance.md](docs/acceptance.md)，远程运行结果见 [Actions](https://github.com/DongRunCoder/TLAK-assignment/actions)。

v0.1.1 发布基线已通过：[完整 CI](https://github.com/DongRunCoder/TLAK-assignment/actions/runs/40919015848)、[三平台原生构建与发布](https://github.com/DongRunCoder/TLAK-assignment/actions/runs/40916741097)、[Release 下载](https://github.com/DongRunCoder/TLAK-assignment/releases/tag/v0.1.1)。本次界面、自适应预览、读取交接与容量恢复改进已通过 [本轮完整 CI](https://github.com/DongRunCoder/TLAK-assignment/actions/runs/41002904092)，验证代码提交 `2c5257aaa707ec1d1c56a1eae9889fe6dd44c333`；本地及远端结果见 [验收记录](docs/acceptance.md)。

会话失效检测、草稿恢复、多标签页与Host重启回归已通过 [会话恢复完整 CI](https://github.com/DongRunCoder/TLAK-assignment/actions/runs/41010316962)，验证代码提交 `bf4424f7bc430685f06859a601484a442216a387`。新增真实会话测试及脱敏报告上传均成功，详细证据见 [验收记录](docs/acceptance.md)。

历史基线 v0.1.0 已验证：[CI 通过](https://github.com/DongRunCoder/TLAK-assignment/actions/runs/40893795605)、[三平台原生构建与发布通过](https://github.com/DongRunCoder/TLAK-assignment/actions/runs/40893795409)、[v0.1.0 Release](https://github.com/DongRunCoder/TLAK-assignment/releases/tag/v0.1.0)、[同 tag 手动重跑安全跳过](https://github.com/DongRunCoder/TLAK-assignment/actions/runs/40894532469)。当前源码版本为 v0.1.1，新增首次引导、无模型提示和总结安全加固；实际验证记录见验收文档。

## 环境与安装

- Node **26 LTS**（本项目验证 26.13.0）；也可用当前测试依赖支持的 24.15+ / 22.22.2+。Node 25 不在支持范围。
- Go 1.27.3（构建工具时使用；发布的 binary 不需要 Go）。
- [uv](https://docs.astral.sh/uv/getting-started/installation/) 与 Python 3.10+（Anna 官方 bridge 的开发依赖）。
- npm、Git。题目默认验收无需 Anna 账号、`anna-app login`、真实模型 API key 或云数据库；可选真实模型体验需要另行授权Anna账号。

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
src/onboarding/           独立使用说明偏好与有限等待
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

开发体验使用 `npm run dev`（或 `npm run dev:preview`），会构建 bundle、启动 watch、启动官方 Anna harness，并在 [localhost:5198](http://localhost:5198/) 提供自适应预览。退出时 Ctrl+C。预览收到bundle更新后仅提示，不自动重载编辑器；手动刷新外层dashboard或重启dev可能清空legacy内存数据，这是题目允许的生命周期。

自适应预览为官方 dashboard 增加布局 CSS 和手动会话恢复适配：窗口跟随浏览器可用空间，日志栏在窄屏移至下方，调试地址不在工具栏展示。HTTP、WebSocket、Runtime SDK、storage 与 tools 请求仍由真实 Anna harness 处理，不是业务 HTTP 后端或 UI mock。代理固定转发到本机上游，只监听 loopback；官方 CLI 的网络监听行为保持原样。`npm run dev:harness` 保留未经预览层调整的题目验收入口，固定默认尺寸为864×760。

体验入口隐藏 Mobile、主题和语言切换：Mini Notes 目前采用自适应的浅色中文界面，没有实现这些切换功能。Desktop 和 record 保留；需要查看官方完整调试控件时使用 `npm run dev:harness`。隐藏规则仅注入预览层，不修改官方 dashboard 文件、App manifest 或 Anna Runtime。

首次连接后会显示“开始使用 Mini Notes”说明，可点击“开始记笔记”、关闭或按 Esc 继续。首次自动引导关闭后焦点回到输入框并保持滚动位置；从页尾“使用说明”手动打开后，关闭会恢复原焦点。首层明确默认无模型验收不会生成真实总结，“验收与模型说明”展开两条独立验收路径。弹窗不安装依赖、不收集凭据，也不检测或修改 Host 的模型配置。

引导标记保存在独立的 Anna storage key `mini-notes:onboarding:v1`，与笔记 key `mini-notes:document:v1` 分离。引导读写各最多等待 2 秒，失败或未知版本不覆盖原值，也不会锁住笔记。legacy 外层会话重置后，引导允许重新出现。

在新会话按下表验收：

| 步骤 | 操作 | 预期 |
| --- | --- | --- |
| A0 | 打开 App，关闭首次使用说明 | Runtime 连接、notes/guide 分 key storage.get、空列表；重开帮助不影响笔记 |
| A1 | 输入空白 | 无法保存，未调用 storage.set |
| A2 | 保存“明天联系客户” | 序号1，保存成功后输入清空 |
| A3 | 保存“修复登录 bug” | 序号2，再次清空输入 |
| A4 | 删除序号1 | 立即隐藏，storage 更新，剩余笔记仍为序号2 |
| A5 | 保存“整理 Workshop 想法” | 新序号3 |
| A6 | 点击“重新读取” | 显式 Host get，仍显示序号2/3，不刷新外层 |
| A7 | 点击 Summarize | tools.invoke 的 notes 是上述两条；显示 no-llm 预期错误 |

在 `--no-llm` 模式，Summarize 仍真正调用 `anna.tools.invoke`、本地工具和 reverse sampling。由于 host 禁用 LLM，预期错误类似 `SAMPLING_HOST_ERROR: [-32603] harness started with --no-llm`。这是 UI 调试路径的预期结果，**不代表后端 sampling 实现失败**。本路径不注入假成功摘要；后端成功由下一节单独验证。

UI 仅在真实收到上述明确错误后显示“当前为无模型验收模式”、独立 sampling 命令及可展开的 Host 返回详情；其他 `-32603`、权限或超时错误仍按失败处理，不会误报验收通过。Summarize 仍可重试，不依据引导选择关闭工具调用。

可自动驱动同一真实流程：保持 harness 运行，在另一终端执行 `npm run test:harness`。本机使用独立无头 Edge，不读取个人浏览器资料；Linux CI 使用 `PLAYWRIGHT_CHANNEL=chromium` 和 `npx playwright install --with-deps chromium`。截图只保存 App，不保存带临时 window token 的 dashboard 地址栏。

上面的测试默认连接原始5180入口。验证自适应5198入口时运行 `npm run test:harness -- --url http://localhost:5198/`；也可设置 `HARNESS_URL`。两者执行同一组真实storage/tools断言，预览层没有替代Host实现。

### 会话失效与草稿恢复

固定版本官方 harness 同时只保留一个开发会话。同一 Host 的另一个标签页新建会话会关闭旧会话；Host重启也会使页面持有的会话失效。App每15秒在可见页面经Anna storage做只读同步，窗口恢复焦点时也检查。连接指示区分检查中、已连接、暂不可用和会话失效；一般参数/模型错误不误报失效，失效后迟到的成功也不会恢复旧连接。

草稿保留在当前编辑器。预览入口会出现“保留草稿并恢复会话”和“复制草稿”；恢复只能由用户点击，旧legacy笔记不保证保留，其他标签页可能随之失效。外壳仅在内存暂存草稿，通过官方`/api/session/create`重建会话并mount新的Anna iframe，握手将草稿交还、React输入框提交后才清除缓存。笔记仍经Runtime读写，不自动重放保存或恢复旧笔记。草稿不进入URL、浏览器持久化、日志或recording。

如果交还前已输入新内容，原输入不被覆盖；复制当前输入并清空后，可用“取回恢复草稿”取回待交还内容。存在mutation或未知写入时，新会话恢复和草稿取回均被禁用；请保留页面并重新读取确认，不能用换会话证明旧写入失败。原始官方入口不注入恢复适配，只提供复制及手动重新打开说明。草稿过长或恢复失败也保持原页，允许复制后手动处理。

预览收到Host watch更新时仅在标题栏显示提示，保留编辑器，不自动重载；需要加载代码更新时，请先保留草稿再手动刷新。此行为仅作用于预览外壳同源`/ws`的reload事件，官方原始调试入口保持不变。

```sh
npm run build
npm run test:session
```

该回归脚本复制bundle并启动自己独占的真实Host、预览与浏览器，覆盖两标签页抢占、实际watch更新、Host停机/重启、手动失败/重试和丢写入回执后的隔离，不访问正在体验的5198会话。也可用`-- --bundle /absolute/path/to/bundle`验证独立构建。CI已接入此命令，报告在`.tools/session-recovery-*/report.json`，无正文或会话凭据。

## 可选：通过 Anna Host 体验真实 LLM

默认 `npm run dev`、`dev:preview`、`dev:harness` 与CI继续使用 `--no-llm`。真实模型体验通过单独的 `npm run dev:real` 显式启动，不作为题目验收前置条件，也不使用第三方模型API Key。

### 1. 注册、开通开发者权限并选择 handle

在 [Anna正式站注册](https://anna.partners/register)并[登录](https://anna.partners/login)，然后进入[开发者控制台](https://anna.partners/developer)。如出现“Become a developer”，由账号本人阅读并确认开发者条款、选择自己的公开handle并完成开通。handle是应用命名空间，例如 `@your-handle/mini-notes-tlak-real`，不是GitHub用户名。项目不绑定作者的账号或handle。

### 2. 完成官方 CLI 设备授权

```sh
node scripts/anna.mjs login --host https://anna.partners --no-browser
```

打开CLI打印的官方链接，在已登录的Anna网页中核对设备码并由本人批准。凭据由官方CLI保存到用户配置目录；本项目固定的CLI0.1.61使用 `~/.config/anna/credentials.json`，设置 `XDG_CONFIG_HOME` 时位于其 `anna/credentials.json`。不要复制凭据到仓库、前端、聊天或截图。`.env`不会被本启动器加载，模型Key/PAT也不是启动参数。

`node scripts/anna.mjs whoami --json` 可在本机检查账号状态，但其原始输出含凭据预览，不应公开粘贴。启动器仅检查所选host及过期元数据，不回显这段输出。PAT只是开发者授权，模型权限与可用额度仍由Anna服务端检查。

完成CLI授权后，如账号已开通但仍提示缺少handle，可运行以下官方命令（把 `your-handle` 替换为自己的名称；网页中已选定则跳过）：

```sh
node scripts/anna.mjs account set-handle your-handle --host https://anna.partners
```

### 3. 启动独立真实模型入口

```sh
npm run dev:real
```

默认入口为 [localhost:5218](http://localhost:5218/)，账号host为 `https://anna.partners`，测试用开发应用slug为 `mini-notes-tlak-real`。官方CLI会注册或复用该账号拥有的开发应用。固定CLI0.1.61在不带 `--no-llm` / `--mock-llm` 时即使用真实模式；旧文档的 `--llm real` 不是本版本支持的参数。

此命令构建一次，使用唯一的 `.tools/real-preview-*/bundle`，以 `--storage legacy --no-watch` 启动独立官方Host，并提供同样的自适应预览与草稿恢复。它不会改写默认无模型入口的bundle，也不会关闭占用端口的已有进程。退出时Ctrl+C，仅清理该命令自己创建的服务树。生成的独立bundle是可删除的本地构建缓存，不提交仓库。

可指定其他空闲端口、已授权的Anna环境及自己的开发应用slug：

```sh
npm run dev:real -- --port 5228 --llm-account https://anna.partners --llm-app-slug mini-notes-tlak-real
```

`--host-port` 可指定内部Host端口，默认自动选择可用端口。账号只接受服务根地址，不填 `/developers` 或文档中的 `nexus.example.com` 占位地址；HTTP仅用于本机loopback服务。不同host的凭据分别保存，正式站与staging不能只替换URL而省略对应授权。

### 4. 人工验证一次真实总结

启动命令本身不会调用总结。打开新入口、保存几条无敏感信息的测试笔记，再点击 **Summarize**；成功时页面显示Host返回的真实文本。真实请求会使用账号额度，模型选择与计费由Anna处理；项目不固定某个模型，也不自动充值或在失败时生成替代总结。

链路仍为 `Anna iframe → storage Host API → tools.invoke → Go Executa → reverse sampling/createMessage → Anna Host LLM → UI`。前端和Executa都不持有模型Key。请只保留同一个Host的一条活跃体验标签页，多标签页抢占与legacy生命周期见上节。

已完成的一次人工实测见 [evidence/real-llm-report.json](evidence/real-llm-report.json)：2026-10-30，Anna返回 `google/gemini-3-flash-preview`，耗时4975ms；远端mint/complete均HTTP200，Host、工具与UI摘要SHA-256一致。该记录来自正式启动命令加入前的独立官方CLI验证，未伪称本轮重新付费调用；它不保证未来模型名称或响应内容相同。公开报告只有统计、状态、模型名和哈希，无凭据、账号/窗口标识或笔记/摘要正文。原始stdio未被录制，反向sampling证据由固定runtime的Host回调映射与已有[双向协议记录](evidence/protocol.jsonl)共同支持。

### 网络与故障排查

如网络需要代理，在启动CLI的同一终端设置正确的 `HTTPS_PROXY` / `HTTP_PROXY`；本项目推荐的Node26可配合 `NODE_USE_ENV_PROXY=1`。为本机Host保留 `NO_PROXY=localhost,127.0.0.1,::1`。脚本继承当前环境，不写系统代理，不将代理凭据输出到日志。

| 现象 | 处理 |
| --- | --- |
| 端口已占用 | 保留已有页面，改用 `--port 5228` 等空闲端口；不要直接重启有草稿的会话 |
| 没有账号、账号host不匹配或PAT过期 | 对选定host重新运行官方设备授权命令 |
| `Verified developer required` | 到开发者控制台由本人完成开通，再重试 |
| `HANDLE_REQUIRED` / developer handle required | 在控制台选择自己的handle，或运行官方 `account set-handle` |
| 401/403 | 核对授权环境、凭据是否撤销、开发者权限及模型授权；必要时重新登录 |
| 无法连接Anna或启动超时 | 检查host地址、网络、代理及NO_PROXY；不会自动改为mock |
| 启动成功但总结失败 | 启动只证明开发应用/Host可用；继续在Anna账号中检查模型权限、额度及平台状态 |

CI只运行离线参数、凭据元数据、启动负路径和原有无模型/mock测试。所有真实账号开通、授权和收费模型请求均由用户人工执行；干净checkout和CI不需要Anna凭据。

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

提交用的 `evidence/cli-sampling.json` 对正文脱敏，保存 `fixtureMatched` 和期望总结的 SHA-256；原始精确比较在脚本内存中完成。固定 fixture 本身保留在仓库，便于复现。

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
- `npm run test:harness` 抓取真实 `/api/session/call` 的 request/response，先在内存断言实际参数，再将脱敏副本保存到 `evidence/ui-host-rpc.jsonl`；每行保留 ns/method/args/response 结构，`ui-harness-report.json` 记录断言。正文、原始诊断、凭据和会话标识不公开；截图遮蔽正文。这个自定义网络证据格式**不是** Anna recording，不交给 fixture verify。
- 若需要官方 recording，dashboard 点击 record 开始，执行 A0–A7，再点击停止下载 JSONL。要包含首次读取，可开始录制后只重载内层 iframe，不能刷新外层 dashboard。下载的官方格式可用 `npx anna-app fixture verify <file>` 和 `fixture summarize <file>` 检查。提交前去掉 auth/token 等敏感字段。
- UI 记录中只有 storage/tools 和 SDK window 调用；不会出现前端 llm 调用。后端 `protocol.jsonl` 中则必须出现 reverse `sampling/createMessage`。
- `evidence/cli-sampling.json` 是官方独立 runner 返回值的脱敏证据；协议 transcript 也默认脱敏。结合对应脚本的实际断言和报告，可以验证请求来源、内容及关联信息；复现命令和固定测试输入保留在源码。

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

发布触发方式：推送 `v0.1.1` 等版本 tag，或在 Actions 的 Release workflow 中手动输入已经存在的 tag。tag 必须对应源码版本，dispatch checkout 的实际 commit 与 release metadata 一致；不把默认分支误贴到其他版本。

预期 Release 文件：

```text
mini-notes-summarizer-0.1.1-darwin-arm64.tar.gz
mini-notes-summarizer-0.1.1-darwin-x86_64.tar.gz
mini-notes-summarizer-0.1.1-windows-x86_64.zip
SHA256SUMS
release-metadata.json
```

三个构建全部成功才发布，任一个失败不公开半套包。公开 Release 重跑优先下载既有三包、checksum和元数据核验，完整一致则跳过重建，不覆盖公开资产；不要因重新归档的时间戳导致正常重跑误判。无需 Anna PAT、登录或 App 上线，GitHub_TOKEN 的 contents:write 仅用于 Release job。

当前实际执行状态和远程仓库/commit/Release 链接以 `docs/acceptance.md`、`evidence/delivery.md` 为准；workflow 文件存在或静态审阅不等于三平台已成功发布。`npm run verify:harness` 可以自动启动全新官方会话、运行真实 UI 测试并停止自有进程。

## 状态与限制

固定序号递增，删除后允许缺口；相同内容可保存多条。数据有版本且严格校验，读取失败不能当空文档覆盖。明确写入失败保留输入或回滚；超时等结果未知时进入确认隔离，重新读取只确认，不强制解锁；重连也不能证明旧写入取消。最后已知笔记仍可见，结束 legacy 会话前明确提示数据会重置。

固定版本 Host 的 `too_large` 是提交前的容量拒绝。收到这个精确错误码时，页面显示“存储空间不足，内容未保存；释放空间后可重试”，保留草稿并恢复编辑和操作；释放空间或缩短草稿后可手动重试，成功才清空输入。Host 限制的是整个 runtime_state，其他 key 也会占用空间，所以 App 自身的正文限额不能替代 Host 检查。不会自动清除数据或重复写入；没有明确错误码、仅消息含容量字样、超时或断连仍按未知写入保护。

单条最多1,000个Unicode code point、最多100条、所有正文UTF-8字节和≤24,576、文档≤192KiB；保存前提示，合法已保存列表都可发起完整总结。summary仅在当前UI保留，笔记变化后旧结果失效，不把迟到结果套到新列表。单实例队列不声称解决多窗口协同。

## 平台兼容说明

安全回归运行 `npm test`、`npm run test:security`、`npm run test:go`。笔记和模型回复都视作不可信文本：固定工具路由，笔记 JSON 编码进 user 消息，回复只作 React 文本展示，不解析成工具操作、HTML、脚本或文件命令。普通含“删除文件”的待办仍可保存。

Go 与前端均限定摘要不超过 16384 UTF-8 字节，stopReason 不超过 64 字节；超限或无效响应明确失败，不生成替代摘要。Host 原始错误诊断不回传，只有精确的 no-llm 错误保留标准说明。权限回归检查锁定既有 Host API / capability 集合，保留本地 reverse sampling 所需 complete ACL。

公开 RPC 证据采用允许字段投影，正文、未知自由文本、会话标识及凭据脱敏。协议 report 保存内存中原始 describe 的规范化 SHA-256，archive smoke 用同样指纹核对完整工具描述、参数与能力，避免拿脱敏文案替代原始一致性校验。

上述测试证明协议与动作边界、限额和权限契约；mock 不证明真实模型免疫提示词注入。Executa 的 manifest 也不是 OS 文件系统沙箱，未来引入文件或 Agent 能力需要单独评审。

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
