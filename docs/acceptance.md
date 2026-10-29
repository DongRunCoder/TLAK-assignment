# 验收记录

基线为 question.md；最终方案给出设计，本文只登记实际执行的检查。使用测试样本，不含真实账号、模型 key、window token。

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

## 未执行与交付边界

已创建并推送公开仓库 https://github.com/DongRunCoder/TLAK-assignment ，最初实现提交为27fc799856ca7af066f6fc656483ff5fd8d3abc9。GitHub使用官方设备授权；未将账户密码写入工程、脚本或凭据文件。

另外从此提交的源码zip解压到全新目录，执行 npm ci、32项前端测试、build、strict validate、Go测试、官方mock sampling、8项packaging测试，全部退出0。

本地实现完成（L1）、仓库已提交（L2）；远程CI与真实三平台发布增强验证（V1）正在运行确认中，尚不能把本机交编当作macOS原生测试。详见 evidence/delivery.md。

本轮原始要求文件 SHA-256：E0CBC6893AD144FA9252650B9285ECC687812E9D80B588E6D52F8CEFC1BD15B3。
