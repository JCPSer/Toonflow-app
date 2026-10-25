# 测试结果：会话恢复（窗口几何 / 上次画布 / 面板布局 / 画布视图偏好 / 关窗闸门）

环境：macOS arm64 / dev server `TOONFLOW_DATA_DIR=/tmp/tf-lib/data` 端口 3121 / vite 5173 / 测试项目 `libproj`

## 一、静态检查与构建

| 项 | 命令 | 结果 |
| --- | --- | --- |
| apps/web 类型检查 | `bun run typecheck` | 通过 |
| apps/server 类型检查 | `bun run typecheck` | 通过 |
| apps/desktop 类型检查 | `bun run typecheck` | 通过 |
| apps/web 构建 | `bun run build` | 通过 |
| 桌面主进程打包 | `bun /tmp/bundle-desktop.ts` | 通过（23.5 MB） |

## 二、服务端（隔离实例，临时数据目录 + 31999/31998 端口，测后清理）

| # | 用例 | 结果 |
| --- | --- | --- |
| 1 | `GET /api/sessionState/get` 无 `x-toonflow-workspace` 头 | 403 拒绝 |
| 2 | `GET` 带头部 | 200，返回 `{}` |
| 3 | PATCH `canvasView.snap=true` 后再 PATCH `panels.asset.width=400` | 两次都保留（叶子合并生效） |
| 4 | PATCH `__proto__` | 400，拒绝且不落盘 |
| 5 | 冷启动并发两个 PATCH | 两块字段都保留（串行合并修复前会丢一个） |
| 6 | 项目根放 `.env`/`.git`/`.toonflow`/`library` 等 | 仅 `.env` 等用户文件可见，元数据目录全隐藏 |
| 7 | 写 `.toonflow/ui.json` | 200 |
| 8 | 写 `.toonflow/evil.json` | 403 EPROTECTED |
| 9 | `mkdir .toonflow` | 200；`mkdir .toonflow/ui.json` → 403 |

## 三、真实 dev 实例（浏览器实测，3121 重启后）

| # | 用例 | 结果 |
| --- | --- | --- |
| 10 | 打开项目 | 自动创建 `.toonflow/ui.json`，内容 `{"version":1,"lastCanvas":"画布1.json"}` |
| 11 | 首次进入后会话状态 | `panels.asset` 迁移一次（width 360 / docked true / migratedAt），未重复写 |
| 12 | 吸附开关（此前 PATCH 过 `snap=true`） | 界面按钮 `aria-pressed=true`，说明画布视图偏好从会话状态恢复 |
| 13 | 造 `子目录/画布2.json` 并改指针后刷新 | 直接打开「画布2」，指针 `updatedAt` 被刷新 |
| 14 | 再次刷新 | 仍停留在「画布2」（指针持久化生效） |
| 15 | 删除画布2 后刷新 | 回退到「画布1」，指针被写回 `画布1.json` |
| 16 | 画布切换弹层 | 显示 `子目录 / 画布2 / 画布1`，**不出现** `.toonflow` 或 `.git` |
| 17 | 关闭再打开素材库面板后刷新 | 面板按会话状态恢复为打开（`panels.asset.visible=true` 已落盘） |
| 18 | 控制台 | 无新增异常；仅 404（项目无 assets 目录、connection 探测）与 409（`.toonflow` 已存在）等预期噪音 |

## 四、未覆盖（需重启打包后的 app 才能验）

| # | 用例 | 说明 |
| --- | --- | --- |
| 19 | 调窗口大小/位置 → 退出 → 重启 | 需在 /Applications/toonflow-exec.app 上实测 |
| 20 | 最大化 → 退出 → 重启仍最大化，还原回上次普通尺寸 | 同上 |
| 21 | 拔掉副屏后重启，窗口回到主屏可见区 | 同上（拔显示器需人工） |
| 22 | 拖节点后立即 ⌘Q，重开节点位置已保存 | 同上 |
| 23 | 安装更新并重启不被闸门阻断 | 需真实更新包，暂缓 |

## 五、测试数据清理

- 临时隔离实例及其数据目录已删除，端口 31998/31999 无残留。
- 测试项目里临时造的 `子目录/画布2.json` 已删除；`.toonflow/ui.json` 保留（属正常产物，指向 `画布1.json`）。
