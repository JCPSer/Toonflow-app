# Bug 方案：复制 Agent 节点后两边对话同步（孪生）

- 时间：2026-10-31 21:20
- 对应分析：`bug_analysis-2026-10-31-21-20-agent-clone-twin.md`
- 状态：已实现

## 一、修复思路

不改变「复制时只留待克隆指针、首次打开才真正克隆」的既有设计，只补两道防线：

1. **画布层兜底**：任何把 Agent 节点复制出去的动作（副本、剪贴板、粘贴）都统一执行「会话绑定降级」，不再依赖节点包的 `copy` 事件是否成功返回。
2. **打开时自愈**：打开 Agent 面板时，如果发现画布上还有别的节点绑定着同一个会话文件，先给当前节点克隆一份并改绑，历史脏数据自动拆开。

## 二、详细设计

### 2.1 共享工具

新增 `agentSessionCopy.ts`：

```
detachAgentSession(node):
  if node.type !== "remote-agentNode": return node
  if !node.data.agentSessionFile: return node
  return {
    ...node,
    data: { ...data,
      agentSessionFile: undefined,
      agentSessionCloneFrom: data.agentSessionFile,
      agentLastPrompt: undefined }
  }
```

- 纯函数、无副作用、不读目录，节点事件正常时结果与现状一致（幂等）。
- 只处理 `remote-agentNode`，其他节点零影响。

### 2.2 接入点

| 路径 | 位置 | 处理 |
| --- | --- | --- |
| 创建副本 / 拖拽复制 | `selectionToolbar.vue` `duplicateNodes` | 合并节点补丁后调用 `detachAgentSession` |
| 剪贴板复制（右键菜单） | `nodeClipboard.ts` `copyNodesToClipboard` | 序列化前调用 |
| 粘贴 | `index.vue` `pasteClipboardNode` | 写入画布前调用（兼容旧剪贴板数据） |
| 画布另存 / 导入 | `canvasFiles.ts` | 已有同类逻辑，不改 |

### 2.3 打开面板自愈

`agentNodePanel.vue` `loadSession`，在确定会话文件之后、读取对话之前：

```
if 有其他节点.data.agentSessionFile === 当前文件:
   try: 当前文件 = cloneSession(节点, 当前文件); 提示「已为这个节点分离出独立会话副本」
   catch: 保持原文件继续打开（下次打开再试）
```

- 只在真正共享时触发一次；克隆成功后当前节点改绑新文件，源节点保留原文件。
- 克隆失败不阻断打开，避免把已有对话卡死。

## 三、兼容性

| 项 | 说明 |
| --- | --- |
| 新复制行为 | 与设计一致：副本仍是「待克隆」，首次打开才产生新文件 |
| 旧节点包 | 即使节点包没有 `copy` 事件，画布层兜底也能拆开 |
| 历史脏数据 | 首次打开共享节点时自动拆分，提示一次 |
| 性能 | 每条复制/粘贴多一次浅拷贝判定；打开面板多一次节点遍历（O(n)） |
| 数据安全 | 不修改、不删除源会话文件；克隆走既有 `/api/agent/clone` |

## 四、改动清单

| 文件 | 改动 |
| --- | --- |
| `apps/web/src/pages/workspace/panels/canvas/agentSessionCopy.ts` | 新增共享工具 |
| `.../components/selectionToolbar.vue` | 副本创建后兜底拆分 |
| `.../nodeClipboard.ts` | 复制到剪贴板前拆分 |
| `.../index.vue` | 粘贴写入前拆分 |
| `.../components/agentNodePanel.vue` | 打开时检测共享并自愈 |

服务端、节点包均无改动。

## 五、测试计划

| 项 | 方法 | 期望 |
| --- | --- | --- |
| 类型检查 | `bun run --cwd apps/web typecheck` | 仅剩与本改动无关的既有报错 |
| 构建 | `bun run --cwd apps/web build` | 通过，产物包含新逻辑 |
| 静态核查 | 搜索四条复制路径 | 均调用 `detachAgentSession` |
| 真机 | 重启后复制 Agent 节点并分别发消息 | 两边互不同步；打开旧的共享节点时提示并拆分 |

## 六、风险与回滚

| 风险 | 处理 |
| --- | --- |
| 自愈误判（用户有意共享） | 现有 UI 没有「共享会话」入口，判定为脏数据安全 |
| 克隆失败 | 保持原文件打开，不阻断 |
| 回滚 | 纯前端 5 个文件，回滚构建产物即可，无数据迁移 |

## 七、评审意见

| 评审人 | 结论 | 意见 |
| --- | --- | --- |
| 用户 | 通过 | 采用「加兜底 + 自愈」，先不追查反馈人版本 |
