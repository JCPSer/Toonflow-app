# 测试结果：Agent 派发关系可视化

- 时间：2026-11-16 00:20
- 对应方案：`2026-11-15-23-30-agent-link-visualization.md`
- 状态：已实现并部署，待重启验收

## 1. 改动清单

| 文件 | 内容 |
| --- | --- |
| `canvas/agentLinks.ts`（新） | `AgentLink` 类型、`computeAgentLinkPath` 纯几何 |
| `canvas/components/agentLinkLayer.vue`（新） | SVG 叠加层、状态色、虚线流动、箭头 marker（实例唯一 id）、悬停摘要 |
| `canvas/agentDispatcher.ts` | 入队/运行/结束更新链接；结束退场与回传脉冲；stop 清排队箭头；丢弃任务清箭头；dispose 清理定时器 |
| `canvas/index.vue` | `reactive agentLinks`、传给 dispatcher、在 vue-flow 插槽内渲染层（低于面板） |
| `canvas/agentDispatcher.test.ts` | 新增 2 例：派发→回传脉冲；停止清排队箭头 |
| `canvas/agentLinks.test.ts`（新） | 4 例几何：右侧/缩放偏移/反向/缺失坐标 |

## 2. 测试

```text
bun test（apps/web，agentDispatcher + agentLinks）：9 pass / 0 fail
apps/web vue-tsc：仅既有 @/agentRuntime 基线错误
bun run --filter web build：成功；web 资产已同步到应用 views/mainview
```

## 3. 待人工验收

- 两个 Agent 节点 A/B，A 派活给 B：出现灰色→蓝色流动箭头（A→B），箭头指向 B。
- B 完成：A→B 消失，B→A 出现约 1.6 秒的绿色短虚线脉冲。
- 停止 B：排队中的灰线立刻消失；运行中的线以黄色退场。
- 悬停线条显示「A → B · 状态 · 任务摘要」；贴着画布边缘时不裁切。
- 画布缩放/平移/拖动节点时箭头跟随；在线上滚动滚轮仍能缩放；打开 A 的对话面板时线不盖住面板。
- 切换/关闭画布后无残留箭头。

## 4. 已知限制

- 同一节点对并发多条任务时箭头几何重合，只能悬停到最上面一条（受同节点串行约束，少见）。
- 回传为静态短虚线，不做流动动画。
- 悬停摘要仅鼠标可达；读屏不可访问（层为装饰层）。
