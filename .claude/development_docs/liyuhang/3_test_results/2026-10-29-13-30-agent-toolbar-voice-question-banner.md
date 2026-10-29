# 测试结果：Agent 输入工具条布局 + Agent 提问横幅

- 记录时间：2026-10-29 13:30
- 关联：`1_requirements_matrix/2026-10-29-13-30-agent-toolbar-voice-question-banner.md`、`2_requirements_solutions/2026-10-29-13-30-agent-toolbar-voice-question-banner.md`

## 一、静态验证

| 项 | 结果 |
| --- | --- |
| `apps/web typecheck` | 仅既有 `server/.../singleAgent/types.ts(2,33)` 历史错误 |
| `deploy-local.sh --build` | 成功（3 次：初版 / 折叠逻辑重写 / 阈值微调） |
| 产物核对 | `workspace-*.js` 含「个 Agent 正在等你回答」，`workspace-*.css` 含 `agentQuestionBanner`，`general-*.js` 含「语音输入按钮」 |

## 二、运行中实测（Chrome 直连本地应用，画布 Agent4-1 节点面板）

面板宽度由 `PANEL_MAX_WIDTH` 撑到 440，测量 `.senderActions` 的 `clientWidth / scrollWidth / 高度 / 模型按钮宽度`：

| 面板宽 | 内容宽 | 高度 | scroll−client | 模型按钮 | 状态 |
| --- | --- | --- | --- | --- | --- |
| 440（默认） | 412 | 42 | 0 | 194 | 未折叠，语音+上下文环都在 |
| 420 | 392 | 42 | 0 | 174 | 未折叠 |
| 380 | 352 | 42 | 0 | 134 | 未折叠 |
| 340 | 312 | 42 | 0 | 124 | 折叠为「⋯」 |
| 300 | 272 | 78 | 0 | 124 | 折叠 + 折行，仍不溢出 |

结论：任何宽度下 `scrollWidth ≤ clientWidth`（无溢出叠字）；模型名文本 `deepseek-v4.1-flash · 默认` 始终完整或省略显示。

修复前对照：380px 面板下模型按钮被压到 0 宽，图标与模型文字重叠在回形针位置上（用户截图）。

## 三、折叠菜单

窄宽度下点「⋯」：`.agentToolbarMorePopover` 文本 = 「语音输入上下文用量暂无数据」（本会话无用量数据），此时 `.voiceButton` / `.contextButton` 均为 0 个，符合"收入菜单但能力不丢"。

## 四、语音开关（端到端）

| 步骤 | 结果 |
| --- | --- |
| 打开 设置 → 常规配置 | 出现「语音输入按钮」开关，默认 checked=true，同排标题：启动动画 / 语音输入按钮 / 画布合成优化 / 节点连线动画 / 节点连线高亮颜色 |
| 关闭开关 | 画布 Agent 面板 `.voiceButton` 1 → 0；`/api/settings/get` 返回 `general.voiceInputEnabled=false` |
| 重新打开 | `.voiceButton` 0 → 1 |

迁移兼容：`packages/tools/mediaGeneration` 的 `configSchema` 仍声明 `allowVoiceInput`（不读取），旧配置含该键可通过 `strictObject` 校验；`configRules` 已移除该 switch，插件配置弹窗不再出现第二个开关。

## 五、提问横幅

- 已核对：`conversation.vue` emit 名单（`question` / `questionEnd`）与 `agentNodePanel` 的 `@question` / `@questionEnd` 监听一一对应；面板 `questions` → 画布 `@questions` 对应。
- 横幅模板与样式已进入产物（js + css 各命中 1 处），`.canvas` 增加 `position: relative` 供绝对定位。
- **未做端到端手测**：生产构建不暴露 `__vueParentComponent`，无法注入假数据；而真实触发需要在用户的 Agent 会话里跑一轮 `askUser`，会污染该会话消息。留作手测项（见第六节）。

## 六、待手测清单

1. 让某个 Agent 节点调用 `askUser` 提问 → 画布顶部出现横幅；关掉面板再看，横幅仍在。
2. 同一次提问期间保持面板打开（画布在前台）→ 不应出现横幅（已在视线内）。
3. 点横幅某一行 → 视图移动到该节点并打开面板，该行立即消失。
4. 两个节点同时提问 → 横幅合并两行，逐条消失。
5. 提问未回答就中断生成 → 横幅不残留。
6. 删掉正在提问的节点 → 对应行消失。
