# 测试结果：文本节点生成中可打断

环境：macOS arm64 / dev server `TOONFLOW_DATA_DIR=/tmp/tf-lib/data` 端口 3121 / vite 5173

## 一、静态检查与构建

| 项 | 命令 | 结果 |
| --- | --- | --- |
| apps/server 类型检查 | `bun run typecheck` | 通过 |
| apps/web 类型检查 | `bun run typecheck` | 通过 |
| packages/nodeScaffold | `bunx vue-tsc --noEmit` | 通过 |
| apps/web 构建 | `bun run build` | 通过 |
| 桌面主进程打包 | `bun /tmp/bundle-desktop.ts` | 通过（23.5 MB） |
| 路由生成 | `bun run routes` | 旧路由全部保留，仅新增 `/api/ai/generate/stop` |

## 二、服务端（隔离实例 + 本地 mock SSE provider，由实现阶段实测）

| # | 用例 | 结果 |
| --- | --- | --- |
| 1 | 未知 runId 调 stop | 200 `{stopped:false}`，日志 `stop miss` |
| 2 | 缺 `x-toonflow-workspace` | 403 |
| 3 | 非法 runId | 400 |
| 4 | 真实生成流中 stop | 返回 `{stopped:true}`；流在 7 个 text 事件后结束；**无 error 事件**；mock 上游收到 client aborted |
| 5 | 日志顺序 | `run abort` → `stop hit` → `stream ended by abort`，均带 runId |
| 6 | 墓碑竞态：先 stop 未知 runId 再立即用同 id 生成 | 立即中止，无 error 事件 |
| 7 | 正常生成结束 | 不误报 abort（`writableEnded` 判定） |

## 三、真实 dev 实例

| # | 用例 | 结果 |
| --- | --- | --- |
| 8 | stop 接口可达（经过 3121） | 200 `{stopped:false}`，日志 `stop miss` 正常打印 |
| 9 | 后续修复后重启 | 服务启动 0.6s，stop 接口与 miss 日志正常 |

## 四、未覆盖（需要真实模型）

| # | 用例 | 原因 |
| --- | --- | --- |
| 10 | 界面上点「停止」观察按钮图标切换与文字停止 | dev 数据目录里只有 `fake-model`，生成链路未配置真实 provider，画布内无法发起有效生成长文 |
| 11 | Esc 停止（焦点在输入框 / 画布空白两种） | 同上 |
| 12 | 生成中取消选中/多选后仍能停止 | 同上 |
| 13 | 保存冲突（409）时部分文本保留 | 需要构造磁盘冲突 |

> 上述 10–13 的代码路径已在实现与两轮评审中逐条核对（按钮 disabled 分支、bottomPinned、Esc 作用域、isComposing、finally 保存顺序）。建议在有真实模型的机器上手工验证一遍。

### 4.1 返工记录（01:05）

用户实测仍是转圈，定位为**只重建了 web 与桌面主进程，没重建节点 UMD**：

| 项 | 处理 |
| --- | --- |
| `build/nodes/textNode.umd.js` 无新逻辑 | 执行 `bun run build:nodes` 重建 |
| `Resources/app/nodes` 仍是旧包 | rsync 同步后重新 codesign |
| app 进程仍持有旧 webview | 退出并重启 app |

校验：`grep "停止生成"` 在新产物中命中 1 次、`canvasActive` 与 `generate/stop` 均存在；旧包为 0。

### 4.2 二次返工（01:10）：数据目录里的节点不会自动覆盖

重建节点、同步进 App 包后**仍然无效**。定位到服务端启动时会把内置节点复制到 `<data>/nodes`，实际读取的是数据目录里那份，而 `initializePlugins` 在无 revision 时用 `cp { force:false }`，不覆盖已存在文件。

| 环境 | 处理 | 验证 |
| --- | --- | --- |
| 打包 app | 删除 `/Applications/data/nodes/initialized` 后重启 | `GET /api/nodes/files?name=textNode` 返回 348007 字节，含「停止生成」 |
| dev 3121 | 无 revision 分支不覆盖，手动 rsync `build/nodes` → `/tmp/tf-lib/data/nodes` | 同上，返回 348007 字节 |

结论：以后改节点/脚手架，除了 `bun run build:nodes` 与同步 App 包，还必须处理数据目录那份；验收一律以「请求运行中实例的 `/api/nodes/files`」为准，而不是看磁盘上的构建产物。

## 五、测试前置说明

- 本轮没有新增测试文件（遵循仓库 `AGENTS.md` 约束），mock provider 与临时数据目录在测后已清理。
- dev server 已按原参数重启；`/Applications/toonflow-exec.app` 已同步新产物并重签（备份 `/tmp/toonflow-exec-old20.app`）。
