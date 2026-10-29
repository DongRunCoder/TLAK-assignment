# 交付状态

## v0.1.1：2026-10-30 已完成

- 新增首次使用引导、可重开帮助、准确no-llm说明及安全限额/错误脱敏/权限契约/证据脱敏；保持原Anna调用链与UI风格。
- 本地前端63项、安全41项、打包8项、完整Go、11组协议、官方mock sampling与真实harness18次Host调用均通过。
- 冷Go缓存复验工具调用14862ms，验证修正后的70秒测试等待；无App/repository时序改动。
- 完整CI成功：https://github.com/DongRunCoder/TLAK-assignment/actions/runs/40919015848 ，验证源码 `1c58303124d70e3676a37dfc4208102406137981`。
- 三平台原生构建、逐机解包执行、统一发布成功：https://github.com/DongRunCoder/TLAK-assignment/actions/runs/40916741097 。
- 公开非draft Release：https://github.com/DongRunCoder/TLAK-assignment/releases/tag/v0.1.1 ，源码 `68ab439c4df804023064211af1c015c159381121`。
- 实际资产为 `mini-notes-summarizer-0.1.1-darwin-arm64.tar.gz`、`mini-notes-summarizer-0.1.1-darwin-x86_64.tar.gz`、`mini-notes-summarizer-0.1.1-windows-x86_64.zip`、`SHA256SUMS`、`release-metadata.json`。
- 本地新版服务为 http://localhost:5198/ ，原5180会话未重启；无真实模型/账号/Key，独立mock只验证协议与动作边界。

## v0.1.0 历史记录

- 目标：DongRunCoder 名下公开仓库 TLAK-assignment，用户已指定。
- 本地源码与测试：已完成；实际命令/证据见 docs/acceptance.md。
- 本机可运行产物：dist/mini-notes-summarizer-0.1.0-windows-x86_64.zip，已解压并执行协议smoke。
- macOS产物：darwin-arm64和darwin-x86_64已交编并检查archive；未运行macOS二进制。
- GitHub仓库URL：https://github.com/DongRunCoder/TLAK-assignment ，已确认为公开仓库并完成首次推送。
- 初始实现commit：27fc799856ca7af066f6fc656483ff5fd8d3abc9；源码zip的全新目录复现通过。
- 远程CI：success，https://github.com/DongRunCoder/TLAK-assignment/actions/runs/40893795605 。
- 三平台原生构建/解压协议smoke及统一发布：success，https://github.com/DongRunCoder/TLAK-assignment/actions/runs/40893795409 。
- 真实Release：https://github.com/DongRunCoder/TLAK-assignment/releases/tag/v0.1.0 ，非draft，五个资产uploaded。
- Release源码commit：2bb9498d6dd83cbf6bd86861a85d41827406beb7。release-metadata.json和API目标commit已交叉核对。
- 手动重复发布验证：success，https://github.com/DongRunCoder/TLAK-assignment/actions/runs/40894532469 。prepare核验旧公开产物通过，后续build/release跳过，公开资产未覆盖。
- 本地L1、仓库交付L2、三平台发布增强证据V1均已完成；本文件后续提交仅记录结果，不改变v0.1.0已经验证的源码。

代码仓库不包含账号密码、模型API key或window token。无Anna登录、无真实模型调用、无云数据库。
