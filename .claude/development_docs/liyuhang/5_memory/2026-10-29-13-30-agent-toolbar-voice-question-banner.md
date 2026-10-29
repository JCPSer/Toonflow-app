# 记忆：Agent 输入工具条布局 + Agent 提问横幅

- 记录时间：2026-10-29 13:30

## S 情境

用户截图反映画布 Agent 节点面板底部输入工具条"太挤"，模型名与图标叠字；同时说语音按钮"没有地方取消（我没找到）"——开关实际存在，但埋在「插件市场 → 媒体生成」的配置弹窗里。另外提出：Agent 节点用 `askUser` 提问时用户看不到，需要在画布顶部有提示、可跳转、多条合并、激活即消失。

## T 任务

两件事：一是修工具条布局并让语音开关可发现；二是把 `askUser` 提问提升到画布层可见。

## A 行动

**叠字根因**：`.senderActions` 里模型按钮 `flex:1` 且 `min-width:0` 无下限，其余按钮 `flex-shrink:0`；空间不足时模型按钮被压到 0 宽，文字溢出盖住后面的图标。三层修法：面板 380→440、`.modelPopover` 给 96px 下限、按测量结果把「语音 + 上下文环」折叠进「⋯」。

**折叠踩的坑**：第一版做了两级折叠（环 → 语音）。实测每次折叠都会插入 28px 的「⋯」按钮，正好抵消隐藏上下文环省下的 24px，于是量到"还是放不下"，直接跳到最紧状态。改成单级折叠 + 12px 滞回（展开阈值 144 / 折叠阈值 132），并用重入锁 + 最多两步迭代防抖。

**语音开关迁移**：从 `mediaGeneration` 工具配置搬到 `settings.general.voiceInputEnabled`，`agentInputSettings` 从异步读接口改成 `computed`。工具侧 `configRules` 删掉 switch，但 `configSchema` 保留 `allowVoiceInput` ——`z.strictObject` 会拒绝未声明键，直接删字段等于让存过该键的用户配置校验失败。

**提问横幅**：`conversation` 新增 `question` / `questionEnd` 两个 emit；`agentNodePanel` 聚合成 `questionNotices` 上报画布；画布渲染贴顶横幅，点击 `fitView` + `open`。已读在 `open()` 里一次收口，所以从横幅点、点节点、点 @ 三条路径行为一致。

## R 结果

- typecheck 通过（仅历史错误）；3 次构建部署成功。
- 实测各宽度均无溢出：440/420/380 不折叠，340 折叠，300 折叠+折行，`scrollWidth` 恒等于 `clientWidth`。
- 设置 → 常规配置 新增开关，关闭后按钮 1→0、`/api/settings/get` 的 `general.voiceInputEnabled=false`，重开恢复。
- 提问横幅未做端到端手测：生产构建无 `__vueParentComponent`，无法注入假数据；真实触发要在用户会话里跑一轮 `askUser`。已留手测清单。

## 关键坑

- **折叠本身要占位置**：把 N 个按钮收进一个菜单按钮时，先算净收益（省下的宽度 − 菜单按钮宽度），否则第一级折叠可能是零收益或负收益，表现为"折了也没用，直接跳到最紧"。
- **测量驱动布局必须有滞回**：折叠会改变测量结果，单阈值会在临界宽度来回抖。
- **隐藏态的尺寸不能当真**：面板 `display:none` 时 `clientWidth=0`，测量必然判定"放不下"。这里靠 `ResizeObserver` 在重新显示时重测自愈，不给隐藏态单独分支。
- **`z.strictObject` 的字段不能直接删**：删掉一个已有字段和删掉一个 UI 开关是两件事，后者安全、前者会打挂旧配置。
