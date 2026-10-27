# 测试结果：submitProvider 中止原因透传 + 运行日志 + 客户端工具硬超时

日期：2026-10-27 14:25

## 一、验证方式

- `apps/server` `tsc` 退出码 0（web 未改动，未重跑）。
- 隔离实例：源码 server（`TOONFLOW_DATA_DIR=/tmp/ssprobe/data`、端口 3931）+ 假 OpenAI 模型（端口 3942，用 `packages/providers/src/media/metaso.ts` 作为 submitProvider 的 source 参数，7 KB）。
- 真实 web 界面（`build/web`，Chrome）走完「设置 → 媒体模型 → 添加自定义供应商 → AI 生成供应商 → 发送」整条链路。

## 二、用例与结果

| 用例 | 期望 | 结果 |
| --- | --- | --- |
| 正常路径（前端 validate + toolResult 回传） | 工具成功、模型续跑、`complete`/`done` | 通过：`validate 200 (3 ms)` → `toolResult 200` → 第二次模型请求带上工具结果 |
| 工具执行中途 `control(close)` | 工具结果为「临时对话已关闭」，不再是被改写的通用文案 | 通过 |
| 工具执行中途 `control(stop)` | 工具结果为「工具调用被中止：本次回复已停止」 | 通过（同一路径，reason 透传） |
| 客户端连接被强制关闭（socket FIN / fetch abort） | 期望「对话连接已关闭」 | **不符合预期**：Bun 不上报断开，服务端无任何事件，整轮悬挂 60 s 以上 |
| 客户端不回传结果 | 600 s 后工具超时 | 通过（临时把常量改成 4 s 验证触发与文案，随后恢复 600 s 并让文案由常量派生） |

## 三、日志实测（`/tmp/ssprobe/data/logs/agent.log`）

`control(close)` 场景：

```
run.start session=… run=… provider=ssprobe model=probe-model tools=["submitProvider"]
clientTool.dispatch session=… callId=… tool=submitProvider bytes=7269
control session=… action=close
session.close session=… active=true
clientTool.result session=… ms=1506 outcome=临时对话已关闭 controllerAborted=false
run.abort session=… ms=1556 reason=临时对话已关闭 status=running
run.failed session=… aborted=true reason=临时对话已关闭
run.end session=… ms=1560
```

超时场景：

```
clientTool.result … ms=4001 outcome=客户端工具在 600 秒内没有返回结果，已中止本次调用 controllerAborted=false
```

## 四、Bun 断连探测实测

最小 Express（同版本 5.2.1）+ `app.listen`，客户端 POST 后直接关 socket，服务端每秒写心跳：

```
tick destroyed= undefined finished= false drain= false write= true   ×7 秒
```

`res.close` / `req.aborted` / `req.socket.close` / `res.error` 均未触发。真实 run 端点断开 60 s 后 `agent.log` 也没有 `run.abort`。

## 五、构建与部署

- `bun /tmp/bundle-desktop.ts` 产出 `build/desktop/main/index.js`（23,545,282 B），已覆盖 `/Applications/toonflow-exec.app/Contents/Resources/app/bun/index.js`。
- 原文件已备份到 `/tmp/toonflow-app-bun-index-20261027-1204.bak`（17,760,486 B）。
- 产物做了解析校验（`Bun.Transpiler.transformSync` 通过），并确认标记串（`setNavigationRules`、`desktopRuntime.json`、`webview.loadURL`、`local.toonflow.desktop`）与旧包一致、未泄漏 `.hutch/devkit` 开发入口。

## 六、未覆盖

- 用户实机复现一轮（需重启应用），本轮的日志是定性 B3 的唯一手段。
- `apps/web` 未改动，未重跑 `vue-tsc`。
- 600 s 硬超时只做了缩短版验证，未做真实 600 s 等待。
