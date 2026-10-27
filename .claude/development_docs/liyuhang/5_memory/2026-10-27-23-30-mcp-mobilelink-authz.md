# 记忆：MCP 授权入参收敛（设备互联豁免恢复）

## Situation

第 2 轮架构治理把 `mcp/control.ts` 的 Host 判定入参从 Express `Request` 改成普通对象 `AppOriginRequest`，新增 `mobileLink?: boolean` 字段。`getAppOrigin` 装配正确，`authorizeMcp` 却仍把原始 `Request` 传进 `allowedHost`。

## Task

恢复设备互联在 `/mcp` 网关与 `/api/mcp/control/*` 上的放行，并让同类漏装配不可能再静默发生。

## Action

- `control.ts` 新增私有 `appOriginRequest(req)`，作为 Request → 判定入参的唯一转换点；`getAppOrigin` 与 `authorizeMcp` 都改走它。
- `agentRuntime.ts` 补 `export { createA2aRouter } from "@/agent/a2a"`；`modules/agentAccess/index.ts` 改为 `await import("@/agentRuntime")`，模块入口不再直指 agent 内部路径。
- `AGENTS.md` 冻结动态块条目由 `@/agent/a2a` 改为 `@/agentRuntime`（门面再导出）。

## Result

- 探针三例：配对设备局域网 IP 放行、未配对拒绝、本机放行（修复前同一请求 `authorizeMcp=false`）。
- server typecheck 0 错误、bundle 3171 模块 23.27MB、源码起服务 455ms、`/a2a` 挂载无报错。

## 精度要点

- 类型窄化（`Request` → 普通对象）时，**所有**调用点都必须跟着改；只改"看起来需要"的那一个，其余会退化为「字段恒 undefined → 判定恒不成立」，这类缺陷不报错、不崩溃，只在特定宿主 + 特定客户端组合下暴露。
- 用 Proxy 伪造 `res.locals` 对所有 symbol 键返回真值，可以在不接触私有 Symbol 的情况下模拟「已配对设备」，是可复用的鉴权探针手法。
- 判定函数的面越窄，越需要单一转换点；否则每加一个字段就多 N 个可能漏装配的调用方。
