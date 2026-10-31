# 测试结果：Agent 节点复制孪生（兜底 + 自愈）

- 时间：2026-10-31 21:20
- 对应分析/方案：`4_bugs_fix/bug_analysis-2026-10-31-21-20-agent-clone-twin.md`、`4_bugs_fix/bug_solution-2026-10-31-21-20-agent-clone-twin.md`
- 环境：macOS 14.6 arm64 / Bun 1.3.11

## 1. 改动核对

| 路径 | 是否接入兜底 | 证据 |
| --- | --- | --- |
| 创建副本 / 拖拽复制 | 是 | `selectionToolbar.vue` 调用 `detachAgentSession` |
| 剪贴板复制（节点菜单） | 是 | `nodeClipboard.ts` 序列化前调用 |
| 粘贴 | 是 | `index.vue` 写入画布前调用 |
| 画布另存 / 导入 | 既有逻辑 | `canvasFiles.ts:126` 未改 |
| 打开面板自愈 | 是 | `agentNodePanel.vue` 检测共享文件后克隆改绑 |

## 2. 静态检查

| 项 | 命令 | 结果 |
| --- | --- | --- |
| Web 类型检查 | `bun run --cwd apps/web typecheck` | 仅剩既有报错 `apps/server/.../singleAgent/types.ts` 找不到 `@/agentRuntime`（与本次改动无关，改动未触碰该文件） |
| Web 构建 | `bun run --cwd apps/web build` | 通过（3.91 s），`build/web/assets/workspace-B1k3sKh0.js` 包含自愈提示文案与 `agentSessionCloneFrom` |
| 部署 | `scripts/deploy-local.sh` | 完成；安装目录 chunk 大小 5,470,865 B |

## 3. 逻辑推演（复制场景）

| 场景 | 期望 |
| --- | --- |
| 节点包 copy 事件正常 | `detachAgentSession` 收到无 `agentSessionFile` 的副本，原样返回（幂等，无行为变化） |
| 节点包 copy 事件缺失 / 旧版 | 画布层把 `agentSessionFile` 转为 `agentSessionCloneFrom`，首次打开克隆出新文件 |
| 旧剪贴板数据（带文件） | 粘贴时拆分，不共享 |
| 画布中已存在共享节点 | 打开其中一个时检测到另一个绑定同一文件 → 克隆改绑并提示 |

## 4. 部署

- 未重启应用（遵守用户要求）；重启后生效。
- 本次只改前端，服务端与节点包无改动。

## 5. 待人工复验

1. 重启应用，打开任意画布。
2. 复制一个已有对话的 Agent 节点，分别打开两个面板：新节点首次打开应创建独立副本，两边发消息互不影响。
3. 若画布中存在旧的共享节点，打开时应提示「已为这个节点分离出独立会话副本」，随后两边独立。
