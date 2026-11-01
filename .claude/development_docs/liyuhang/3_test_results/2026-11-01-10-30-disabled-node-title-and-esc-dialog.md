# 测试结果：禁用节点隐藏标题开关 + Esc 退出确认框闪现修复

- 时间：2026-11-01 10:30
- 分支：`feat/exec-node`
- 变更：`stores/settings.ts`、`canvas/components/canvasControls.vue`、`canvas/index.vue`、`packages/nodeScaffold/src/nodeSkeleton.vue`

## 1. 测试边界

按 `AGENTS.md`「测试与检查边界」：不新增 `.test.ts` / `.spec.ts` / 检查脚本。验证采用类型检查、构建、静态核对与重启后的手动验证。

## 2. 类型检查

| 包 | 命令 | 结果 |
| --- | --- | --- |
| `apps/web` | `bun run typecheck` | 仅既有错误 `../server/src/modules/agentAccess/singleAgent/types.ts(2,33) Cannot find module '@/agentRuntime'`，改动文件无新错误 |
| `packages/nodeScaffold` | `bun run typecheck` | 通过（exit 0） |

## 3. 构建与部署

| 项 | 结果 |
| --- | --- |
| `scripts/deploy-local.sh --build` | 通过；首次因 nodeSkeleton 纯 CSS 里误写 `//` 注释导致 PostCSS 报错，改回 `/* */` 后通过 |
| 节点包 | 11 个内置节点 UMD 重新构建；已更新 `/Applications/toonflow-data/nodes` 与 Resources；`videoNode.umd.js` 三处 md5 一致 `7f996701141e9397a7149aefdd697dd5` |
| web 产物 | `workspace-BkDDJ3tK.js` md5 `0162bd9227e8fba2587efd352aa0142a`、`workspace-B2as2zOC.css` md5 `b086de9ac248f8e1a317bd59735e02ce`，与 Resources 一致 |
| 编译后 CSS | `.canvas.hideDisabledNodeTitles[data-v-*] .nodeDisabled .titleBar .labelText/.disabledBadge { position:absolute; width:1px; height:1px; margin:-1px; padding:0; overflow:hidden; clip-path:inset(50%); white-space:nowrap; pointer-events:none }` |
| 工具条 | 产物含「显示或隐藏禁用节点标题」；`IconTypographyOff` 存在 |
| 节点 UMD | 11 个内置包均含「节点已禁用）」标题提示；`margin-left:auto` 已进入节点 CSS |
| 应用重启 | **未重启**（按用户要求），需用户自行重启后生效 |

## 4. 静态核对

| 检查 | 依据 |
| --- | --- |
| 选择器作用域 | canvas 根 `.canvas` 带本组件 scope 属性；`:deep` 祖先选择器可命中远程节点 UMD；要求 `.nodeDisabled` 同时存在，正常节点不命中 |
| 隐藏范围 | 只作用于 `.titleBar .labelText` 与 `.disabledBadge`，图标/删除按钮/内容/端口不动 |
| 无障碍 | 使用 clip 方案而非 `display:none`，名称与「节点已禁用」仍在无障碍树 |
| 按钮位置 | `.nodeActions { margin-left:auto }`，名称移出 flex 流后删除按钮仍贴右 |
| 文档内嵌节点 | `documentTarget` 时 titleBar 不渲染且节点 teleport 出 `.canvas`，不受影响 |
| 设置持久化 | `hideDisabledNodeTitles` 缺键按 false；`updateGeneralSettings` 走既有深监听保存；服务端 settings 保存不裁剪 general 新键 |
| Esc 同事件关闭 | `handleCanvasEscape` 在 window 捕获阶段 `stopPropagation`，document 上的 ElDialog Escape 监听收不到；有选区/输入框/浮层分支在之前 return，不受影响 |
| 第二次 Esc | 确认框打开后目标在 `.el-overlay` 或 `hasVisibleOverlay()` 为真，提前 return 不截断，ElDialog 正常关闭 |
| 两段式 Esc | 有选区时第一次 Esc 清选区（已在 stopPropagation 之前 return），第二次才打开确认框 |
| 无测试文件 | 工作区无新增 `.test.ts` / `.spec.ts` / `check*.ts` |

## 5. 代码审查（子 Agent）

第一轮结论：**需修订**（无 P0；1 条 P1 + 3 条 P2）。审查方还用 `@vue/compiler-sfc` 编译了 scoped 样式，并在 Chromium 最小复现页实测了 Esc 时序：不加 stopPropagation 会复现「打开后同事件关闭」，加后保持打开；第二次 Esc 正常关闭。

| 级别 | 问题 | 处置 |
| --- | --- | --- |
| P1-1 | 认为节点 UMD 未重建/同步（依据是仓库 `data/nodes` dev 目录） | 安装后的运行期目录已由 `deploy-local.sh --build` 更新：11 个内置节点含新标题提示，三处 md5 一致；仓库 `data/nodes` 是 dev 目录，不影响安装应用 |
| P2-1 | 隐藏名称后删除按钮左移 | 改为 clip 隐藏 + `.nodeActions { margin-left:auto }` |
| P2-2 | `display:none` 让名称/状态从无障碍树消失 | clip 方案保留可访问文本 |
| P2-3 | 工具条 aria-label 恒为「隐藏…」 | 改为「显示或隐藏禁用节点标题」 |
| 其他 | 注释可补充微任务检查点原因 | 现有注释已说明结论，保持简洁 |

第二轮复核：**通过**。复核方独立核验了运行期 11 个内置节点 UMD 的时间戳、标记与三处 md5，确认 P1-1 关闭；P2-1/P2-2/P2-3 与纯 CSS 注释均核实解决；Esc 修复维持「实测成立」。复核后只追加了一处不阻塞建议：给 clip 规则补 `pointer-events:none`，已补并重新构建部署（web md5 见上）；另确认仓库 dev 的 `data/nodes` 仍是旧包，`bun run dev` 前需先 `bun run dev:plugins`，不影响已安装应用。

## 6. 已知边界

- 运行期还有 5 个第三方旧节点（depthCaptureNode、execNode、imageResizeNode、videoPostNode、webEpisodeEditorProNode）不在本仓库、包内没有 `.nodeDisabled`，不参与本次标题隐藏；它们同样没有当前的禁用外观。内置 11 个节点全部覆盖。

## 7. 待人工验证

需用户重启应用后执行：

1. 左下角工具条点击「隐藏禁用节点标题」：禁用节点的名称和「已禁用」徽标消失，图标和删除按钮仍在、按钮贴右。
2. 关闭开关恢复显示；切换项目/重启后状态保持。
3. 开启时鼠标停在禁用节点标题栏，能看到「名称（节点已禁用）」tooltip。
4. 正常节点、文档面板内嵌节点标题不受影响。
5. 画布无选区按 Esc：退出确认框出现并保持；再按 Esc 关闭。
6. 有选区按 Esc：只清选区；再按 Esc 打开确认框。
7. 输入框、Agent 面板、其他弹层内的 Esc 行为不变。
