# 测试结果：视频重新生成后首尾帧显示旧图

- 时间：2026-11-03 01:17
- 对应：`bug_analysis-2026-11-03-01-17-video-frame-thumbnail-stale.md`、`bug_solution-2026-11-03-01-17-video-frame-thumbnail-stale.md`

## 1. 用户现场盘面取证（修复前）

工程：`/Volumes/WD_BLACK_MAC/[0]【AI Art】/2026/蕾姆Rem`

| 项 | 方法 | 结果 |
| --- | --- | --- |
| 抽帧是否真的刷新 | 脚本扫描 4 个画布 65 条首/尾帧输出，比较 `frame-*.jpg` 与 `outputs.video` 的 mtime | 65/65 帧都晚于其当前视频 |
| 内容是否正确 | 用本机 ffmpeg 从当前视频重抽，与盘上帧做 PSNR | 节点 `88eadb5b` 尾帧 70.74 dB；`23a149b6` 首帧 72.27 dB（视觉无差别） |
| 结论 | — | 落盘正确，问题在显示层缓存 |

## 2. 单元测试

| 用例 | 结果 |
| --- | --- |
| `apps/web/src/lib/fileVersions.test.ts`（5 个：初值 0、只递增本路径、目录隔离、写法归一、key 结构） | 5 pass / 0 fail |
| `apps/server bun test`（全量） | 103 pass / 0 fail |

## 3. 类型检查

| 目标 | 结果 |
| --- | --- |
| `apps/web`：`vue-tsc --noEmit` | 仅既有报错 `../server/src/modules/agentAccess/singleAgent/types.ts(2,33) Cannot find module '@/agentRuntime'` |

## 4. 构建与部署

| 产物 | 校验 |
| --- | --- |
| web 构建 | exit 0；入口 `index.html` md5 `581e7fecfafb8d2073f888e4d0dd0a87`，两侧一致 |
| 桌面稳定版构建（electrobun `--env=stable`） | 完成，产出 `2g9arnho7dgui.tar.zst` |
| `Resources/app/bun/index.js` | md5 `ca0bd882cf3f6e0d33b43b3416edbbf5`，两侧一致；产物内确认 `private, no-cache` 1 处、素材库仍为 `public, max-age=31536000, immutable` |
| 前端产物抽查 | `workspaceFiles-*.js` 中 `thumbUrl` 已带 `v:String(<version>)` |

## 5. 待用户验收（需重启应用）

1. 重新生成视频后，输出项下拉里的首帧/尾帧缩略图立即变为新视频的帧。
2. 下游连线节点上的引用图同步变化，无需切换画布。
3. 不重新生成时，缩略图仍命中缓存（不应每次重新生成缩略图）。
4. 重启应用后，同一路径的缩略图仍能拿到最新内容。

## 6. 未覆盖

- 未在运行中的应用内做端到端点击验证（按约定不重启用户应用）。
