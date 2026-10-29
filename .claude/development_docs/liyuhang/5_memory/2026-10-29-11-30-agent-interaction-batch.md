# 记忆：Agent 交互六项改造

- 记录时间：2026-10-29 11:30

## S 情境

用户报「Agent 对话框没有模型下拉」，同时提出语音按钮可关闭、Agent 节点可引用、节点面板草稿丢失、/goal 指令循环、生成中可编辑并排队/打断发送。

## T 任务

六项一起交付，且不能靠猜：能实测的先实测定位根因。

## A 行动

**根因定位（R1）**：先把运行中的应用挂到 Chrome，直接读 DOM —— `.senderActions` 首节点是注释、`.modelPopover` 计数 0。对照源码发现 `conversation.vue` 的 `showModelPicker` / `acceptPending` / `autoFocus` 是未给默认值的 Boolean prop，Vue 对缺省 Boolean prop 强制 `false`，导致三处"默认开启"的能力同时静默失效。用 `withDefaults` 显式给 true。

**语音开关（R2）**：`allowVoiceInput` 写进 mediaGeneration 的 zod schema 与 `configRules`，web 侧 `lib/agentInputSettings.ts` 从 `/api/tools/get` 读并缓存，`pluginConfigDialog` 保存后派发 `toonflow:tool-config-updated`；关闭时同时拦按钮与长按手势（`useVoiceInput` 增加 `enabled` 门禁）。另外发现 `deploy-local.sh` 从不安装内置工具，导致改工具 schema 只有完整打包才生效，已补「安装内置工具（Resources）」。

**Agent 节点引用（R3）**：`createNodeMention` 增加 `extraValue` 钩子，`storedNodeMention` 注入 `agentNodeMention()`：读 `node.data.agentSessionFile` → 只读会话文件末尾 2 MB → 提取最近 assistant 文本（800 字）+ 正则候选路径逐个 stat 校验（≤50 条）。mention 值多出 `agent: { sessionFile, summary, files }`，NODE 类型 value 本就允许任意有界 JSON，无需改 schema；只补了提示词说明。

**草稿保留（R4）**：`messageInput.hasDraft()` → `conversation` 透传 → `agentNodePanel.unmountIfIdle()` 有草稿就不卸载 entry（面板是 `v-show`，实例还在）。无草稿时保持原回收逻辑。

**/goal（R5）**：目标落 `.agent/goals/<sessionFile>.json`；输入以 `/` 开头由 `handleCommand` 消费（`/compact`、`/goal`、`stop`、`reset`、`off|none|cancel`、`help`）；每轮 `finally` 里判 `[[GOAL:DONE]]` 标记，未达成自动发下一轮（默认上限 10）；会话激活 1.5s 后若目标仍在 active 且空闲则补跑一次，用户暂停后不再自动拉起。

**编辑与队列（R6）**：`locked` 去掉 busy，输入框不再禁用；生成中给「入队 / 立即发送（打断）/ 停止」三按钮；`sendMessage(source, queued?)` 支持从队列负载发送；`finally` 单点调度优先级 打断 > 队列 > 目标；打断后立刻发送可能撞 409，按 300/600/900ms 退避重试。

## R 结果

- web/server typecheck 通过；`deploy-local.sh --build` 成功；内置工具首次随部署安装。
- 运行中实测：模型按钮从 0 → 2（两个面板各一），文本 `deepseek-v4.1-flash · 默认`；语音按钮 2 个受开关控制。
- 产物核对：workspace chunk 含 `queueButton`、`待发送`、`GOAL:DONE`；工具包含 `allowVoiceInput`。

## 关键坑

- **Vue Boolean prop 缺省即 false**：所有"默认开"的布尔 prop 必须给 `default: true`，否则功能静默消失且无报错。
- 部署脚本漏装 `build/tools`：工具 schema 改动在本地部署里永远不生效。
- `useVoiceInput` 的 `voiceSupported` 是普通布尔不是 ref，模板里误写 `.value` 会直接编译报错。
- 目标循环的所有自动续跑都必须有"上限 + 可暂停 + 只在空闲时触发"三重门禁，否则会自激。
