# Bug 修复方案：用户配置的模型窗口优先

- 时间：2026-11-18 12:02
- 关联分析：`bug_analysis-2026-11-18-11-59-model-window-override.md`

## 方案总览

把「单个字段的解析顺序」从

```
硬编码表命中 → 直接返回（用户值被丢弃）
否则 user ?? 内置目录 ?? 兜底
```

改为每个字段独立取值：

```
用户显式值 ?? 硬编码表 ?? Pi 内置目录（跨供应商参数一致时） ?? 兜底
```

并把这段纯逻辑抽到独立模块，便于单测，不引入运行时依赖。

## 详细设计

### 1. 新增纯函数 `modelLimits.ts`

入参：`providerId`、模型配置（`id`、可选的 `contextWindow` / `maxOutputTokens`）、Pi 内置模型目录（结构最小化，只取 `id/provider/contextWindow/maxTokens`）。

伪代码：

```
positive(v) = v 是有限数且 > 0 ? v : undefined

table = 硬编码表按 id 精确或正则命中
matches = 内置目录里 id 相同项
exact = matches 中 provider 相同项
candidates = exact ? [exact] : matches
same(key) = candidates 全部一致 ? 该值 : undefined

contextWindow = positive(model.contextWindow)
             ?? table?.contextWindow
             ?? positive(same("contextWindow"))
             ?? 262144
maxTokens     = positive(model.maxOutputTokens)
             ?? table?.maxTokens
             ?? positive(same("maxTokens"))
             ?? 32768
```

要点：两个字段独立回落，所以「只填窗口」不会连带丢掉表里的输出上限；`same()` 保持原有「跨供应商同名参数必须逐项一致才采用，不猜别名」的约束。

### 2. 接入 `getModelLimits`

- `index.ts` 的 `getModelLimits` 改为调用纯函数，函数签名保持不变，调用点（压缩、上下文统计、`listAiModels`）无需改动。
- `modelContextLimits.ts` 顶部注释从「优先于用户配置」改为「仅在用户未填写时作为默认值」，避免下一个人按旧注释又改回去。

### 3. 不改的部分（明确取舍）

- **不动 `compactReserveTokens` 的「reserve 不超过窗口一半」上限**。之前讨论过把输出预留压到窗口 1/4，但若模型真的按最大输出生成，预留不足会让「输入 + 输出」越过窗口，属于更难排查的问题；窗口修正后，512k 线在 50% 百分比下自然得到 256k 的触发点，已经解决问题。
- **不新增设置项**。用户已有供应商模型的窗口/输出字段，本次只是让它生效；新增「自动探测」既不可靠也没有必要。
- **不改压缩百分比下限**。百分比仍是 50–95，语义不变。

### 4. 测试

新增 `apps/server/src/modules/mediaGeneration/ai/modelLimits.test.ts`（纯函数，不加载 conf）：

1. 用户窗口 512000 + 表命中 1048576 → 返回 512000。
2. 用户未填窗口 → 表命中 1048576（现状不变）。
3. 表未命中、用户未填 → 内置目录同 id 且参数一致时采用；不一致时回落 262144。
4. 只填窗口不填输出 → 输出上限取表值。
5. 用户填 0 / 负数 / NaN → 视为未填。

另跑 `bun run --filter '@toonflow/server' typecheck` 与现有 server 单测。

### 5. 部署

- 只改服务端：`bun run build:desktop`，从生成的 `Resources/*.tar.zst` 解包取 `app/bun/index.js` 覆盖（保留旧文件为 `.bak-<time>`）。
- **禁止**用 `build:server/index.js` 覆盖桌面入口（历史事故：应用无窗口）。
- 本轮 `conversation.vue` 有改动，`views/mainview` 需要同步；`nodes`、`tools`、`data`、`version.json` 不动；不重启应用，由用户退出重开。

## 风险与回滚

- 风险：用户把窗口填得比真实更大 → 压缩仍会偏晚。回滚只需还原 `getModelLimits` 优先级与纯函数调用。
- 回滚路径：`app/bun/index.js.bak-<time>` 直接还原，或重新构建上一版。

## 实施修订（评审后）

1. **P1-1 有效阈值说明**：只填窗口、不填输出上限时，表内 `maxOutputTokens` 仍参与 reserve，512k 窗口下 reserve 封顶一半，实际触发点固定 50%；已在测试中固化 `compactReserveTokens(512000, 393216, 80) = 256000`，并在设置文案层面保留“想按更高百分比压缩就填实际输出上限”的解释口径。不改 reserve 公式，避免模型真按最大输出生成时越过窗口。
2. **P2-1 摘要预算**：`keepRecentTokens` 的约束增加 `budget - 2048 - floor(0.8×reserve)`，避免「保留 + 摘要」超出压缩阈值导致压完即再压；补 512k/393k、64k–1M 多窗口测试。
3. **P2-2 横幅阈值**：`AgentContext` 增加 `compactPercent`（服务端用同一 reserve 公式计算），`conversation.vue` 优先读取该值，不再直接用设置里的百分比。
4. **P2-3 测试**：补共识分支、精确供应商 vs 不一致目录、只填窗口时输出回落、`null` 值；偏好测试补 512k/393k 的 50/80/95。
5. **P2-4 其他口径**：`resolveModelLimits` 的供应商比较改为不区分大小写，与 `getModelReasoning` 一致；`subAgent.ts` 的 128000 兜底本轮不改（正常路径均从 `createAgentModel` 取得修正后的窗口），`models.ts` 自动获取值同样视为配置值、优先于内置表。

## 部署校验（两层归档）

1. `build:desktop` → `build/desktop/app/stable-macos-arm64/toonflow.app/Contents/Resources/<hash>.tar.zst`；
2. `zig-zstd decompress` 内层后取 `toonflow.app/Contents/Resources/app/bun/index.js`；
3. 覆盖前备份 `.bak-<time>`；覆盖后校验体积约 17.86 MB、含 `BrowserWindow`，禁止使用 23 MB 的 `build/server/index.js`；
4. `build/web` 同步到 `app/views/mainview`（同样备份），不重启应用。

## 评审意见

| 评审人 | 意见 | 结论 |
| --- | --- | --- |
| 子 agent 评审 | 可行、不阻塞发布；P0 无；P1-1 有效阈值语义、P1-2 两层归档部署校验；P2 摘要预算/横幅/测试/其他窗口口径 | 全部采纳，见实施修订 |
| 用户评审 | 通过（“继续”） | 通过 |
