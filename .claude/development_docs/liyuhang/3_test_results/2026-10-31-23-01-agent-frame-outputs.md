# 测试结果：Agent 可编程开启/使用「首帧 / 尾帧」输出

- 时间：2026-10-31 23:01
- 分支：`feat/exec-node`
- 变更：`packages/nodes/videoNode/src/frameOutputTool.ts`（新增）、`frameOutput.ts`（toggle 拆 apply + 每路 controller/epoch + 整轮 round）、两个节点 `index.vue` 各加一行注册

## 1. 测试边界

按 `AGENTS.md`「测试与检查边界」：项目代码中不新增 `.test.ts` / `.spec.ts`。本轮**未新增任何测试文件**，实施期写过的 `frameOutputTool.test.ts` 已删除；验证以 typecheck、构建和必要的手动验证为准。

```
cd packages/nodes/videoNode && bun test
18 pass / 0 fail（69 expect，均为既有 frameOutputPlan / frameTarget 用例）
```

既有 18 例回归通过，说明 `frameOutputPlan` 未被本次改动影响。新增工具的纯逻辑（部分更新、未传项状态、失败隔离、取消）由 3 轮代码审查逐分支核对，未留自动化用例。

## 2. 类型检查

| 包 | 命令 | 结果 |
| --- | --- | --- |
| `@toonflow/node-video` | `vue-tsc --noEmit` | 通过（0 错误） |
| `@toonflow/node-video-generation` | `vue-tsc --noEmit` | 通过（0 错误） |

## 3. 构建与产物

| 产物 | 大小 | 核对 |
| --- | --- | --- |
| `build/nodes/videoNode.umd.js` | 236.13 kB | 含 `setFrameOutputs` 定义与描述 |
| `build/nodes/videoGenerationNode.umd.js` | 449.07 kB | 同上 |

部署后 6 处 md5 一致（构建产物 / 应用 Resources / 运行期 `toonflow-data/nodes`）：

```
f0cb54f6c106bb9035828bae71444d66  videoNode
e7aaee1dcdd4aab6ebd7d03780a8f6c8  videoGenerationNode
```

`scripts/deploy-local.sh` 已同步 2 个节点包，**未重启应用**（按用户要求）。

## 4. 静态核对

| 检查 | 依据 |
| --- | --- |
| 工具在两节点注册 | `videoNode/src/index.vue`、`videoGenerationNode/src/index.vue` 的 `nodeTools.register(createFrameOutputTool(frames))` |
| 画布入口会拦截禁用节点 | `useCanvasTools.ts:312-316` → `findNode()` 抛「节点已禁用」 |
| 工具返回时端口快照已同步 | `frameOutput.ts` 每次 handles 变更后 `await nextTick()`；`nodeSkeleton.vue:753-778` 的同步与悬空边删除均在 flush 内 |
| 关闭不再连带取消另一路 | `abortFrame(key)` 按 key 索引 controller/epochs |
| 排队旧 job 不会用旧视频回填 | `round` + `JobTicket{round, epochs, explicitSource}` 检查 |
| 失败原因按路保留 | `errors` 映射，`setFrameError` 派生 `error`（两路都失败时拼接） |

## 5. 代码审查（3 轮，子 Agent）

| 轮次 | 结论 | 主要问题 | 处置 |
| --- | --- | --- | --- |
| R0（方案初审） | 需修订 | P0：方案新增 `.test.ts` 违反 `AGENTS.md:257-258`；P1：已开启无值无法重抽、生成中语义、apply 与 queue 并发口径、错误三分 | 删除新增测试文件；其余按 R1-R3 落地 |
| R1 | 需修订 | P1：共享 controller/epoch 会让开启 A 取消 B 的 refresh 抽帧 | 改为每路独立 controller/epochs |
| R2 | 需修订 | P1：排队中的旧 runJob 逃逸（删视频/连续替换）；P1：`runJob` 末尾无条件清 error；P2：TOCTOU、取消语义、错误共享 | 新增 `round` + ticket、`errors` 按路、remove 前二次校验、取消优先、pendingReason/error 透出 |
| R3 | 需修订 | P1：关闭请求遇到在途开启会早退，端口最终仍被打开；P2：排队未启动的重试竞态、remove 前缺代次校验、写回旧 config 快照覆盖另一路、两路错误只显示一条 | 关闭分支识别 in-flight 并强制落下 abort；新增 `queuedRounds`；remove 前校验；写回改为重新读 `config.value`；错误文案拼接 |

## 6. 未覆盖 / 待人工验证

- 按仓库规则不新增测试模块，`apply`/`runJob` 的并发分支本轮靠 3 轮代码审查 + 类型检查兜底，**未做自动化回归**。
- 工具层纯逻辑（部分更新、未传项返回、失败隔离、取消）同样未留自动化用例，验证方式是审查核对与下述人工链路。
- 真机端到端：需用户重启应用后验证
  1. 对视频节点说「开启尾帧并接到下游图片节点」，Agent 是否能自己 `getNodeTools` → `setFrameOutputs` → `connectNodes`；
  2. 无视频时开启返回 `pending/pendingReason=no-video`，`setVideo` 后自动补帧；
  3. 生成中开启、连续切换视频、关闭带线端口各一条。
