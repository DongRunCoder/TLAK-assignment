# P0 平台契约核验

日期：2026-10-29。此文区分发布包源码核验、直接执行官方 Python 类的探针与真实 CLI/iframe 验证；未执行项不能据此视为通过。

## 核验来源

固定官方发布包：

- `@anna-ai/cli@0.1.61`：`https://registry.npmjs.org/@anna-ai/cli/-/cli-0.1.61.tgz`
- `@anna-ai/app-runtime@0.26.0`：`https://registry.npmjs.org/@anna-ai/app-runtime/-/app-runtime-0.26.0.tgz`
- `@anna-ai/app-schema@0.30.0`：`https://registry.npmjs.org/@anna-ai/app-schema/-/app-schema-0.30.0.tgz`
- `anna-app-runtime-local==0.2.0a30`、`anna-app-core==0.26.1`：PyPI 对应版本 wheel。

只读下载并解包到 `C:\Users\dongrun\AppData\Local\Temp\tlak-p0-contract-audit`；没有安装到全局或更改用户设置。以下 JS 定位是 CLI 发布包 `dist/` 的原始文件和行号；Python 定位是 wheel 中的原始模块和行号。实际项目 npm 解析版本与 live SDK hash 仍须由项目 doctor/真实 HTTP 请求另外记录。

## 已执行：reverse sampling 的 App ACL 兼容问题

执行环境：本机 Python 3.12.1、pydantic 2.12.5；通过 `sys.path` 指向上面的 runtime/core 解包目录，未用已安装的同名包替代。命令退出码 0。测试使用官方 `LocalDispatcherSession.create()`、`LocalServerRequestHandler.__call__()`，输入真实根 manifest 的内存副本。它不是完整 `anna-app dev`/iframe 测试。

请求：

```json
{"messages":[{"role":"user","content":{"type":"text","text":"P0 sample"}}],"maxTokens":10,"context":{"invoke_id":"p0"}}
```

原 manifest 的 `ui.host_api` 只有 storage/tools，尽管 `host_capabilities` 包含 `llm.sample`，实际结果仍为：

```json
{"type":"ServerRequestError","message":"manifest does not grant 'llm.complete'","code":-32603,"data":{"errorCode":"permission_denied","details":{}}}
```

仅在内存副本增加 `ui.host_api.llm: ["complete"]` 后，实际结果为：

```json
{"type":"ServerRequestError","message":"llm.complete not wired in this runtime","code":-32004,"data":{"errorCode":"not_implemented","details":{}}}
```

后一个错误的原因是此探针没有为 `InMemoryWindowStore` 提供 Node host callback；它证明请求已越过 ACL 到达 store，不证明完整 no-llm 路径已通过。实际 CLI 会安装 host callback，并将禁用 LLM 的错误回送，仍需真实 UI 核验。

原因定位：

- `runtime/anna_app_runtime_local/session.py:168` 将 `sampling/createMessage` 映射到 `llm.complete`；`:423-445` 在校验文本内容后调用 `session.call()`。
- `runtime/anna_app_runtime_local/session.py:122-137` 调用 core dispatcher，复用 App 的 manifest。
- `core/anna_app_core/acl.py:112-129` 按 `ui.host_api.llm` 检查方法；`host_capabilities.llm.sample` 不替代该 ACL。
- `core/anna_app_core/dispatcher.py:2208-2215` 在方法执行前拒绝未授权请求。
- `runtime/anna_app_runtime_local/store.py:372-381` 将已授权的请求转发为 `host.llm.complete`。

P0 兼容修正建议：App 增加 `ui.host_api.llm: ["complete"]`，README 解释这是固定版本本地 reverse sampling 映射所需的授权。前端仍只调用 `anna.tools.invoke`，应以源码检查/测试保证没有前端 `anna.llm.complete` 调用。不能修改或 mock 官方 bridge 来跳过真实 ACL。

### 后续实跑：官方 Node/Python bridge 与 no-llm Host

在项目 `node_modules` 可用后，另以 Node ESM stdin 脚本直接导入官方 `PythonBridge` 与 `HarnessServer`，沿用 `scripts/lib.mjs` 的隔离 UV 环境。`HarnessServer` 配置 `llm:{mode:"off",storageMode:"legacy"}`，只安装其真实 host handler；没有调用 listen，没有占用浏览器或 HTTP 端口。脚本执行 `bridge.start()`、`bridge.call("ping")`、`session.create`、`session.call`，最终 `bridge.stop()`。命令退出码 0，ping 返回 `{pong:true}`。

同一脚本在内存 manifest 删除/增加 `ui.host_api.llm`，实际 bridge 输出：

```json
[
  {"phase":"before","result":{"ok":false,"error":{"code":"permission_denied","message":"manifest does not grant 'llm.complete'","details":{}}}},
  {"phase":"after","result":{"ok":false,"error":{"code":"llm_disabled","message":"harness started with --no-llm","details":{"errorCode":"llm_disabled"}}}},
  {"phase":"missing_storage","result":{"ok":true,"result":{"value":null}}},
  {"phase":"storage_set","result":{"ok":true,"result":{"ok":true}}},
  {"phase":"storage_get","result":{"ok":true,"result":{"value":{"probe":"official bridge","order":[1,2]}}}}
]
```

这一层用实际 uvx 子进程确认 Python bridge、schema2解析、legacy storage、Node no-llm 错误可工作；其 llm 测试是协议审计脚本直接发送，不是 App 前端调用。完整 iframe/tools/Executa/reverse 链路仍以主流程实际 UI 测试为准。

## SDK 契约：已核对源码

- CLI 依赖 `@anna-ai/app-runtime:^0.26.0`、`@anna-ai/app-schema:^0.30.0`。npm lockfile 固定实际解析版本；Python core 另用约束固定。
- 实际只读 `npm ls @anna-ai/cli @anna-ai/app-runtime @anna-ai/app-schema --depth=4` 已确认 CLI0.1.61、SDK0.26.0、schema0.30.0；本地 node_modules SDK SHA-256 与上述官方包 hash 一致。HTTP live SDK hash 尚待记录。
- SDK HTTP 路径 `/static/anna-apps/_sdk/latest/index.js`。CLI `server-CgXHd_Wd.js:2199-2227` 从自己解析到的 `@anna-ai/app-runtime` dist 提供文件；设置 nexus source root 时优先 in-tree SDK。
- SDK 0.26.0 `dist/index.js` SHA-256：`5AEBA3C631E8426C32C27E13415A848ACF682236D8858572D36D5E2038D31351`。这只是官方 npm 包内文件 hash，尚未核对实际 harness HTTP 返回字节。
- SDK `index.js:2372-2403`：`connect()` 从 iframe URL 取 `wid`、`t`，调用 `window.hello`、`window.ready`。缺少参数会报 `[anna-sdk] missing wid/t URL parameters`。
- `index.js:683-701` 的 tools proxy 和 `:438-447` 的 storage proxy 都把第二参数 `opts` 传给 `rt.call()`。
- `index.js:2295-2317` 的客户端 timer 读取第二参数 `{timeoutMs}`；第一参数 `args.timeoutMs` 只作为业务 Host 请求字段传送。两者不是同一个超时。
- `index.js:418-436`：tools 默认客户端等待 70,000ms，storage 默认 30,000ms。
- `index.js:2225-2236`：Host 错误 reject，并附 `error.code`/`error.details`；成功只返回 `msg.result`。

## storage 与 tools 结果：已核对源码

- core `dispatcher.py:788-793`：legacy storage.get 缺失 key 返回 `{ "value": null }`。
- core `dispatcher.py:796-816`：storage.set 保存 runtime_state、发 `runtime_state_synced`，返回 `{ "ok": true }`。
- core `dispatcher.py:359-390`：Host 的 tools.invoke 读取 `tool_id`、`method`、`args`、整数 `timeoutMs`，检查 tool allowlist 并 clamp Host 超时。
- core `dispatcher.py:461-515`：双层 `success/data` 被 dispatcher 解开，最终 UI 得到业务对象（如 `{summary: "..."}`）。任一层失败变成 Host 错误；不能把文档中的 wrapper 继续套到前端 adapter。
- runtime `executa.py:246-252` 外层结果是 `{success,data,command_id}`；Executa 自己的 JSON-RPC result 仍须返回 `{success:true,data:{summary}}`。

## App 与独立 runner 握手差异：已核对源码

- runtime-local App 路径 `executa.py:342-377` 直接 spawn 并启动 reader，没有发送 initialize/describe。
- `executa.py:260-301` 在第一次 invoke 时直接发送 `{tool,arguments,context:{invoke_id}}`，所以 Tool 必须支持 App 的无握手兼容路径；显式 v1/能力拒绝与“还没有 handshake”需要区分。
- `executa.py:618-639` 优先按 reverse `params.context.invoke_id` 路由到当前 invoke。`metadata.invoke_id` 是额外审计关联，不能代替 context。
- CLI 独立 runner `runner-aq0n-pdr.js:12-25,78-97` 先发送 `initialize`，参数包含 `protocolVersion:"2.0"`、`capabilities.sampling:{}`、`clientInfo`，主要按响应 protocolVersion 判定 v2。
- 独立 runner `runner-aq0n-pdr.js:121-126` 只传 `{tool,arguments}`；不生成 invoke context，手动 host 测试需另外覆盖 context 关联。
- Host 超时的发布包边界：core `dispatcher.py:414-420` 只把整数毫秒传给 `store.invoke_executa_tool(timeout_ms=...)`。runtime `executa.py:264-287,298-302` 将毫秒转为 `(timeout_ms/1000)+2` 的等待秒数，但发给插件的 params 不含 `timeout`/`deadline_ms`。这些本地发布包不能证明生产 `params.timeout` 的单位，不应据此猜测。

## Harness UI 和真实证据入口：已核对源码，待实跑

- 默认 dashboard：`http://localhost:5180/`（或 `/dashboard`）。
- dashboard GET `/api/config` 取得 bundle 路径，POST `/api/session/create` 取得 session/window/token，再创建 `#app` iframe。
- iframe：`/anna-apps/<slug>/dev/<entry>?wid=<window_uuid>&t=<token>&theme=...&themeMode=...&lang=...`。`dashboard.html:351-363`。
- 浏览器测试应打开 dashboard 并使用 `page.frameLocator('#app')`；直接打开静态 bundle 无父页 relay，不能完成正式 Anna SDK handshake。
- 真正 Host 转发入口：POST `/api/session/call`，body `{session_id,ns,method,args}`，response `{ok:true,result}` 或 `{ok:false,error}`。`server-CgXHd_Wd.js:2085-2104,2120-2179`；`dashboard.html:709-789`。
- dashboard `#rec-btn` 的录制代码 `dashboard.html:267-300`，第一次点击开始记录，第二次点击下载 `harness-<timestamp>.jsonl`。JSONL 有 `meta`、`req`、`res` 和事件，req/res 用同一 `id` 关联。
- 可在 Playwright 捕获 `download`，调用 `saveAs('evidence/ui-host-rpc.jsonl')`，或在 dashboard evaluate 读取实际录制的 `recState.lines` 后保存。必须先点击开始，再执行 A0–A7；若要包含首次 get，应在录制开始后只重载内层 iframe（同 session），不要刷新外层 dashboard。
- 同时可用 Playwright `page.on('request')`/`page.on('response')` 仅捕获 `/api/session/call` 的真实网络数据。HTTP 请求没有 SDK id；需分配观测 ID或用 request 对象关联。录制格式本身已经有 SDK id，更适合交付。
- CLI `fixture verify <file>` 验证 recording JSONL；`fixture summarize <file>` 可读摘要。`fixture-CizypXzX.js:6-11,64-115` 要求首行 meta、单调 t、req id 唯一、res 的 ok 为 boolean。
- 注意 recording 可能含临时 `auth.refresh` token，提交证据前需按实际内容脱敏，并保留它是脱敏记录的说明。

## Python bridge 环境：已核对源码

- CLI `bridge-Q0gRZYTR.js:12,63-68` 默认执行 `uvx --from anna-app-runtime-local@0.2.0a30 anna-app-bridge`。
- runtime METADATA：Python >=3.10，`anna-app-core>=0.26.0,<0.27`，`ddgs>=9.13,<10`；core 依赖 `pydantic>=2,<3`。
- CLI `bridge-Q0gRZYTR.js:76-92` 继承整个 process.env；任务专用 UV_CACHE_DIR/UV_TOOL_DIR 和 UV_CONSTRAINT 可控制本地依赖，不必全局安装。
- `bridge-Q0gRZYTR.js:121-130` 等待 `_ready` 只有 8 秒；首次下载应先预热相同 uv 环境，再启动 harness，避免把安装耗时误当协议不兼容。
- `dev-biRih6ng.js:128-143`：`--no-llm` 使用 mode off，`--storage legacy` 保留 Python runtime_state；不需要登录。
- `server-CgXHd_Wd.js:538-543`：真实 Node LlmBridge off 返回 `{ok:false,error:{code:"llm_disabled",message:"harness started with --no-llm"}}`。该字段经 Python reverse error 再经工具包装，UI 最终 code/message 仍须实测。
- 当前受限沙箱执行 asyncio 事件循环的探针无法正常完成；用 require_escalated 的只读探针实际完成。默认沙箱挂起的两个探针已 Ctrl+C 结束。真实 bridge/UI 进程也需使用能访问本机端口的执行环境。

## 独立 sampling fixture：已核对源码

`sampling-BQwF3O-4.js:11-18,61-74` 读取 JSONL（忽略空行和首字符为 # 的行），匹配 `ns:"sampling",method:"createMessage"`（也兼容 llm.complete）。推荐单条 fixture：

```json
{"ns":"sampling","method":"createMessage","result":{"role":"assistant","content":{"type":"text","text":"MINI_NOTES_SAMPLING_FIXTURE_SENTINEL"},"model":"mock-model","stopReason":"endTurn"}}
```

此 CLI 版本的 `match.contentIncludes` 不是严格 gate：没有匹配内容时实现会回退到同 method 的 fixture。因此需要在手动 transcript 中独立断言 reverse 请求包含当前 notes 和 invoke 关联，不能只凭 sentinel 证明 prompt 正确。fixture 不存在/格式错误也可能退到 `(mock) no fixture matched` 而不是失败，测试必须精确断言 sentinel。

## P0 必须取得的实际断言

- [ ] npm 安装解析 CLI0.1.61 / SDK / schema 精确版本与 integrity；Python 解析 runtime/core；HTTP SDK hash 与本地文件一致。
- [ ] `npm run build` 与 `anna-app validate --strict --bundle ./bundle` 真实退出 0。源码证明 schema2/permissions 类型合法不能替代这一命令。
- [ ] 真实 dashboard 里的 iframe connect 完成；显式首次 storage.get 返回 `{value:null}`。
- [ ] 真实 storage.set/get round-trip，创建/删除对应持久化内容与 sequence；空白输入不 set；内层 reload/显式 reread 在同 session 读回已有 notes。
- [ ] 真实 Summarize 发送 tools.invoke 的正确 identity/method/notes/timeoutMs；请求到达本地 Tool，其 reverse sampling 得到等价 no-llm 错误，UI展示真实错误。
- [ ] 独立官方 `anna-app executa dev --mock-sampling` 发起 initialize/describe/invoke 并输出精确 fixture sentinel；手动 transcript 证明 reverse sampling 请求/响应 id、notes、context/metadata关联。
- [ ] 两种 UI/后端证据路径分开记录；不把 UI no-llm 失败写成完整 summary 成功。
