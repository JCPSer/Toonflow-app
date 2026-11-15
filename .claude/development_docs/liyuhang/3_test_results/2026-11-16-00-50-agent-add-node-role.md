# 测试结果：Agent 建节点时可指定角色

- 时间：2026-11-16 00:50
- 对应需求：`2026-11-15-22-35-agent-roles.md`（补充 R9）

## 1. 改动

| 文件 | 内容 |
| --- | --- |
| `packages/tools/canvas/src/runtime.ts` | `addNode` 增加可选 `roleId`；新增 `getAgentRoles` 工具（只返回 id/名称/描述） |
| `packages/tools/canvas/build.ts` | 工具提示补充「先 getAgentRoles 再 addNode，roleApplied=false 不要重试同一 id」 |
| `apps/web/.../canvas/useCanvasTools.ts` | `getAgentRoles` 实现；`addNode` 校验角色、写入 `agentRoleId`、回执 `roleApplied/roleNote` |
| `packages/tools/canvas/src/runtime.test.ts`（新） | 3 例：接受 roleId、拒绝超长/未知字段、工具已注册 |

## 2. 行为

- 只对 Agent 节点生效；给其他节点传 `roleId` 直接报错。
- 角色 id 不存在/已删除：节点仍按通用创建，回执 `roleApplied:false` 并给 `roleNote`。
- 角色只决定创建后的初始身份；节点仍没有会话与模型，第一次运行前需要用户在面板选模型（或由派发方模型回退）。

## 3. 测试

```text
bun test（packages/tools/canvas）：3 pass / 0 fail
bun run --filter web build：成功
canvas tool 构建：build/tools/canvas.tool.js 含 getAgentRoles
```

## 4. 待人工验收

- Agent A 调用 `getAgentRoles` 后 `addNode({type:"remote-agentNode", roleId})`，新节点标题出现角色名。
- 传一个不存在的 roleId，节点仍创建为通用，A 的回执提示角色无效。
