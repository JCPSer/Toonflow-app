# Bug 分析：设备互联的 MCP 授权豁免被静默删除

日期：2026-10-27 23:20
发现方式：对第 2 轮架构治理（AgentHost 端口 + 反向门面）的独立评审
严重级别：中（功能退化，非崩溃）

## 一、背景

第 2 轮治理把 `modules/mcpIntegration/mcp/control.ts` 的判定入参从 Express `Request` 窄化为普通对象：

```ts
type AppOriginRequest = { origin?; referer?; host?; hostname?; mobileLink? }
function allowedHost(request: AppOriginRequest) {
  return request.mobileLink === true || !requiresLocalHost || ["localhost","127.0.0.1","[::1]"].includes(request.hostname ?? "");
}
```

改造动机正确：agent 层要复用页面来源判定，但不能依赖 express 的 `Request` 类型。

## 二、现象

`getAppOrigin(req)` 适配正确（显式装配 `mobileLink: isMobileLinkRequest(req)`），但同文件的 `authorizeMcp(req)` **仍把原始 Express Request 直接传给 `allowedHost`**。`Request` 上没有 `mobileLink` 字段，取值恒为 `undefined`，`=== true` 永不成立。

## 三、影响面

触发条件：`requiresLocalHost === true` 的宿主（桌面 / 原生开发形态）+ MCP 已开启 + 请求来自设备互联（局域网 IP 访问桌面共享后端）。

| 路径 | 旧行为 | 新行为 |
| --- | --- | --- |
| `/mcp` 网关 | 放行（`isMobileLinkRequest` 为真） | 401 |
| `/api/mcp/control/{state,events,result}` | 放行 | 403 |

`assertAppRequest` 走 `getAppOrigin`，仍然正常放行，于是形成「同一台设备，页面来源校验通过、MCP 鉴权拒绝」的不一致状态。移动端控制连接（`registerWorkspaceControl` / 画布联动）在开启 MCP 时失效。

## 四、实测证据

探针（临时文件，已删除）：伪造设备互联请求（`res.locals` 用 Proxy 对所有 symbol 键返回真值，从而在不碰私有 Symbol 的前提下模拟已配对设备），宿主设为 desktop：

```
修复前: {"requiresLocalHost":true,"getAppOrigin":"http://192.168.1.9:3000","authorizeMcp":false}
修复后: {"requiresLocalHost":true,"配对设备/局域网 IP":true,"未配对/局域网 IP":false,"本机 127.0.0.1":true}
```

同一份请求，来源校验通过、MCP 鉴权拒绝 —— 差异即缺陷。

## 五、优先级 / 难度 / 风险

- 优先级：中。不与本轮治理主线冲突，但属于"重构顺手改坏"的典型，且只在移动端 + MCP 组合下暴露，现有 16 项冒烟测试覆盖不到。
- 难度：低。单点收敛，无接口变化。
- 风险：低。改动局限在鉴权判定的入参装配，不触碰令牌比较与来源校验逻辑。

## 六、评审意见

（待填写）
