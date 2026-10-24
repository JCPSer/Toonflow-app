# 测试结果：模型显示/隐藏开关

环境：macOS arm64 / Bun / 源码 `Toonflow-app`
服务：`NODE_ENV=dev TOONFLOW_DATA_DIR=/tmp/tf-vis TOONFLOW_SERVER_PORT=3111 bun src/index.ts`
Web：`TOONFLOW_SERVER_PORT=3111 bun run dev`（vite 5173，代理到 3111）
数据：由 `/Applications/data` 复制出的临时目录，模型截断并注入 `settings.modelsHidden`，不触碰真实配置。

## 一、类型检查

| 包 | 命令 | 结果 |
| --- | --- | --- |
| server | `bun run typecheck` | 通过 |
| web | `vue-tsc` | 通过 |
| nodeShared / nodeScaffold | `vue-tsc --noEmit` | 通过 |
| textNode / imageGenerationNode / videoGenerationNode / audioGenerationNode / frameAnalysisNode / imageNode / director3dNode | `vue-tsc --noEmit` | 通过 |

## 二、服务端 `hidden` 计算

构造：`providers.language = ["tfRouter"]`、`models.language["OpenCode-DP"] = ["deepseek-v4.1-flash"]`、`providers.media = ["apiMart"]`。

| # | 用例 | 期望 | 实际 | 结论 |
| --- | --- | --- | --- | --- |
| 1 | `GET /api/ai/models`，供应商隐藏 | tfRouter 全部模型 hidden | 1/1 hidden | 通过 |
| 2 | 模型级隐藏 | 只该模型 hidden | deepseek-v4.1-flash hidden，同供应商 `m-visible` hidden=false | 通过 |
| 3 | `GET /api/ai/media/models`，供应商隐藏 | apiMart 全部 hidden | 11 个 apiMart 模型全 hidden，其他供应商 hidden=false | 通过 |
| 4 | 列表不裁剪 | 隐藏模型仍出现在数组里（保证已保存任务可解析） | 隐藏模型仍在返回中，仅带 hidden 标记 | 通过 |

## 三、设置页 UI（dev 环境，chrome-devtools 驱动）

| # | 用例 | 实际 | 结论 |
| --- | --- | --- | --- |
| 5 | 文本供应商卡片开关 | 显示「在节点中显示」+ 开关；TF-router 关闭后卡片加 `isHidden`，标题出现「已隐藏」标签 | 通过 |
| 6 | 开关持久化 | 切换后 `/tmp/tf-vis/settings.json` 的 `modelsHidden.providers.language` 立即写入 | 通过 |
| 7 | 计数 | OpenCode-DP 显示「2 个模型 · 已隐藏 1」 | 通过 |
| 8 | 文本模型行开关 | 「编辑供应商」抽屉内每个模型行有开关；隐藏的 deepseek 关闭、m-visible 打开 | 通过 |
| 9 | 模型开关持久化 | 切换后写入 `modelsHidden.models.language["OpenCode-DP"]` | 通过 |
| 10 | 媒体供应商开关 | APIMart 关闭后卡片 `isHidden`、开关 off | 通过 |
| 11 | 媒体模型卡片开关 | 「编辑模型」弹窗内卡片开关可用，切换后卡片出现「已隐藏」标签，`models.media["comfyLocalKrea2"]` 写入 `krea2TurboImage`，服务端对应模型 hidden=true | 通过 |
| 12 | 计数忽略残留 id | 数据里有已删除的 `__none__` 残留记录时，卡片仍显示「1 个模型」，不出现假的「已隐藏 1」 | 通过（修复后复测） |

## 四、下拉过滤逻辑

以 dev 页面直接 import 模块验证（等价于节点运行时）：

`groupNodeModels(models)`：
- 默认：hidden 项被丢弃，空供应商分组整组消失，tfRouter 仍置顶。
- 传入 `selected = '["b","m3"]'`：该隐藏模型保留且 label 变为 `模型3（已隐藏）`，其余 hidden 仍消失。

`visibleLanguageProviders(providers, hidden, selected)`（智能体/对话选择器）：
- 无选中：`a` 只剩 M2，供应商 `b` 因整体隐藏整组消失。
- 选中供应商 b 的隐藏模型：`b` 组保留一项 `M3（已隐藏）`。
- 选中模型级隐藏项：`a` 组为 `["M1（已隐藏）","M2"]`。

页面实测：TF-router 供应商隐藏 + deepseek 模型隐藏后，首页模型选择器只剩「可见模型」一项，默认选中项也跳过隐藏模型。

## 五、构建与打包

| 步骤 | 结果 |
| --- | --- |
| `bun run build:nodes` | 9 个 UMD 产物，`build/nodes/textNode.umd.js` 内含「已隐藏」逻辑 |
| `bun run --filter '@toonflow/web' build` | 成功，产物含 `modelVisibility-*.js` |
| 桌面主进程 `bun build ../desktop/src/index.ts …` | 23.4 MB，`modelsHidden` 出现在 bundle 中，产物可再次打包解析 |
| 覆盖 `Resources/app/bun/index.js`、`views/mainview`、`nodes`，同步 `data/nodes` | 完成 |
| `codesign --force --deep --sign -` | 重签成功（adhoc） |
| 旧包备份 | `/tmp/toonflow-exec-old6.app` |

## 未覆盖

- 打包后 app 内的实际点击验证：验证期间 `/Applications/toonflow-exec.app` 正在运行（旧进程），未强行重启用户实例，需用户重启后确认。
- 智能体对话、A2A 面板内的选择器只做了模块级验证与首页选择器实测，未逐一面板点击。
- 媒体「获取模型」重新拉取后的隐藏保留：隐藏状态存旁路、按 id 匹配，逻辑上免疫覆盖，未以真实网络请求复测。

## 六、代码审查后修复

子 agent 审查出 7 条（另 1 条交付提示），按严重度处理：

| 编号 | 问题 | 处理 |
| --- | --- | --- |
| 1 | `modelPopover` 全部隐藏时回退选回隐藏模型 | 去掉回退，全部隐藏时留空，与画布节点一致 |
| 2 | `nodeError` 全隐藏时选择器空、按钮永久禁用，提示语误导 | 改为按可见分组判断（`modelGroups.length`），空态提示「没有可用的文本模型，请在设置中取消隐藏」 |
| 3 | 媒体弹窗内开关即时保存与「取消」语义冲突，文档与实现不一致 | 明确为即时生效、不回滚；需求与方案文档同步改写 |
| 4 | 供应商隐藏时计数显示「已隐藏 0」 | 供应商隐藏改显示「已隐藏 全部」 |
| 5 | 供应商/模型 ID 改名后隐藏记录成孤儿 | 文本供应商改名时清理旧记录（`forgetProviderHidden`）；模型 ID 改名残留接受并已在方案注明 |
| 6 | `readModelsHidden` 直接强转未清洗 | 增加 `stringRecord` 清洗 |
| 7 | 隐藏仅为展示语义，智能体工具仍可调用 | 方案文档明确写出，避免被误当禁用/权限 |
| 交付 | `build/nodes` 需重建才生效 | 已重建 8 个 UMD 并同步到 app 与 `data/nodes` |

修复后重跑 server / web / nodeShared 类型检查，全部通过；重新构建并重打包 `/Applications/toonflow-exec.app`。
