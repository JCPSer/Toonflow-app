# 需求方案：模型显示/隐藏开关

对应需求：`1_requirements_matrix/2026-10-24-16-47-model-visibility-toggle.md`

## 一、总体思路

隐藏状态是**旁路数据**，不进任何供应商或模型对象：

- 存 `settings.modelsHidden`，四项字符串/字符串数组，缺省即全部可见。
- 服务端在拼模型列表时算出一个 `hidden` 布尔量随模型下发（供应商隐藏 ⇒ 其下全部模型 hidden）。
- 客户端只做一件事：**列表渲染时过滤 hidden，但保留当前选中项并标注**。
- 运行链路（`getConfiguredModel`、媒体生成）完全不看可见性，隐藏的模型仍可被已保存的任务调用。

## 二、数据模型

```
settings.modelsHidden = {
  providers?: { language?: string[], media?: string[] },   // 整个供应商隐藏
  models?:    { language?: Record<providerId, string[]>,    // 模型 id 列表
                media?:    Record<providerId, string[]> }
}
```

- 缺省 / 空数组 / 不存在的 providerId 一律视为「无隐藏」。
- 删除供应商时顺带清理该 provider 的两处记录，避免以后同名供应商复活时带出旧隐藏。
- 模型被删除再添加会继承旧的隐藏记录（按 id），可接受，写入文档。

为什么不用「模型对象上加 hidden 字段」：

1. 媒体供应商的 `mediaProviderConfigs[providerId]` 会被**原样传给插件运行时**（`loadMediaProviderSource(source, record(configurations[id]))`），加自定义字段有污染请求参数的风险。
2. 媒体模型实体存在 `providers/*.json`，「获取模型」整体覆盖；模型对象上的字段必须额外做合并。旁路存储天然免疫。
3. 文本与媒体共用一套读写与清理逻辑。

## 三、服务端

新增 `apps/server/src/utils/ai/visibility.ts`（纯函数，无副作用）：

```
readModelsHidden(): ModelsHidden            // conf 读 settings.modelsHidden，做一次形状校验
providerHidden(kind, providerId): boolean
modelHidden(kind, providerId, modelId): boolean
```

改动两处列表接口：

- `utils/ai/index.ts` `listAiModels()`：每个模型输出追加 `hidden: providerHidden("language", p.id) || modelHidden("language", p.id, m.id)`。
- `utils/media/generation.ts` `listMediaModels()`：同理，`kind = "media"`。

不改 `getConfiguredModel` / `configuredProvider`：隐藏只影响「可选范围」，不影响「能否运行」。

## 四、客户端过滤（节点）

`packages/nodeScaffold/src/nodeAi.ts`：`NodeAiModel` 增加 `hidden?: boolean`；`NodeMediaModel` 增加 `hidden?: boolean`。

`packages/nodeShared/src/groupNodeModels.ts` 升级为唯一收口点：

```
groupNodeModels(models, selected?)
  key(model) = JSON.stringify([providerId, modelId])
  保留条件： !model.hidden || key(model) === selected
  对保留下来的 hidden 模型：label 追加「（已隐藏）」
  分组与排序逻辑不变（tfRouter 置顶）
```

8 处调用点各传当前选中值（JSON 字符串形式）：

| 文件 | 选中值 |
| --- | --- |
| `nodes/textNode/src/index.vue` | `model` |
| `nodes/imageGenerationNode/src/index.vue` | `data.model` |
| `nodes/videoGenerationNode/src/index.vue` | `data.model` |
| `nodes/audioGenerationNode/src/index.vue` | `data.model` |
| `nodes/imageNode/src/components/imageVariationGenerator.vue` | 组件内选中 ref |
| `nodes/director3dNode/src/index.vue` + `directorPanel.vue` | props 传入 |
| `nodes/frameAnalysisNode/src/index.vue` | 组件内选中 ref |
| `nodeShared/src/components/nodeError.vue` | 组件内选中 ref |

模板不改：`:label="item.label"` 直接吃到追加后的标签。

## 五、客户端过滤（智能体 / 对话选择器）

`apps/web/src/components/modelPopover.vue` 里 `modelGroups`（当前取自 `customProviders`）改为走新的
`apps/web/src/lib/modelVisibility.ts`：

```
visibleProviders(selected?) => 过滤 provider.hidden 与 model.hidden，保留 selected 并追加「（已隐藏）」
```

`modelChoices`（`stores/settings.ts`）保持**不过滤**——它被 `singleAgentDialog`、`conversation`、`a2aSettingsDialog` 用来查表取 label/contextWindow，过滤会让已选中的隐藏模型丢掉标签。

## 六、设置页 UI

### 6.1 供应商卡片（`languageModel/index.vue`、`mediaModel/index.vue`）

```
┌──────────────────────────────────────────────────────┐
│ [logo]  供应商名  [官方]              [在节点中显示 ◉] │   ← 新增开关（footer 右侧、操作按钮之前）
│         供应商 id                                     │
├──────────────────────────────────────────────────────┤
│ [v1.2]  12 个模型 · 已隐藏 3           编辑  删除      │
└──────────────────────────────────────────────────────┘
```

- 开关 `el-switch size="small"`，即时保存（`setProviderHidden`）。
- 隐藏态：卡片 `.is-hidden`（`opacity: .55`）+ 标题右侧 `已隐藏` 标签；计数改为 `已隐藏 全部`。
- 计数文案只在有隐藏模型时追加「· 已隐藏 N」。

### 6.2 文本模型行（`languageModel/addCustomProviderDialog.vue`）

模型行在 ID、显示名称、展开、删除之间插入开关：

```
[模型 ID] [显示名称] [显示 ◉] [展开] [删除]
```

- 即时保存，不等「保存」按钮；`id` 为空（新加未填）时开关禁用。
- 开关状态来自 `settings.modelsHidden`，与模型对象无关，因此「获取模型」重新拉取后保持。

### 6.3 媒体模型卡片（`mediaModel/editProviderDialog.vue`）

模型卡片右上操作区加开关，位于「编辑 / 删除」之前：

```
┌───────────────────────────────────────────┐
│ [icon] 模型名          [在节点中显示 ◉] 编辑 删除 │
│        model-id                           │
│ [视频] [文生视频] [首尾帧]                  │
└───────────────────────────────────────────┘
```

- 开关即时生效并立即写盘，与底部「保存」（负责模型数据本身）互不干扰；因此点「取消」不会回滚已切换的显示状态，这是有意为之：隐藏状态独立于模型数据。
- 隐藏态卡片加 `已隐藏` 标签。
- 供应商整体隐藏时，开关置灰并提示先在供应商列表打开显示；计数显示「已隐藏 全部」。

### 6.4 视觉与可访问性

- 开关统一带 `aria-label`（`在节点中显示 ${供应商名}` / `在节点中显示 ${模型名}`）。
- 隐藏卡片只降透明度，不禁用编辑/删除。

## 七、缓存与刷新

`saveSettings` 对 `modelsHidden` 的 patch 不会自动失效模型缓存，因此在两个 setter 里显式调用：

```
setProviderHidden / setModelHidden 保存后 → invalidateNodeModels(kind)
```

文本侧本来就会因 `customProviders` 变化失效，这里补上自己的一份，避免依赖别处逻辑。

## 八、改动清单

| # | 文件 | 改动 |
| --- | --- | --- |
| 1 | `apps/server/src/utils/ai/visibility.ts` | 新增：读 settings.modelsHidden + 三个查询函数 |
| 2 | `apps/server/src/utils/ai/index.ts` | `listAiModels` 输出 `hidden` |
| 3 | `apps/server/src/utils/media/generation.ts` | `listMediaModels` 输出 `hidden` |
| 4 | `packages/nodeScaffold/src/nodeAi.ts` | 类型加 `hidden?` |
| 5 | `packages/nodeShared/src/groupNodeModels.ts` | 过滤 + 保留选中 + 标注 |
| 6 | 8 个节点调用点 | 传当前选中值 |
| 7 | `apps/web/src/stores/settings.ts` | `modelsHidden` 计算属性、两个 setter、删除供应商时清理 |
| 8 | `apps/web/src/lib/modelVisibility.ts` | 新增：供应商级可见性过滤 |
| 9 | `apps/web/src/components/modelPopover.vue` | 使用过滤后的分组 |
| 10 | `languageModel/index.vue`、`mediaModel/index.vue` | 供应商开关 + 计数 |
| 11 | `languageModel/addCustomProviderDialog.vue`、`mediaModel/editProviderDialog.vue` | 模型开关 |
| 12 | 删除供应商的两个入口 | 清理 `modelsHidden` 残留 |

## 九、构建与交付

1. `bun run --filter '@toonflow/web' build` → `build/web`。
2. 8 个节点包分别 `vite build`，产物 UMD 同步到 `/Applications/data/nodes/`。
3. 桌面主进程 `bun build ../desktop/src/index.ts` 替换 `Resources/app/bun/index.js`。
4. `rsync` 覆盖 `views/mainview`，`codesign --force --deep --sign -` 重签。
5. 备份旧包到 `/tmp`。

## 十、测试方案

| 层 | 用例 |
| --- | --- |
| 服务端 | 造 `modelsHidden` 后 `GET /api/ai/models`、`/api/ai/media/models` 校验 `hidden` 计算；供应商隐藏 ⇒ 其下模型全 hidden |
| 运行链路 | 隐藏某模型后，用该模型的节点仍能生成（`getConfiguredModel` 不受影响） |
| 设置页 | 供应商开关、模型开关即时生效；计数与「已隐藏」标记正确；重新「获取模型」后隐藏仍在 |
| 节点下拉 | 隐藏模型消失；已选中的隐藏模型带「（已隐藏）」；切到其他模型后它消失 |
| 智能体选择器 | 同上规则；`modelChoices` 查表不受影响 |
| 缓存 | 切开关后不刷新页面，下拉立即变化 |

## 十一、评审意见

> 待用户填写

| 评审人 | 结论 | 意见 |
| --- | --- | --- |
| 子 agent（初评） | 通过，按意见修订 | ① 无需改「获取模型」合并点：旁路存储天然按 id 保留，原方案 §R6 的合并描述删除；② `modelsHidden` 必须按 `language`/`media` 分桶（两个 tfRouter 同 id）；③ 增加 `forgetHidden`：媒体删除路由 `provider.ts` 与前端两个删除入口都要清理；④ 默认模型选择与 `modelPopover` 首次选中要跳过隐藏项；⑤ 服务端只下发 `hidden`，不裁剪数组 |
| 用户 | | |

实施时已按上述五点落地；另外补充了「已隐藏计数只统计现存模型」，避免删除模型后残留 id 造成假计数。
