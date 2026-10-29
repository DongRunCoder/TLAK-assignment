# A0–A7 真实 UI 验收

运行：`npm run build` 后 `npm run verify:harness`；脚本启动全新 `anna-app dev --no-llm --storage legacy --bundle ./bundle`，使用独立无头Edge打开dashboard的真实iframe，没有mock Host。

1. A0：SDK连接、首次storage.get空文档。
2. A1：全空白保存禁用。
3. A2/A3：保存“明天联系客户”“修复登录 bug”，序号1/2，两次成功后输入清空。
4. A4：删除序号1，立即隐藏并写storage，剩余序号2。
5. A5：保存“整理 Workshop 想法”，序号3。
6. A6：点击重新读取，仍为序号2/3，没有刷新外层dashboard。
7. A7：tools.invoke的tool_id=mini-notes-summarizer、method=summarize、notes恰为B/C；UI显示真实 `SAMPLING_HOST_ERROR: [-32603] harness started with --no-llm`。

`ui-host-rpc.jsonl` 是实际网络请求/响应，不是官方fixture recording格式；`ui-harness-report.json` 为完成全部断言后生成的报告，含实际HTTP SDK hash。SDK与锁定npm文件hash一致，App consoleErrors为空；唯一warning为官方dashboard的favicon404。

桌面与360px窄窗截图分别为ui-harness.png与ui-harness-narrow.png，截图仅含App iframe，未保存临时window token。此路径不宣称模型总结成功，成功summary的官方mock来源证据见cli-sampling.json与protocol.jsonl。
