# 记忆：图片生成节点接入「缩放」

- 时间：2026-11-15 14:25
- 类型：功能补齐（两个图片节点能力对齐）

## STAR

**Situation（背景）**
用户发现图片生成节点没有「缩放」，普通图片节点有；两个节点其余图片工具（裁剪、调整、全景图、打光、多角度、宫格切分）都对齐，只有缩放缺失。

**Task（任务）**
在不复制组件的前提下，把图片节点的缩放完整接到图片生成节点，行为一致、可恢复一次。

**Action（行动）**
- `@toonflow/node-image` 新增 `./imageScale` 导出，生成节点直接复用 `imageScale.vue`。
- 工具栏「调整」后新增「缩放」；新增 `node.data.scale` 状态、`handleScaleApplied/Restore`、`clearScaleHistory`。
- 生成成功、替换图片、选择历史时清空缩放恢复记录；应用前用 `fromUrl`、恢复前用 `appliedUrl` 双重校验。
- 与生成/上传/裁剪/调整/打光/多角度/全景/宫格/删除全互斥；删除前 `scale.cancel()`。
- 子 agent 评审 1 P1 + 2 P2：发送按钮与 `startGeneration()` 漏 `scaling`、替换与面板入口守卫缺 `scaling`，已全部补齐。
- typecheck 通过、`vite build` 成功，备份后同步 `data/nodes` 与内置节点目录。

**Result（结果）**
生成节点工具栏出现「缩放」，弹层在现有项目实测可打开（2560×1440）；真实应用/恢复待用户验收。

## 关键经验

1. 两个图片节点共用 `@toonflow/node-image` 的组件，但导出表要显式添加才能跨节点复用；只加源码 import 会在构建时解析失败。
2. 「按钮 disabled」不等于互斥：Agent 工具、快捷键、已打开的文件选择框都能绕过 DOM，运行期守卫必须独立补 `scaling`。
3. 共用输出的所有改写入口（生成成功、替换、选历史）都要清缩放恢复记录；恢复前校验 `current.url === appliedUrl` 是最后一道兜底。
