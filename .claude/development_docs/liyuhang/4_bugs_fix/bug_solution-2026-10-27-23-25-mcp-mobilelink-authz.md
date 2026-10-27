# Bug 修复方案：MCP 授权统一走单一入参转换点

日期：2026-10-27 23:25
对应分析：`bug_analysis-2026-10-27-23-20-mcp-mobilelink-authz.md`

## 一、目标

1. 恢复设备互联在 `/mcp` 与 `/api/mcp/control/*` 上的 Host 豁免。
2. 从结构上消除同类复发：只要入参是普通对象，任何调用方漏装配字段都会静默降级为「不放行」，因此转换点只能有一个。

## 二、方案

在 `control.ts` 内新增私有函数 `appOriginRequest(req: Request): AppOriginRequest`，作为 Express Request → 判定入参的**唯一**转换点：

```
appOriginRequest(req):
    return { origin, referer, host, hostname, mobileLink: isMobileLinkRequest(req) }

resolveAppOrigin(obj)        ← 纯判定，仍只接收普通对象
getAppOrigin(req)            = resolveAppOrigin(appOriginRequest(req))
authorizeMcp(req)            → !allowedHost(appOriginRequest(req)) 即拒绝
```

要点：
- `allowedHost` / `resolveAppOrigin` 的签名不变（仍然面向普通对象），agent 侧经 `AgentHost` 传入自己的普通对象不受影响。
- 不再允许任何调用方自行拼装入参；新增调用方一律经 `appOriginRequest`。
- 注释写明「漏装配 mobileLink 会让豁免静默失效」，把这条约束留在代码现场。

## 三、附带收口（同一轮评审提出）

1. 门面缺口：`modules/agentAccess/index.ts` 直接 `await import("@/agent/a2a")` 取 `createA2aRouter`，绕过了 `src/agentRuntime.ts` 这道唯一门面。改为 `await import("@/agentRuntime")`，并在门面补 `export { createA2aRouter } from "@/agent/a2a"`；`AGENTS.md` 的冻结动态块条目同步改为 `@/agentRuntime`。
2. 流程项：`packages/formats/` 整个目录在本轮仍是 untracked，提交时必须纳入版本库，否则构建期解析失败。

## 四、验证

| 用例 | 预期 |
| --- | --- |
| 已配对设备 + 局域网 IP + requiresLocalHost | 放行 |
| 未配对 + 局域网 IP + requiresLocalHost | 拒绝 |
| 本机 127.0.0.1 | 放行 |
| server typecheck / build | 通过 |
| 源码起服务 + `/a2a` 挂载 | 启动无错 |

## 五、评审意见

（待填写）
