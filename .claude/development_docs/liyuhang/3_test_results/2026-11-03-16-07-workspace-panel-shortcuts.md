# 测试结果：项目/画布下拉与素材库面板快捷键

- 时间：2026-11-03 16:07（16:14 部署）
- 对应：`../1_requirements_matrix/2026-11-03-16-07-workspace-panel-shortcuts.md`、`../2_requirements_solutions/2026-11-03-16-07-workspace-panel-shortcuts.md`

## 1. 自动化

| 项目 | 结果 |
| --- | --- |
| `bun test src/lib/canvasShortcuts.test.ts` | 11 pass / 0 fail（新增 2 个用例：默认键与可改键、与现有默认键不冲突） |
| `bun test`（apps/web 全量） | 45 pass / 0 fail |
| `bun run typecheck`（vue-tsc） | 仅剩既有的 `server/.../types.ts` 找不到 `@/agentRuntime`（历史遗留，与本次无关） |
| `bun run build`（apps/web） | 成功；已 `rsync -a --delete` 到 `/Applications/toonflow-exec.app/Contents/Resources/app/views/mainview/` |

## 2. 代码评审（子 agent）

- P0：抢焦点导致「再按关闭/互斥切换」失效 → 已按用户选择改为**不抢焦点**，下拉打开后焦点留在画布；验收标准同步修改。
- P1：
  - `None` 语义不适用普通动作 → 文档改为「留空取消绑定」，测试改为断言空绑定不命中。
  - 模态遮罩下 Q/W 仍可触发 → 画布派发增加 `.el-overlay` 可见性判断；下拉浮层（`.el-popper`）不算，保证同键可收起。
  - 项目加载中 Q/W 仍生效 → `canvasMenu` 的两个 toggle 增加 `projectLoadingVisible` 判断。
  - 点过按钮后焦点在 button 上导致 Q/W 失效 → 这两个键只让位给文本类控件。
  - repeat 漏键 → E 与画布派发都在 `preventDefault` 之后吞掉 repeat。
- P2：设置项标题仍叫「画布快捷键」但含工作区级的素材库 → 保留（三个键在同一处改更直观），标签写明「素材库面板」。

## 2.5 追加：设置面板 ⌘,

- 单测：`canvasShortcuts.test.ts` 增加平台主修饰键 + Comma 命中、裸逗号不命中、多按 Shift 不命中（12 pass）。
- web 全量：46 pass / 0 fail；`vue-tsc` 仍只剩既有 `@/agentRuntime`。
- web 已重新构建并同步到应用 `views/mainview`（19:16）。

## 3. 待人工验证（需重启应用）

1. 画布视图按 Q：项目下拉展开（焦点仍在画布）；再按 Q 收起。
2. 画布视图按 W：画布下拉展开；再按 W 收起；Q 打开时按 W → Q 收起、W 展开。
3. 画布 / 文档视图按 E：素材库打开；再按 E 关闭。
4. 便签正文、节点搜索框、项目/画布下拉的搜索框、聊天气泡输入框里按 Q/W/E：只输入字符，不触发面板。
5. 设置页打开时、对话框打开时按 Q/W/E：不触发。
6. 设置 → 通用 → 画布快捷键：三项默认显示 Q/W/E，可改键、可清空；与其他项冲突时提示。
7. 点过画布顶部下拉按钮后（焦点在 button 上）直接按 Q/W：仍可打开。
8. 首页与工作区按 ⌘,：设置打开，再按关闭；打开着分享/导入等其它对话框时按 ⌘, 不抢。

## 4. 已知边界

1. 下拉打开后焦点留在画布，想筛选需再点一次搜索框（用户选型：开关优先）。
2. 文档视图没有项目/画布下拉，按 Q/W 无效（预期）。
3. 三个键都允许被用户改成同一按键：现有冲突检测只提示，不阻止保存，行为按派发顺序取第一个命中。
