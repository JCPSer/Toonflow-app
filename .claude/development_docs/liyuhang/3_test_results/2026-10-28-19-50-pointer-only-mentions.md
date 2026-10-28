# 测试结果：引用改纯指针 + 画布卡顿 + 角标

日期：2026-10-28 19:50

## 一、静态检查

| 项目 | 结果 |
| --- | --- |
| `@toonflow/server` typecheck | 0 |
| `@toonflow/nodes-scaffold` typecheck | 0 |
| 9 个节点包 typecheck | 全部 0 |
| 9 个节点包 production build | 全部成功 |
| `@toonflow/web` build | 成功 |
| 服务端 standalone build | 23.27 MB |
| 桌面入口打包 | 23,559,989 B |

## 二、引用 schema 用例

| 用例 | 期望 | 结果 |
| --- | --- | --- |
| STRING 指针形态 `{path, mimeType}` | 通过 | PASS |
| 旧会话纯字符串 `value` | 通过（向后兼容） | PASS |
| 媒体引用 `{url, mimeType}` | 通过 | PASS |
| 空 `path` / 空 `mimeType` | 拒绝 | PASS |
| 单条文本引用序列化体积 | 数百字节级（正文不再进入） | 294 字节 |

## 三、计时隔离

用 Vue 响应式图验证（父组件只依赖 busy，子组件持有 elapsed）：

| 指标 | 改造前 | 改造后 |
| --- | --- | --- |
| 5 次秒更新引起的父级重渲染 | 5 次 | **0 次** |
| 子级自身更新 | — | 5 次（正常） |

结论：父级不随秒重渲染，子级每秒更新，符合预期。

## 四、产物核对

| 产物 | 检查 | 结果 |
| --- | --- | --- |
| `build/web/assets/workspace-*.css` | `steps(20,end)` 动画 | 命中：`animation:2s steps(20,end) infinite canvasEdgeFlow` |
| 同上 | `@keyframes canvasEdgeFlow` 定义 | 命中：`0%{stroke-dashoffset:10px} to{stroke-dashoffset:0}` |
| 同上 | `.vue-flow__edges{contain:paint}` | 命中 |
| `build/nodes/textNode.umd.js` | 角标 aria 语义 | 命中 2 处（`role="timer"` / `aria-live`） |
| `build/server/index.js` | 旧的「文本引用最多支持 100000 个字符」提示 | 0 处（读全文逻辑已删除） |

## 五、部署

`deploy-local.sh` 报告 9 个节点包全部 `updated`；桌面入口与服务端已安装到 `/Applications/toonflow-exec.app`。重启应用生效。

## 六、审查查出的口径问题（已修）

| 节点 | 问题 | 修正 |
| --- | --- | --- |
| imageGenerationNode | 打光/多角度/全景立即返回，父节点定格「耗时 0s」 | 只留 `generating` |
| imageNode | 同上，且 `panorama.busy` 含上传与截图会反复重置 | 整个移除 `busy` |
| videoNode / videoGenerationNode | `creatingAnalysis` 只是建节点，几百毫秒且会覆盖真实耗时 | 移除该项 |
| director3dNode | 空串 `error` 使角标永久停在运行态 | 改 `task.error === undefined` |
| 角标 CSS | 文字色 `secondary` 对比度约 3:1，不到 AA | 提到 `--el-text-color-regular` |
| 角标 CSS | 极窄节点（1:10 长图约 42px）会溢出 | 加 `max-width:100%` + ellipsis |
| 角标 a11y | 方案承诺的 `aria-live="off"` 缺失 | 补 `role="timer" aria-live="off" aria-label` |

## 七、未覆盖 / 待手测

- **桌面端实测**：`steps()` 与 `contain:paint` 在 WKWebView 下与 Chromium 的差异未验证。若平移仍卡，下一步是改用合成层动画方案。
- 选中节点平移画布的主观流畅度（需你在应用里确认）。
- 角标在新位置的视觉观感（是否与标题栏按钮拥挤）。
- 模型是否真的会先 `read` 再回答，而不是凭空假设引用内容——需要一次真实对话验证。
