# 测试结果：浏览器画面帧洪泛卡死 + 只读滚动

日期：2026-10-26 22:50

## 一、复现环境

`/tmp/heavy` 用 Bun 起一个 6.26 MB 的 JSON 文本页（模拟 ComfyUI `/history`），用 `packages/tools/browser/src/host.ts` 真实运行时 + 本机 Chrome（无头）打开，订阅画面流后用滚轮连续滚动。

## 二、修复前后对比

| 指标 | 修复前 | 修复后 |
| --- | --- | --- |
| 单帧大小（文本页） | 544–563 KB（1280×800，q65） | 266–267 KB（960×600，q55） |
| 滚动 5 秒帧数 | 112（约 22 fps） | 42（约 8 fps） |
| 滚动 5 秒流量 | **61.1 MB** | **10.9 MB** |
| 静止 4 秒新增帧 | 持续有帧 | **0** |
| 服务端事件循环延迟 | 写流占满 | 正常（滚轮不再触发 `updateState`） |

源头限流验证（独立脚本，只推迟 ack）：5 秒 70 次滚轮只收到 41 帧，说明 Chromium 确实按 ack 间隔推送，不会在服务端堆积。

## 三、改动验证

- `packages/tools/browser` `vue-tsc` 通过；`apps/server` `tsc` 通过；`apps/web` `vue-tsc` 通过。
- `bun run build` 通过，桌面入口重新打包（23.5 MB）并安装到 `/Applications/toonflow-exec.app`，同步 `tools/browser.tool.js`。
- 工具协议未变：浏览器工具包仍只做参数校验并转交服务端 runtime，host 改动随服务端 bundle 生效。

## 四、未覆盖

「AI 生成媒体供应商」对话框内真实点验（滚动与卡死观感）需要可用模型驱动一轮浏览，本轮未跑；只读滚动的服务端路径（`/api/browser/input` 的 wheel）已在上一轮权限/输入测试中验证可用。

## 五、收尾

停止 `/tmp/heavy` 的模拟页服务，删除临时探针脚本；仓库内无残留调试文件。
