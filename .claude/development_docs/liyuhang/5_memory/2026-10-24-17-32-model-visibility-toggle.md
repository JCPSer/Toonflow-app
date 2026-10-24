# 模型显示/隐藏开关（STAR）

## Situation

设置里「文本模型 / 媒体模型」动辄几十个模型（中转站一次「获取模型」全量拉回），用不到的只能删——删了以后要用得重新拉取，手改的标签和推理档位也一起丢；不删则长期占着画布节点的模型下拉框。

## Task

加一套「不删只隐藏」的机制：供应商与模型各自可隐藏，供应商优先；隐藏的不出现在画布节点下拉与智能体模型选择器，但要保留已选中项的可见性（标注「已隐藏」），不能把旧项目弄失效。

## Action

1. **存储旁路**：新增 `settings.modelsHidden`，按 `language` / `media` 分桶（两个 tfRouter 同 id，不能扁平存）。不改 `customProviders[].models[]`，也不往 `mediaProviderConfigs` 里塞字段——后者会被原样传给媒体插件运行时。
2. **服务端**：新增 `utils/ai/visibility.ts` 提供读取与清理；`listAiModels()` / `listMediaModels()` 给每个模型追加 `hidden` 布尔（供应商隐藏 ⇒ 全部 hidden）。列表**不裁剪**，保证已保存的节点仍能按 id 解析。
3. **节点侧收口**：`groupNodeModels(models, selected?)` 统一过滤＋对保留的隐藏项把 label 改成「（已隐藏）」；8 处调用点各传入当前选中值（textNode / imageGenerationNode / videoGenerationNode / audioGenerationNode / imageVariationGenerator / director3dPanel / frameAnalysisNode / nodeError）。默认模型改 `find(item => !item.hidden)`。
4. **智能体选择器**：`modelChoices` 保持全量（查表用）但带 `hidden`；`modelPopover` 用 `visibleLanguageProviders` 过滤选项、按钮标签标注、默认项跳过隐藏。
5. **设置 UI**：供应商卡片加「在节点中显示」开关（即时保存）+ 计数「已隐藏 N / 全部」；文本模型行与媒体模型卡片各加开关（即时保存）。删除供应商、供应商改名时清理隐藏记录。
6. **缓存**：`setProviderHidden` / `setModelHidden` 保存后显式 `invalidateNodeModels(kind)`。

## Result

- 供应商隐藏、模型隐藏、供应商优先三条规则在服务端与前端一致；被引用的隐藏模型仍可选、可运行、带标记。
- 隐藏状态按 id 旁路保存，`获取模型` 重新拉取后自然保留。
- 类型检查（server / web / nodeShared / nodeScaffold / 7 个节点包）全通过；dev 环境实测供应商与模型两级开关、计数、选择器过滤、默认项跳过均符合预期。
- 已重建 web、8 个节点 UMD、桌面主进程 bundle，重打包 `/Applications/toonflow-exec.app`（旧包 `/tmp/toonflow-exec-old6.app`）。
- 已知边界：隐藏只是展示语义，不是禁用；智能体工具仍可调用隐藏模型。模型 ID 改名后旧隐藏记录会残留（不影响功能）。
