# 测试结果：视频截帧、素材库目录定位、拖动副本

日期：2026-10-28 12:05

## 一、静态检查

| 项目 | 结果 |
| --- | --- |
| `@toonflow/node-video` typecheck | 0 |
| `@toonflow/server` typecheck | 0 |
| `@toonflow/web` typecheck | 仍只有仓库既有报错 `apps/server/src/modules/agentAccess/singleAgent/types.ts(2,33): Cannot find module '@/agentRuntime'`；把本轮改动 stash 后同样报错，确认与本次无关 |
| `@toonflow/node-video` build | 成功 |
| `@toonflow/web` build | 成功 |

## 二、产物核对

- `build/nodes/videoNode.umd.js` 含新的 `loadFrame`：`onloadedmetadata` 计算 `total`，首帧取 `Math.max(.05, min(time, last||.05))`，`onseeked` 内校验 `readyState < 2 || !videoWidth` 后才 resolve（不再用 `loadeddata` 直接放行）。
- `build/desktop/main/index.js` 重新打包 23,558,798 B，已安装到 `/Applications/toonflow-exec.app/Contents/Resources/app/bun/index.js`。
- 前端已 rsync 到 `Resources/app/views/mainview`，`theme-default-*.js` 含 `reveal-in-os`。
- 运行期节点包已同步，`videoNode.umd.js` 等 8 个包更新（需重启生效）。

## 三、接口验证（隔离实例）

`TOONFLOW_DATA_DIR=/tmp/tf2-data NODE_ENV=dev bun src/index.ts`（端口 3998）：

| 用例 | 期望 | 结果 |
| --- | --- | --- |
| `POST /api/assets/reveal`，`path: ""` | 通过参数校验（不再 400），进入守卫 | PASS：返回 403「仅支持本机访问…」 |
| `POST /api/assets/reveal`，`path: "a/b"` | 同上 | PASS：403 |

`path` 改用路由内私有的 `revealPathField = z.string().max(4096)`，共用的 `pathField`（11 个路由 + 批量数组）未放宽。

## 三之二、代码审查修复（第二轮）

| 级别 | 问题 | 处置 |
| --- | --- | --- |
| 严重 | `videoGenerationNode` 的播放器没传 `resolve-source`，海报态按钮可点却必然报「视频尚未就绪」，而同节点工具栏仍灰着 | 同步传 `:resolve-source="activate"` 并把工具栏按钮条件改为 `!outputFile` |
| 严重 | `awaitingSource` 期间 controller 还没建，切画布/卸载的 abort 全部落空，可能向旧画布落节点 | controller 提到 await 之前创建，并在激活后 `throwIfAborted` 校验 |
| 重要 | `last` 模式在 `duration ≤ 0.1s` 时 target=0，同值不触发 seeked，会空等 15s | 改为 `Math.max(0.01, last)` |
| 重要 | 激活失败时 activate 已弹「视频读取失败」，随后再抛「视频尚未就绪」重复提示 | 捕获后直接 return |
| 建议 | reveal 放行了 `.` 与前尾空白 | `revealPathField` 加 `refine`：只允许空串或合法的已 trim 路径 |
| 建议 | 截帧从海报态激活后鼠标不离场，30s 闲置释放不触发 | 收尾处主动 `scheduleIdle()` |
| 建议 | 快捷键说明「带连线」不够准确 | 改为「带入边连线」「不复制连线」 |

目录右键改为「直接进入」：`reveal.ts` 检出 `lstat(path).isDirectory()` 后走 `open <dir>` / `explorer <dir>`，文件仍用 `showItemInFolder` 高亮选中；抽出 `spawnDetached` 统一拉起进程。

## 四、未覆盖 / 待手测

- 海报态（未播放）点截帧：首帧/当前帧/尾帧三种命令的真实出图效果，需要重启应用后在界面验证。
- 首帧是否仍为黑帧：代码层已改为 seek 0.05s + `seeked` 校验，属经验性修复，需用真实视频确认。
- 素材库右键**空白处**与目录树根节点的「在访达中显示」实际打开 Finder 的行为。
- 设置里把「创建副本」改绑为 `Alt+Shift` 后拖动的实际效果（连线、`- 副本` 标签）。
- Windows 分支（`explorer` / `explorer /select`）仅静态核对。
- 目录右键「直接进入」的实机效果（需重启应用）。
- `POST /api/assets/reveal` 的 `path:"."`、`" a "` 返回 400，`""` 通过参数校验进入守卫（403），已用隔离实例验证。
