# Session Recovery Implementation Plan

**Goal:** 用户已授权：检测多标签页抢占与Host重启导致的失效，准确提示连接状态，手动恢复时保留草稿；未知写入保护保持，question.md不改。

**Architecture:** App只经Anna Runtime读写、调用工具，以Host错误分类和可见页面的只读轮询发现失效。轻量postMessage桥仅在开发预览外壳启用，验证source/origin/版本/nonce/长度；用户点击后，外壳把草稿暂存在内存，通过官方session/create重建并mount新iframe，握手交还草稿并在ACK后清除。原始官方入口保留，仅提供复制草稿及手动恢复说明。无浏览器持久化、URL草稿、自建业务接口、自动刷新或自动重放notes写入。

## 约束与接口

- 严格识别固定CLI的 `transport` + `[-32602] unknown session_id: <id>`；一般参数错误不能视作会话失效。transport/timeout显示暂不可用，可经成功Host读取恢复；expired锁存至新会话。
- 通过runtime包装器观察storage/tools响应；15秒仅在页面可见时请求repository同步，窗口focus/visibility恢复也做一次；复用串行/确认通道，不重复写入。
- UI以真实Host状态显示“Anna 已连接 / 正在检查 Anna… / Anna 暂不可用 / 会话已失效”。会话失效文案不回显ID。新会话的成功不能自动重放旧操作。
- `snapshot.mutation`存在（包含reconciling）时禁止恢复；仍可复制草稿、读取确认。恢复中的编辑暂时禁用，失败恢复编辑，原稿不清空。
- bridge频道 `mini-notes:session-recovery:v1`；App每次document生成随机documentId。hello → available；recover{documentId,requestId,draft,uncertain:false} → 新iframe；新document hello → restore{documentId,requestId,draft} → restored ACK。error只回固定中文文案。
- source必须是当前#app.contentWindow / window.parent，origin必须为同源；普通Anna RPC消息不处理。最多65536 UTF-16单元/262144 UTF8字节草稿，超限保留原页并提示手动复制。只保留一次待交接，不在日志、recording、URL或文件记录正文。
- parent使用固定相对官方接口与现有dashboard的sessionId/windowUuid/currentToken/mount；维护恢复后的WS事件转发，复用现有token刷新定时器。旧iframe销毁其SDK；不再次调用官方start以累积定时器。
- 开发验证和最终体验使用独立bundle/端口，避免watch重载现有5198草稿。

## Tasks

- [x] 先补错误分类、Host状态、草稿保留/未知写入、手动恢复与桥安全失败测试，确认RED。
- [x] 最小实现App分类/观察/恢复桥与连接UI。
- [x] 外壳桥：手动新会话、内存交还、失败保持、绑定与边界测试。
- [x] 独立真实Host两页抢占：旧页失效但draft不丢，不自动create；手动恢复一次，draft交还，保存仍走Host。
- [x] 独立Host重启：同页暂不可用/失效，原稿保留；Host回归后手动恢复。阻止未知写入恢复；无自动重放。
- [x] 前端/安全/预览、TypeScript/build/strict/contracts、真实Harness及独立sampling；独立只读评审与要求文件hash。
- [x] 更新README/acceptance，启动独立最终体验入口并打开。后续提交、推送及CI验证按用户明确授权执行。
