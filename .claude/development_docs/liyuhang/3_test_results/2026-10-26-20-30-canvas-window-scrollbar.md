# 测试结果：画布区域窗口级滚动条

日期：2026-10-26 20:30
环境：dev（bun server :3121 提供 build/web 产物），Chrome DevTools 改窗口尺寸实测

## 一、修复前（800×560）

| 指标 | 值 |
| --- | --- |
| `documentElement.scrollWidth / clientWidth` | 1237 / 794（横向溢出 443px） |
| `documentElement.scrollHeight / clientHeight` | 560 / 544（横向滚动条占高引发纵向滚动条） |
| 溢出元素 | `.comfyMonitor .chip`（right 869 / 929 > 794） |

## 二、修复后（800×560）

| 指标 | 值 |
| --- | --- |
| `scrollWidth / clientWidth` | 800 / 800 |
| `scrollHeight / clientHeight` | 560 / 560 |
| `.comfyMonitor` | `flex-wrap: wrap`，实测宽度 424、right 792，芯片折行，按钮仍在画布内 |
| `html` class | 含 `workspaceViewportLock`，`html/body` 计算值 `overflow: hidden` |

其它尺寸（1024×700、1312×812、1440×900）此前就无溢出，复测无回归。

## 三、路由侧验证

- 工作区渲染时 `route.currentRoute.path === "/workspace"`，`workspaceViewportLock` 存在。
- 直接改地址栏 hash 会被应用自身的「恢复上次工作区」逻辑接管（`currentRoute` 仍是 `/workspace`），因此该项以路由状态为准，不以地址栏为准。
- 过程中用 `router.push('/home')` 触发过未保存确认弹窗（Element Plus 给 body 加了 `el-message-box-parent--hidden`，同样表现为 `overflow: hidden`），测试读数按此排除干扰。

## 四、构建与部署

- `@toonflow/web` typecheck / build 通过；`bun run build:ext` 通过。
- `scripts/bundle-desktop.ts` + `scripts/deploy-local.sh` 完成：前端、`ext-comfyMonitor.umd.js` 已同步到应用 `Resources/app/ext` 与运行期 `/Applications/data/ext`。

## 五、未覆盖

1. 打包应用（WKWebView）内实测：需重启应用后在窄窗口下确认无滚动条。
2. 文档面板（文本编辑）在 `workspaceViewportLock` 下是否仍可内部滚动：面板自身是独立滚动容器，预期不受影响，未在此轮手测。
