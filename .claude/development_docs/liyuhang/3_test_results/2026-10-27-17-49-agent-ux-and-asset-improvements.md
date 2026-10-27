# 测试结果：Agent 交互区易用性 + 素材库两项改进

日期：2026-10-27 17:49

## 一、静态检查

| 项目 | 结果 |
| --- | --- |
| `@toonflow/server` typecheck | 0 |
| `@toonflow/desktop` typecheck | 0 |
| `@toonflow/nodes-scaffold` typecheck | 0 |
| `@toonflow/node-text` typecheck | 0 |
| `@toonflow/node-shared` typecheck | 0 |
| `@toonflow/web` typecheck | 仅 1 条仓库既有报错：`apps/server/src/modules/agentAccess/singleAgent/types.ts(2,33): Cannot find module '@/agent/runtime/types'`（server 源码的 `@/*` 在 web 的 tsconfig 下被解析到 `apps/web/src`；HEAD 同样存在，与本次改动无关） |
| `bun run --filter '@toonflow/web' build` | 成功（修复了 nodeSkeleton 里 `//` 注释导致的 CSS 解析错误后重跑通过） |

## 二、接口测试（隔离实例，未碰真实数据目录）

启动方式：`TOONFLOW_DATA_DIR=/tmp/tf-test-data TOONFLOW_SERVER_PORT=3999 NODE_ENV=dev bun src/index.ts`（cwd=`apps/server`）。夹具：全局素材库放一个 200 MB 稀疏文件 `big.mp4`，工作区 `/tmp/tf-ws`（含 `.toonflow/ui.json`）。

| 用例 | 期望 | 结果 |
| --- | --- | --- |
| `POST /api/assets/copyToWorkspace`（200 MB 视频） | 200，返回工作区相对路径 | PASS，返回 `assets/testnode1/<uuid>.mp4` |
| 硬链接校验 | 源文件与目标 inode 相同 | PASS：`107629533` = `107629533`，链接计数 2 |
| 不存在的大文件是否走请求体 | 不经过 100 MB raw 限制 | PASS：接口只传相对路径，服务端 `link()` 完成 |
| `nodeId: "../evil"` | 400 | PASS（zod regex） |
| 素材不存在 | 404 | PASS（ENOENT 映射） |
| `POST /api/assets/reveal` 不带 Origin/Referer | 403 | PASS（`isLocalWorkspaceRequest`） |
| `POST /api/assets/reveal` 访问 `.trash/x` | 403 | PASS（`assertAssetRelativePath`） |

## 三、构建与部署

- `build/web` 产物生成成功。
- `build:nodes` 成功；桌面入口 `build/desktop/main/index.js` 重新打包（23,551,977 B，含 `copyToWorkspace`、`canCreateDirectories`）。
- 已通过 `scripts/deploy-local.sh` 安装到 `/Applications/toonflow-exec.app`，并同步运行期节点包到 `/Applications/toonflow-data/nodes`（9 个节点包更新，需重启应用生效）。

## 四、代码审查与修复

子 agent 代码审查未发现阻断级缺陷，以下问题已修：

| 级别 | 问题 | 处置 |
| --- | --- | --- |
| 高 | osascript 10s 超时会在用户慢慢新建文件夹时杀进程、叠出第二个面板 | 去掉超时，只在进程报错/非零退出时回退 |
| 中 | 普通浏览器打开时 `canReveal` 仍为真，点击只会 403 | 改为仅桌面客户端 `isDesktop && !isRemoteConnection` |
| 中 | 复制请求在途被取消时服务端可能已落盘，留下孤儿文件 | 取消/异常时按 `assets/<nodeId>` 目录兜底清理 |
| 中 | 压缩/删除消息后历史索引可能指向错误消息 | 改存消息 id，排队执行时按 id 找回；索引越界先夹回范围 |
| 低 | 输入法组合期间方向键被抢 | 两处都加 `isComposing / keyCode 229` 判断 |

未采纳：新菜单文案未补 20 个语言文件（`translate("中文")` 会回退中文，与现有许多文案一致）。

## 五、未覆盖 / 待手测

- ⌘←/→/↑/↓ 在真实 WebView 中的原生光标行为（代码层面已确认捕获顺序，需手测确认 WebKit 默认行为）。
- 历史消息的提及/附件还原、发送后复位、rewind 后表现。
- macOS 原生面板能否正常弹出、是否有"新建文件夹"（osascript 需要一次真实交互）。
- 跨盘（EXDEV）回退复制：本机 `/tmp` 与 `/` 同卷，未构造跨卷夹具。
- 素材库右键"在访达中显示"实际打开 Finder 的行为（会弹 Finder，未在自动化里执行）。
- 文本节点边框动画的视觉效果与 `prefers-reduced-motion` 降级。
- Windows 相关分支（仅静态核对）。
- 素材库自身 100 MB 上传上限未变：174 MB 用例的前提是文件已在库内（外部放入/同步）。
