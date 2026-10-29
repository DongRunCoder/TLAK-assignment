# 实现独立审阅

日期：2026-10-29。范围为冻结版 Go Executa、官方 sampling 测试入口、原生打包/验包脚本、Release 脚本与 CI/Release workflows；未审阅前端实现。本报告没有执行 GitHub Actions 或创建/发布 GitHub Release。

## 规格审阅

对照 `question.md`，并按 `docs/acceptance.md` 与 `docs/p0-contract-notes.md` 已核实的平台行为解释兼容路径，本范围未发现规格缺项。

- `initialize` 声明 v2 sampling；`describe` 返回含 Anna `parameters[]` 与 `llm.sample` 的裸 manifest。App 的无握手 invoke 与独立 runner 的无 context invoke 均有兼容处理，后者生成每次调用独立的 local UUID。
- 总结文本直接取自 reverse `sampling/createMessage` 的 host 回复；请求包含当前 notes、prompt、context/metadata 关联。官方 mock runner 的测试精确比较 fixture sentinel，手动协议测试另外核对请求内容和双向关联。
- 打包支持所需三个平台 key、macOS tar.gz 与 Windows zip，archive root manifest、相对 binary entrypoint、平台架构与 macOS 0755 权限均有校验。smoke 从新目录提取并执行 archive 内二进制。
- Release workflow 以三个原生 runner 构建，再统一上传 GitHub Release assets；workflow artifacts 只在 jobs 间传递。发布前后检查 tag commit、版本、完整资产集合、下载 checksum 和 archive。公开 Release 重跑先验证既有资产后跳过重建，同 commit draft 可重试。

## 质量审阅

未发现需要报告的代码缺陷（无 P0–P3 findings）。另检查了 stdout JSONL/flush、单 stdin reader 的 request/response 分发、pending 注册顺序、超时/取消清理、晚到回复、单活动 invoke 槽位与有限退出流程；未发现阻塞当前交付的问题。

本审阅独立执行且退出码为 0：

- 项目 Node 26.13.0 执行 `node --test tests/packaging/*.test.mjs`：8 项通过、0 失败。
- 项目 Node 26.13.0 执行 `node scripts/go.mjs test ./...`：通过；Go 输出为 cached，未把它写成额外无缓存压力验证。

本审阅未改写根 `evidence/` 中的验收记录。真实三平台执行与 Release API 发布行为仍应以实际 GitHub run 和资产链接为证；静态审阅及本机测试不能代替该证据。
