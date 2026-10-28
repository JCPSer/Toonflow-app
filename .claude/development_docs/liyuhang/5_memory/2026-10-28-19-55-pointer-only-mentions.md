# 记忆：引用改纯指针 + 画布平移卡顿

## Situation

Agent 对话框的引用有三条路径都把正文塞进上下文：画布输出引用（文本类 `readText` 读全文，上限 10 万字符）、素材引用（`STRING` 同样读全文）、聊天附件（`text/plain` 全文放进 `content`）。一个几万字的文本节点被引用一次就吃掉大段上下文，且内容随节点改动很快过期。

同期用户报「选中节点出现输入框后平移画布很卡」。实测（26 节点 26 连线、Chromium 20x CPU 降速）推翻了直觉判断：隐藏输入框后 Paint/帧几乎不变（38.1 vs 37.5），而关掉连线动画直接回到基线（3.0）。根因是 `index.vue` 的边 class 生成——只要节点被选中，所有直连边立刻挂 `animated`，触发 SVG `stroke-dashoffset` 无限动画；该属性不可合成、必须逐帧光栅化，且 edges SVG 不是独立层，失效冒泡到根层（`#document` 12.5 次重绘/帧）。

## Task

引用与附件改为只传指针不发原文；画布选中态平移不再卡顿；运行时长角标挪到节点框外并消除它带来的重渲染。

## Action

- **输出引用**：`createCanvasMention` 去掉 `readText` 参数，文本输出返回 `{ path: textPath, mimeType: "text/markdown" }`。签名从 4 参减到 3 参，前端与服务端调用点同步。
- **素材引用**：`STRING` 类型从读全文改为 `{ path, mimeType }`。
- **媒体引用**：删掉 `snapshotMentions` 里复制到 `assets/chat/` 的整段逻辑与回滚清理，直接用原路径；保留可用性检查（存在/非空/≤100MB）与 `asset` 的来源校验。
- **附件**：删除 `text/plain` 读全文分支，统一只带元信息。
- **schema**：新增 `textPointerSchema = { path: 1..4096, mimeType: 1..128 }`，校验分支允许「指针对象」或「纯字符串」——后者是硬要求，历史消息里的引用已存成字符串，重发必须仍过 schema。
- **连线降频**：关键判断是**单纯拉长周期无效**，因为 linear 插值每帧取值都不同。必须用 `steps()` 把连续插值改成离散跳变：`animation: canvasEdgeFlow 2s steps(20) infinite`，offset 从 10 走到 0（dasharray 周期 = 5 实 + 5 虚 = 10，可无缝循环），失效频率 60Hz → 10Hz。
- **图层隔离**：`.vue-flow__edges { contain: paint }`。
- **角标位置**：从 `cardContainer` 内 `top:4px;right:4px` 改为相对 `cardContainer` 的 `bottom: calc(100% + 3px); right: 0`。第一次改到节点根层失败——把标题栏（20px 行高 + 8px 内边距 ≈ 28px）算了进去，恰好偏离卡片约 1/4 高度（卡片最小 100px）。
- **计时隔离**：新建 `durationBadge.vue` 自己持有计时状态，`nodeSkeleton` 只传 `:busy`/`:active`。原实现每秒更新会让骨架重渲染，进而调用 `<slot>` 重建节点内容（markdown 预览、播放器等），而运行中正是内容最该稳定的时候。

## Result

server / scaffold / 9 节点包 typecheck 全 0；9 包 + web + server + 桌面入口全部构建成功并部署。

schema 五用例全过：指针形态通过、旧纯字符串通过、媒体仍要求 url、空 path 被拒；单条文本引用序列化 294 字节。计时隔离实测：5 次秒更新引起的父级重渲染从 5 次降到 **0 次**，子级正常更新。产物核对：`steps(20,end)` 与 `@keyframes canvasEdgeFlow` 命中、`contain:paint` 命中、角标 aria 语义命中、server 产物已无旧的读全文提示。

审查（针对上一版角标）还查出四个口径错误并已修：打光/多角度/全景通过 `node:generateImage` 立即返回导致父节点定格「耗时 0s」（imageGenerationNode 只留 `generating`、imageNode 整个移除 `busy`）；`creatingAnalysis` 只是建节点几百毫秒且会覆盖真实耗时（videoNode/videoGenerationNode 移除）；director3d 的空串 `error` 会让角标永久停在运行态（改 `task.error === undefined`）。另补了对比度（`--el-text-color-regular`）、极窄节点 `max-width` 防溢出、`role="timer" aria-live="off"`。

待手测：WKWebView 下 `steps()` 与 `contain:paint` 的实际表现（未实测，Chromium 数据可能不直接迁移）；角标新位置的观感；模型是否真的先 `read` 再回答。

`router.ts` 第四次被工具重排，已还原，提交里不含它。
