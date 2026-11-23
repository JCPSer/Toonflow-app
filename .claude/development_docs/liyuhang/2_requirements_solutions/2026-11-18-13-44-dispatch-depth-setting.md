# 需求方案：Agent 任务链上限开放为开发者设置

- 时间：2026-11-18 13:44
- 关联需求矩阵：`1_requirements_matrix/2026-11-18-13-41-dispatch-depth-setting.md`

## 方案总览

设置存在 `settings.developer.dispatchMaxDepth`，默认 8、范围 1–32。服务端每次派发读取一次，画布 dispatcher 每次入队读取一次，两端共用同一钳制函数（服务端）与同一默认值（web 侧常量），避免出现两套上限。

## 详细设计

### 1. 共享钳制（服务端）

新增 `apps/server/src/agent/runtime/dispatchLimits.ts`：

```
DEFAULT = 8, MIN = 1, MAX = 32
normalize(value) = 有限数 ? clamp(round(value), 1, 32) : DEFAULT
```

`getAgentPreferences()` 增加 `dispatchMaxDepth: normalize(developer.dispatchMaxDepth)`，与其他开发者设置同源读取。

### 2. 服务端生效

- `AgentDispatchContext` 增加可选 `maxDepth`；runtime 在构造派发上下文时写入 `getAgentPreferences().dispatchMaxDepth`。
- `sendToAgent` 用 `context.maxDepth ?? DEFAULT` 判断，拒绝文案带上实际值；结果回传逻辑不变。
- 移除写死的 `MAX_DISPATCH_DEPTH` 导出，测试改用共享常量/自定义上下文。

伪代码：

```
dispatchContext.maxDepth = preferences.dispatchMaxDepth
execute():
  limit = context.maxDepth ?? DEFAULT
  if (context.depth >= limit) throw `任务链路已达到 ${limit} 跳上限，不能再派发`
```

### 3. 画布生效

- `createAgentDispatcher` 选项增加 `maxDepth?: () => number`，`enqueueFromEvent` 每次读取；未提供时用 8。
- `canvas/index.vue` 从 `developerSettings.dispatchMaxDepth` 传入。
- 设置存储 `developerSettings` 增加 `dispatchMaxDepth`（1–32，缺省 8），与 `agentFullAccess` 同源。

### 4. 设置页 UI

在「开发者选项」里、上下文设置之后新增一段「派发」：

```
派发
  控制 Agent 之间的任务链深度，保存后下一条消息生效。
  任务链上限                                  [ 8 ] 跳
  有未保存的修改                      [保存派发设置]
```

- 复用现有 `contextSection / contextRow / contextFooter` 样式，保持表单外观一致。
- 输入用 `el-input-number`，`:min="1" :max="32" :step="1"`；保存时再钳制一次，成功 `ElMessage.success`，失败沿用统一错误提示。
- 文案说明「一条派发链最多经过多少个 Agent；越大越难追踪，结果回传不增加深度」。

### 5. 测试

- `dispatchLimits` 纯函数：默认、0/负数、超上限、小数取整、NaN/非数字。
- `sendToAgent`：默认上限拒绝；自定义 `maxDepth: 3` 时 depth 3 拒绝、depth 2 通过；错误文案包含 3。
- 服务端全量单测 + typecheck；web typecheck（仅既有基线）+ build。

### 6. 部署

- 服务端与 web 都有改动：`build:desktop` 取内层 tar 的 `app/bun/index.js` 覆盖入口；`build/web` 同步 `views/mainview`；两者各自备份。
- 不动 `nodes`、`tools`、`data`、`version.json`；不重启应用，由用户退出重开。

## 风险与回滚

- 上限调到 32 时链路更长，成本与等待时间上升；文案已提示，仍由用户决定。
- 回滚：删除设置项读取、还原两处常量即可；运行时文件用 `.bak-<time>` 还原。

## 实施修订（评审后）

1. **P0 路由硬边界**：新增 `agent/dispatchDepthSchema.ts`，`max` 改用 `MAX_DISPATCH_MAX_DEPTH`（32）；路由引用该 schema，不再写死 8。补 schema 单测（0/8/32 通过，-1/33/1.5/字符串拒绝）。
2. **P1-1 保存钳制**：设置页保存改用统一的 `normalizeDispatchMaxDepth`（0 → 1、空值/非数字 → 8），不再用 `||` 回退上次值；输入框的 min/max 也绑定共享常量。
3. **P1-2 口径一致**：`agentDispatch` 事件新增可选 `maxDepth`，`sendToAgent` 把本次生效上限随事件下发；画布优先使用事件值，老服务端/手工事件才回退本地设置，避免「服务端已受理、画布按新值丢弃」。
4. **P1-3 多端**：当前仅保证同一服务端读值与事件快照一致；其他已打开客户端仍需刷新后读取新设置，已写入文案与已知边界。
5. **P1-4 测试**：补路由 schema、事件携带上限、画布以事件上限为准三组用例。
6. **P2 常量收敛**：`apps/server/package.json` 增加 `./agent/dispatchLimits` 导出，web 的 store、设置页、dispatcher 全部从同一模块取值；删除名不副实的 `MAX_DISPATCH_DEPTH` 别名，测试改用 `DEFAULT_DISPATCH_MAX_DEPTH`；画布侧再做一次 normalize 兜底。
7. **未做**：设置保存路由未额外清洗原始 JSON（读取时已 normalize，行为安全）；`AgentDispatchContext.maxDepth` 保持可选以兼容旧调用点。

## 部署提示

服务端与 web 必须同批部署：新 web + 旧 server 会显示 32 但仍被服务端按 8 拦截；旧 web + 新 server 则画布仍硬卡 8。本次 `build:desktop` 与 `build/web` 同批完成。

## 评审意见

| 评审人 | 意见 | 结论 |
| --- | --- | --- |
| 子 agent 评审 | 可行；P0 路由 max(8)；P1 保存钳制、读值时机、多端、测试；P2 常量/别名/规范化 | 全部处理，见实施修订 |
| 用户评审 | 通过（“继续”） | 通过 |

## 追加实施（2026-11-18 14:30）

1. `dispatchLimits.ts` 新增 `UNLIMITED_DISPATCH_MAX_DEPTH = 1000` 与 `resolveDispatchLimit`：设置归一化仍是 1–32，运行期允许 1000，超过 1000 仍压回。
2. `getAgentPreferences` 增加 `dispatchUnlimited`；runtime 在 `dispatchUnlimited` 时把派发上下文上限设为 1000，其余不变。
3. 路由 `dispatchDepth` 的硬边界改为 1000；`sendToAgent` 使用 `resolveDispatchLimit`，事件携带实际值；画布 dispatcher 同样使用 `resolveDispatchLimit`，不会把 1000 压回 32。
4. 设置页新增「不限制任务链深度」开关，开启时禁用数字输入并显示警告；保存同时写入 `dispatchUnlimited`；`developerSettings` 暴露该字段，画布上限 getter 在无限档返回 1000。
5. UI 修复：`.developer > * { flex-shrink: 0 }`，避免内容超高时 `el-alert` 被压扁。
6. 测试：`resolveDispatchLimit` 允许 1000/拒绝 5000；schema 允许 1000/拒绝 1001；`sendToAgent` 深度 100 + 上限 1000 放行；dispatcher 事件上限 1000、depth 50 正常执行。服务端全量 161 例、dispatcher 19 例通过。
