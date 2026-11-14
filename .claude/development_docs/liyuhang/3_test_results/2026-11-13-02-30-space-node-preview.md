# 测试结果：画布空格预览选中节点

- 时间：2026-11-13 02:30
- 对应方案：`2026-11-13-02-30-space-node-preview.md`

## 1. 单元测试

`bun test apps/web/src/pages/workspace/panels/canvas/nodePreview.test.ts` → **10 pass / 0 fail**（评审后补测）

覆盖：IMAGE 直取并带 mimeType、MASK 按图片、视频节点同时有首尾帧时优先 VIDEO、无视频时 AUDIO 优先于 IMAGE、
首个视频 url 为空时回落、同类多输出按「优先端口 → handles 顺序」、无 handles 退化键序、
空 outputs/空 url/空 mimeType/undefined 输入、STRING/INT/FILE 不参与、空标题回退「节点预览」。

## 2. 静态检查

| 项 | 结果 |
| --- | --- |
| `bun run --filter '@toonflow/web' typecheck` | 仅剩既有 `@/agentRuntime` 报错，本次零新增 |
| `bun run --filter '@toonflow/web' build` | 成功，已 rsync 到应用 `views/mainview/`（02:30） |

## 3. 逻辑核对

| 场景 | 期望 | 依据 |
| --- | --- | --- |
| 按住空格拖动 | 平移，松手不弹预览 | pointerdown 在捕获阶段清掉候选 |
| 按住空格超过 400ms 再松手 | 不弹预览 | keyup 时判超时 |
| 轻点空格（单选媒体节点） | 弹预览 | 候选未被打断 + 时长内 + 单选 |
| 轻点空格（无选/多选/无媒体输出） | 无反应 | openNodePreview 的守卫 |
| 焦点在输入框/节点内控件 | 不弹预览 | keydown 判定排除文本控件；inCanvas 判定 |
| 预览打开后按 Delete/方向键 | 不生效 | keydown 早退 + hasModalOverlay 含 image-viewer |
| 预览打开后按 Esc | 关闭预览，不弹退出确认 | hasVisibleOverlay 含 image-viewer |
| 切画布/失活 | 预览关闭 | watch([canvasId, active]) |
| 视频/音频与节点内播放器同时 | 只有一个在播 | `installMediaPlayback` 全局协调 |

## 3.1 子 agent 审查修订（2026-11-13 03:00）

无 P0 遗留：原 P0（产物 url 是工作区相对路径，`<video src>` 会 404）已修——预览组件按 `project.directory`
用 `useWorkspaceFiles().acquireUrl()` 解析 blob，关闭/切换时 `release()`，读失败显示错误提示。
P1 三项（轻点判定误用 pressedCodes、preview↔pan 冲突误报并静默清空、节点内控件未排除）与
P2 五项（多端口取舍、错误与 autoplay、切项目、状态残留、输出结构校验）均已修，单测由 7 条扩到 10 条。

## 4. 待用户实机确认

- 轻点/按住的时序手感（400ms 阈值是否合适）。
- 大图查看器与视频弹窗的视觉尺寸。
- 视频 `autoplay` 在你机器上是否被 WebKit 拦截（拦截时仍可点播放）。

## 5. 用户验收

（待用户填写）
