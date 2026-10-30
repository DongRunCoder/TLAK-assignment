# 验收记录

基线为 question.md；最终方案给出设计，本文只登记实际执行的检查。使用测试样本，不含真实账号、模型 key、window token。

## 2026-10-30：可选真实 LLM 启动与脱敏实测证据

新增显式 `npm run dev:real`，默认5218、Anna正式站、开发应用slug `mini-notes-tlak-real`。沿用官方CLI和预览生命周期，每次在独立 `.tools/real-preview-*/bundle` 构建一次，以 `--storage legacy --no-watch` 启动。默认dev、原始harness、CI仍为无账号/无模型验收；App、manifest和Executa未改，总结仍通过tools.invoke → Executa → sampling。

真实入口先保护端口，再用官方 `whoami --json` 做本地账号元数据预检。只投影host和过期时间，原始stdout/stderr不回显、不写文件；启动错误仅显示固定分类。help、缺失/损坏/过期凭据和端口占用路径均在构建、开发应用注册之前退出。CLI设备授权、开发者开通和handle选择由用户本人完成，README列出正式命令、代理与排错步骤。

本轮实际退出0的检查：

- 前端124项、安全41项、预览35项（保留原25项，新增真实入口10项）、打包8项；contracts、TypeScript、独立Vite构建及Anna strict validation。
- 新增测试先观察RED，再通过GREEN；覆盖纯参数与Host参数组装、账号元数据、脱敏分类、help、非法参数、隔离凭据负路径、端口保护和Host提前退出。真实入口测试始终使用空/损坏/过期的临时XDG，不继承开发者账号，不调用服务或模型。
- 六组独立真实无模型Host回归：watch不重载、多标签页失效检测、手动恢复草稿、恢复后真实Executa路由、Host停机/重启、已提交但丢回执的未知写入隔离。独立bundle和浏览器上下文不操作已有体验会话。
- Go测试、真实二进制11组双向协议检查、官方独立mock sampling精确fixture比较通过。
- 正式命令 `npm run dev:real -- --port 5228` 启动成功，GET页面为官方dashboard且含预览适配、HTTP200；没有打开App会话或点击Summarize。Ctrl+C后5228不可达且该启动器/Host进程数为0；原5198、5208、5218仍HTTP200。此烟测证明新入口启动，不声称再次验证付费总结。
- 另以 `UV_OFFLINE=1` 和空XDG验证固定官方PythonBridge：模拟Node父进程失败退出后，观察到的uvx/Python两个后代均随EOF结束。永久nested fixture同时验证分类与孙进程退出；未添加竞速杀进程或修改官方实现。

[真实模型脱敏报告](../evidence/real-llm-report.json) 来自2026-10-30 14:27:09（北京时间）、源码 `33d824d1e5196ae9dcd21e2a7377fd918eeac092` 的先前人工实测，早于新命令加入：三条测试笔记、一次tools.invoke、Anna mint/complete均200，返回模型 `google/gemini-3-flash-preview`，耗时4975ms，Host/工具/UI摘要124字节且SHA-256一致。原始stdio未录制，反向sampling由固定runtime的Host回调映射及已有协议记录共同支持。公开报告仅保留统计、状态、模型和摘要哈希，排除正文、凭据与账号/窗口标识；本轮没有自动重跑收费请求。

独立规格评审与后续代码质量评审均完成，未发现阻止交付的问题；审阅覆盖所有新增生产代码、测试、文档和公开证据，并对照固定CLI本地实现核对，不读取用户凭据、不请求模型。

question.md SHA-256保持 `E0CBC6893AD144FA9252650B9285ECC687812E9D80B588E6D52F8CEFC1BD15B3`；本轮不改Executa版本或重发历史Release。

## 2026-10-30：会话失效、草稿恢复与多标签页回归

固定CLI的dashboard每次新建session会关闭上一个session，旧iframe继续使用原ID时收到`transport / [-32602] unknown session_id`。App现在通过真实storage/tools响应观察Host状态，区分检查中、已连接、暂不可用与会话失效；可见页面15秒只读同步及focus/visibility检查复用repository通道。expired锁存，不被迟到成功重置；固定SDK的完整timeout格式也单独识别，一般参数或模型文本不误判。

用户手动点击“保留草稿并恢复会话”后，独立预览外壳通过官方session/create重建，再将内存草稿交给新的Anna iframe；React确认输入框提交后才ACK并清缓存。业务UI无fetch、浏览器持久化或自动写入重放。origin/source/documentId/requestId/结构/长度均验证，错误固定脱敏。原始官方入口保留完整调试控件，提供复制与手动重新打开说明。

写入未派发的本地sentinel可解除本次mutation；真正派发后的session丢失、transport与timeout仍保持未知写入隔离。存在mutation、待取回草稿或恢复中，不可用新会话绕过保护。已发送保存若在失效后迟到成功，也保留编辑器草稿。交还遇到新输入或未知mutation，保留当前输入和待取回草稿，明确显示人工“取回恢复草稿”，不覆盖、不提前ACK。

独立评审发现并通过先红后绿的回归关闭：迟到session响应可能重载新编辑器、未ACK草稿无法交还、实际SDK timeout格式未匹配，以及初始官方watch自动重载。预览现在在官方脚本前安装窄WebSocket适配，仅拦截同源`/ws`的reload并提示手动处理，其余事件与其他socket不改。官方文件、SDK、manifest、Executa源码与question.md不改。

本轮实际通过：

- 前端124项（原82项保留，新增42项）、安全41项、预览25项（原16项与9项恢复/事件回归）、TypeScript与独立Vite构建、Anna strict validate、contracts、diff空白检查。
- 独立真实Host `npm run test:session -- --bundle .tmp/session-recovery/bundle` 六组：真实watch更新不重载；两个标签页抢占只检测不自动create；手动重建交还原稿且只在点击保存后写入；恢复后真实Executa reverse sampling路由收到预期no-llm；Host停机、恢复失败及重启均保留原稿；真实提交后丢ACK/阻断读，再关闭旧会话，仍reconciling且恢复禁用。过程只丢传输回执，不伪造Host数据或总结。脱敏结果见 [session-recovery-report.json](../evidence/session-recovery-report.json)。
- 最终独立bundle的原始官方入口真实Harness20次Host调用，预览入口18次；CRUD、序号、显式重读、引导关闭焦点/滚动、SDK hash、真实tools.invoke与无模型提示通过。官方独立mock sampling精确fixture通过。
- Playwright/Edge真实1280×900、360×640验证：失效状态准确、恢复操作可见、草稿完整、无横向溢出；人工恢复后返回绿色已连接且输入仍为原稿。Browser插件不可用，IAB用于最后打开体验。

为保护旧5198页面草稿，本轮使用独立bundle与新5208入口，不刷新旧页；最终体验服务使用`--no-llm --storage legacy`。新会话中的旧笔记仍不保证保留。CI配置已加入`npm run test:session`并上传脱敏报告。

代码提交 `bf4424f7bc430685f06859a601484a442216a387` 已推送公开仓库main，[CI 41010316962](https://github.com/DongRunCoder/TLAK-assignment/actions/runs/41010316962) 实际 completed/success。Windows job及全部步骤均为success：依赖干净安装、doctor、contracts、前端124项、安全41项、预览25项、构建、strict validate、Go、真实Harness、新增六组真实会话回归、协议、独立官方mock sampling、打包测试、Windows native打包、解包smoke与证据上传。已核对运行head_sha精确对应本轮源码，未使用历史成功替代本轮验证；本段后续提交仅补充README与验收记录，未改实现或发布旧Release。

question.md SHA-256：`E0CBC6893AD144FA9252650B9285ECC687812E9D80B588E6D52F8CEFC1BD15B3`。

## 2026-10-30：容量拒绝恢复与体验入口控件

测试先复现红态：`too_large` 保存后仍为 reconciling、删除后笔记未恢复、App 草稿只读；预览中 Mobile 仍可见。修复只将精确字符串 `too_large` 归类为 Host 明确拒绝，清除 mutation、恢复 ready，并使用固定中文提示。保存失败保留原稿，删除失败恢复列表；无自动重试或数据清理。缺失、未知、相似 code 及 timeout/transport 继续隔离，只有读到精确的待提交版本才确认未知写入。

预览 CSS 隐藏 Mobile、主题、语言及其空容器；Desktop、record 与日志保留。官方 dashboard 文件、Host、SDK、manifest 和 Anna 调用链均未在本轮改动。`npm run dev:harness` 保留官方全部调试控件。渲染回归使用锁定 CLI 的真实 HTML，分别验证原始入口可见和预览入口隐藏，业务链路另由真实 Host 测试验证。

本轮实际退出0：

- `npm test`：82项，新增6项覆盖容量拒绝解锁、草稿保留/重试清空、删除恢复，以及缺失/未知/相似 code 的隔离与迟到提交。
- `npm run test:preview`：16项，包含2项实际 Edge 渲染可见性回归；HTTP/WS透传、端口与自有进程清理仍通过。
- `npm run test:security`：41项；`npm run build`、`npm run validate`、`npm run check:contracts`、`git diff --check` 均通过。
- `node scripts/test-harness.mjs --url http://127.0.0.1:5299/`：官方原始入口，17次真实 Host 调用；再顺序运行5298预览入口，同样流程18次调用。首次引导、关闭焦点/滚动、帮助返回、CRUD、显式重读、SDK hash、真实 tools.invoke、预期 no-llm 提示通过。
- `npm run test:sampling`：独立官方 `--mock-sampling` runner 精确 fixture 通过，UI中没有伪造总结。
- 独立实际 Host 容量验证：测试会话额外 key 写入261600字节占位，1000字草稿保存返回真实 `too_large`；Host中的笔记未提交，草稿保持1000字、可编辑、保存可用。通过 Host 释放占位后，同一页面原稿重试保存为序号1，输入才清空；重新读取、删除也通过。
- 容量恢复与控件可见性的脱敏实际结果保存在 [quota-recovery-report.json](../evidence/quota-recovery-report.json)；永久回归分别在 `tests/frontend/repository.test.ts`、`app.test.tsx` 与 `tests/preview/controls.test.mjs`。报告不包含笔记正文、padding值或会话envelope。
- 同一个真实页面1280×900、640×800、360×640、360×360，内外层无横向溢出，目标控件隐藏，应用无控制台/运行时错误。Browser插件不可用，使用独立 Playwright / Edge。
- 预览中的官方 record 按钮实际进入 stop 状态，执行重新读取后停止录制，下载JSONL并在内存解析3行成功；没有将会话载荷保存为公开证据。两次独立只读复核未发现阻塞问题。

本轮代码提交 `2c5257aaa707ec1d1c56a1eae9889fe6dd44c333` 已推送公开仓库 main，[CI 41002904092](https://github.com/DongRunCoder/TLAK-assignment/actions/runs/41002904092) 实际 completed/success，Windows job及其全部步骤均为success：干净安装、doctor、contracts、82项前端、41项安全、16项预览、构建、strict validate、Go、真实Harness、11组协议、官方mock sampling、8项打包测试、native打包、解包后协议smoke及证据上传。已按精确head_sha关联查询，不使用历史成功结果代替本轮验证。本段后续提交仅补充README与验收记录。

Executa与发布脚本未更改，本轮未重发三平台Release；历史三平台发布证明仍对应原tag源码。question.md SHA-256仍为 `E0CBC6893AD144FA9252650B9285ECC687812E9D80B588E6D52F8CEFC1BD15B3`。

## 2026-10-30：首次关闭修复与自适应预览

真实红态：原始640×614视口，首次关闭引导使scrollY从0跳到358，焦点落到页尾帮助，输入框top=-125。补充失败测试后通过稳定ref与preventScroll修复；真实复验scrollY保持0、焦点回输入框，手动帮助关闭则保留358和原按钮焦点。原单元测试只验证overflow恢复，未覆盖真实浏览器滚动，因此本轮增加立即检查，避免后续locator自动滚动掩盖缺陷。

首层引导现为“开始记笔记”和“验收与模型说明”，准确说明默认无模型行为；技术解释仅展开查看。固定官方入口回退864×760，宽屏800起分栏，短窗压缩字号与间距，全文与容量提示保留。

用户进一步要求随浏览器自适应。新增独立本地布局代理，根dashboard仅注入CSS，SDK、业务HTTP及WebSocket透传给实际Anna。`npm run dev` / `dev:preview` 构建并启动自适应5198入口，`dev:harness`仍为原始官方入口，不修改第三方包或Host权限。

已实际通过：前端76项、安全41项、预览14项（含HTTP原字节/查询、WS双向与拒绝响应、占用端口、自有进程树清理、启动取消释放端口）、构建、contract与strict validate、11组协议及官方mock sampling精确fixture。最终原始Harness真实流程18次Host调用，自适应入口同一流程18次Host调用，均验证storage CRUD、独立guide key、真实tools.invoke与no-llm预期提示。两个写入同名证据的流程最终顺序执行。

真实最终回归另捕获已有总结竞态：重新读取与后台同步交接时，界面仍可点击但repository已进入loading，旧ready guard会无声丢弃请求（实际tools请求数0、summary仍idle）。新增9个回归用例并先红后绿：保留无mutation且非空的ready/loading已读快照，仍串行执行自己的一次Host refresh；调用和返回都验证token与当前fingerprint。同版本后台读取不再误失效；写入中、未确认、读取失败、空笔记及真实revision/content变化继续保护。独立相关45项复核通过，最终两条真实Harness链路均通过。

同一个真实Anna页面连续缩放（未改DOM尺寸）：浏览器1700×1000→App1278×874；1280×900→918×774；1000×800→958×514；640×800→640×610；360×640→360×450；360×360→360×378（外层允许纵滚以保留最小App高度）。各尺寸无水平溢出，测试笔记保持，全程仅1次session/create、1条WebSocket、0应用控制台/运行时错误。窄屏展开引导可滚动，Tab环和Esc/焦点位置验证通过。独立评审未发现实质阻塞。

新增预览的Windows清理测试需允许终止其自身创建的测试进程树；受限sandbox曾拒绝taskkill，同权限复验14项均通过。此处是本轮本地证据，不将下文历史CI/Release链接视作本轮远端验证；Executa源码与历史Release不变，question.md SHA256仍为原值。

最终以 `npm run dev` 启动5198并在应用内浏览器打开，已确认“已同步·0条笔记”、首次关闭后scrollY=0且note-content聚焦。当前面板实际726×534，无水平溢出；页面已保留供用户体验，后续不再创建测试Host会话重置它。

## v0.1.1：2026-10-30 本地新增功能验收

用户确认采用默认无模型验收，新增可跳过的首次说明、页尾帮助入口、精确 no-llm 提示，以及摘要/错误/权限/证据安全加固。Anna Host 存储与 tools.invoke → Executa → sampling 链路保持。

实际退出 0 的检查：

- 前端 63 项；包含首次说明 26 项，覆盖未知版本保护、独立 key、慢/失败/迟到响应、runtime切换、卸载、关闭与焦点。
- `npm run test:security`：41 项，覆盖权限变异、证据默认脱敏及原始 describe 指纹一致性。
- `npm run test:go`：完整 Go 测试；新增摘要 16384 / stopReason 64 UTF-8 字节边界、敏感 Host 错误不回传、恶意输入协议隔离和输出纯文本。
- `npm run build`、`npm run check:contracts`、`npm run validate`。
- `npm run test:protocol`：11 组；`npm run test:sampling`：官方 runner 精确 fixture 比较通过。
- `npm run verify:harness`：真实全新 Anna iframe 会话，18 次 Host 调用；guide/notes key 分离、帮助重开、CRUD、显式重读、真正 tools.invoke 和预期 no-llm 提示。
- `npm run test:packaging`：8 项；本机 `package:native` 生成 0.1.1 Windows ZIP，`smoke:archive` 从解包后二进制执行 11 组协议检查通过。
- 独立真实 harness 视觉检查 960×900、640×640、360×640 和360×360，包含弹窗展开滚动、Esc、焦点恢复及 Host 详情；无横向溢出或应用控制台错误。

独立评审发现并复现了“脱敏 transcript 与原始 archive manifest 比较”的验包回归。现改为在原始 describe 上生成规范化 SHA-256，再与原始 archive manifest 指纹比较；不恢复公开原文。新增等价/变异测试及实际 smoke 均通过，独立复核关闭该问题。

公开 RPC 正文、凭据、会话标识与诊断默认脱敏，内存断言仍验证原始真实参数。mock 验证的是协议与动作边界，不是实际模型的抗注入成功率。原始 question.md SHA-256 仍为 `E0CBC6893AD144FA9252650B9285ECC687812E9D80B588E6D52F8CEFC1BD15B3`。

本地新版体验服务使用 `http://localhost:5198/`，原5180会话未重启。三平台远端发布结果在对应版本 Actions / Release 中记录。

冷启动复验：首次远端完整 CI 在 harness 步骤因等待预算不足失败。原断言使用 Playwright 默认5秒，首次 `go run .` 编译仍在进行；此前RPC证据仅记录已返回的响应，不能据无已完成tools行认定调用未发出。已将提示等待改为70秒，对齐65秒SDK预算，并在CI先运行Go测试预热。新增无正文诊断记录请求开始/完成数和耗时；独立空Go缓存真实复验通过18次Host调用，工具请求实际耗时14862ms，明确超过原5秒窗口。App与repository无需为此修改。

v0.1.1 [三平台原生构建、逐平台解包执行与发布已通过](https://github.com/DongRunCoder/TLAK-assignment/actions/runs/40916741097)，[Release](https://github.com/DongRunCoder/TLAK-assignment/releases/tag/v0.1.1) 保留三平台安装包及校验信息。发布工具源码来自 tag `v0.1.1`，后续CI等待修正仅涉及测试脚本和workflow，不更改工具二进制。

最终完整 [CI 已成功](https://github.com/DongRunCoder/TLAK-assignment/actions/runs/40919015848)，验证 commit `1c58303124d70e3676a37dfc4208102406137981`。三平台发布源码为 `68ab439c4df804023064211af1c015c159381121`；API确认 Release 为公开、非draft，包含 darwin-arm64、darwin-x86_64、windows-x86_64 三包及 `SHA256SUMS`、`release-metadata.json`。本段后续提交仅记录验证结果，未修改已通过的代码。

## P0：2026-10-29 已通过

实际环境见 `evidence/environment.json`：Node 26.13.0、Go 1.27.3 windows/amd64、uv 0.11.7、CLI 0.1.61、SDK 0.26.0、schema 0.30.0、runtime-local 0.2.0a30、core 0.26.1。npm lockfile 固定 JS 依赖，python-constraints.txt 固定 core。

实际执行且退出 0：

- `npm test -- --run tests/frontend/runtime.test.ts`：连接复用、失败后显式重试，2 项。
- `npm run build`：TypeScript 与 Vite 静态 bundle。
- `npm run validate`：Anna strict validation。
- `node scripts/doctor.mjs`、`node scripts/check-contracts.mjs`：真实版本与 manifest 一致性。
- `node scripts/anna.mjs dev --no-llm --storage legacy --bundle ./bundle` 启动，`node scripts/test-harness.mjs --p0`：真实 Anna dashboard/iframe，6 次 Host 调用。证据为 `evidence/p0-host-rpc.jsonl`、`p0-harness-report.json`、`p0-harness.png`。
- `node scripts/test-sampling.mjs`：官方 `anna-app executa dev --mock-sampling`，精确 sentinel。证据为 `evidence/cli-sampling.json` 与 stderr 文件。
- `node scripts/build-tool.mjs --test`：真实 Go binary、双向 RPC，11 组。证据为 `evidence/protocol.jsonl` 和绑定二进制路径/hash 的 `protocol-report.json`。

上述命令使用项目内校验过的 Node 26 LTS；系统 Node 25 不在当前 Vitest/jsdom 支持范围内。

## P0 对方案的必要兼容修正

1. runtime-local 0.2.0a30 的反向 sampling 经过 App `llm.complete` ACL。因此 manifest 额外声明 `ui.host_api.llm:["complete"]`；前端仍只调用 tools.invoke，不直接调用 llm。原权限组合的拒绝与实际 bridge 证据见 `docs/p0-contract-notes.md`。
2. 官方独立 CLI runner 不注入 invoke context。Tool 在 host 缺少 ID 时为当前调用生成 `local-UUID`，在 reverse `context.invoke_id` 与 `metadata.executa_invoke_id` 携带同一值。host 提供的 ID 则原样保留；不用 JSON-RPC request ID 冒充调用 ID。
3. dashboard 自身 `/favicon.ico` 404 已定位，作为 vendor host warning 单独记录；App bundle 与交互无控制台错误。没有修改官方 harness。
4. Host `params.timeout` 单位未证实，本地版本不发送，不猜测；工具支持明确的 `deadline_ms` 及自身超时预算。

## P1–P5 本地验收：2026-10-29

以下是实际执行记录，全部退出 0；不是只根据测试文件存在作出判断：

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| npm ci | 从 lockfile 重新安装 130 个包 | 同一目录 Node26 下执行 |
| npm run check:contracts | identity、版本、schema2、bundle入口、parameters、未使用禁止的数据/总结入口 | evidence/contracts.json |
| npm test | 4 个测试文件，32 项通过 | tests/frontend；包含失败→修复的回归检查 |
| npm run build | tsc 与 Vite 成功，生产 bundle | bundle/index.html 与外部资源 |
| npm run validate | Anna strict 通过 | 固定 app-schema0.30.0 validator |
| npm run verify:harness | 全新官方 Anna 会话 A0–A7 通过，实际 HTTP SDK hash 与锁定文件一致 | evidence/ui-host-rpc.jsonl、ui-harness-report.json |
| 窄窗 UI | iframe 宽360px，无横向溢出，App无控制台错误 | evidence/ui-harness.png、ui-harness-narrow.png |
| npm run test:go | Go 单元测试通过 | Go 模块的 server_test.go、notes_test.go |
| npm run test:protocol | 11组真实双向协议检查 | evidence/protocol.jsonl、protocol-report.json |
| npm run test:sampling | 官方独立runner成功，summary精确等于fixture | evidence/cli-sampling.json |
| npm run test:packaging | 8项平台/归档/发布校验测试通过 | tests/packaging |
| npm run package:native | 实际windows-x86_64.zip生成 | dist/；archive root manifest 与 bin/*.exe |
| npm run smoke:archive | 全新目录解压exe，11组协议通过 | evidence/archive-smoke-windows-x86_64.json、archive-windows-x86_64-rpc.jsonl |
| 两种macOS交编 | 实际生成tar.gz；核对Mach-O架构、root manifest、entrypoint和0755 | evidence/three-platform-archive-inspection.json |
| 两份workflow | YAML语法解析通过；独立规格与品质审阅 | docs/reviews/implementation-review.md |

真实 UI 最后显示序号2“修复登录 bug”和序号3“整理 Workshop 想法”，Summarize传同样两条notes，返回预期no-llm错误。Host事件调度可能合并后台读，因此真实RPC数量可以变化，验收断言依据方法、内容和结果，而非硬编码调用次数。

`--p0` 专用于历史阶段探针，生产UI已替换探针；现在应运行 `npm run verify:harness` 或已启动harness下的 `npm run test:harness`。正式源码没有测试模式的假Host或成功摘要注入。

## 独立审阅与缺陷关闭

- Executa：修复连续调用busy时序、无method无result/error的非法帧、过期deadline、原始ID和Unicode边界；独立审阅与官方runner均复验。
- 前端：独立审阅发现 reconciling 同步事件被普通排队标记吞掉。已新增可重复失败回归并修复；原复现无需手动重读即可回到ready，写入仅一次。32项完整测试fresh通过。
- 包：Windows上创建Mac tar曾得到0644，测试实际失败后修为0755。两个Mac包仅执行交编与结构检查，不声称在Windows运行了Mac程序。

## 远程交付与三平台实证

已创建并推送公开仓库 https://github.com/DongRunCoder/TLAK-assignment ，最初实现提交为27fc799856ca7af066f6fc656483ff5fd8d3abc9。GitHub使用官方设备授权；未将账户密码写入工程、脚本或凭据文件。

另外从此提交的源码zip解压到全新目录，执行 npm ci、32项前端测试、build、strict validate、Go测试、官方mock sampling、8项packaging测试，全部退出0。

本地实现完成（L1）、仓库已提交（L2）、真实三平台发布验证（V1）全部完成：

- CI实际success：https://github.com/DongRunCoder/TLAK-assignment/actions/runs/40893795605 。包含真实harness验收、前端、Go、协议、官方sampling和native archive。
- 三平台原生发布实际success：https://github.com/DongRunCoder/TLAK-assignment/actions/runs/40893795409 。prepare、windows-x86_64、darwin-arm64、darwin-x86_64、统一release job均成功。
- Release：https://github.com/DongRunCoder/TLAK-assignment/releases/tag/v0.1.0 ，已公开非draft，三包、SHA256SUMS与release-metadata.json全部uploaded。
- release tag/sourceCommit为2bb9498d6dd83cbf6bd86861a85d41827406beb7。匿名下载metadata确认源码commit和3个资产；各资产API digest及大小见evidence/github-release-verification.json。
- workflow_dispatch实际success：https://github.com/DongRunCoder/TLAK-assignment/actions/runs/40894532469 。prepare下载核验既有三包与校验信息后成功，build/release均skipped，没有覆盖公开产物；见evidence/github-release-rerun.json。

本机报告仍明确区分Mac交编与运行；额外的macOS原生运行证明来自上述远程原生runner，不改写本机历史事实。真实模型效果、云APS、Anna线上发布与签名均不在本题范围，没有声称验证这些项目。

本轮原始要求文件 SHA-256：E0CBC6893AD144FA9252650B9285ECC687812E9D80B588E6D52F8CEFC1BD15B3。
