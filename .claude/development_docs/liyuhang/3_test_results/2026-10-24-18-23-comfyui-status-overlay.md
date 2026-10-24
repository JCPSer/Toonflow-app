# 测试结果：ComfyUI 状态浮层插件

环境：macOS arm64 / Bun / 源码 `Toonflow-app`
服务端：`NODE_ENV=dev TOONFLOW_DATA_DIR=/tmp/tf-mon TOONFLOW_SERVER_PORT=3112 bun src/index.ts`
前端：`TOONFLOW_SERVER_PORT=3112 bun run dev`（vite 5173 → 代理 3112）
假目标：`bun /tmp/fake-comfy.ts`（3210 = 纯 ComfyUI 接口，3211 = 带采集脚本）
浏览器：chrome-devtools 驱动，打开本地 demo 项目的画布。

## 一、类型检查

| 包 | 结果 |
| --- | --- |
| server（`tsc`） | 通过 |
| web（`vue-tsc`） | 通过 |
| extScaffold | 通过 |
| ext/comfyMonitor | 通过 |

## 二、扩展框架

| # | 用例 | 实际 | 结论 |
| --- | --- | --- | --- |
| 1 | 新类型列入 `/api/ext/list` | `ext-comfyMonitor` 返回 `resourceKind: "canvasOverlay"`，`loadError` 为空 | 通过 |
| 2 | 浮层配置放行 | PUT `/api/ext/save` 提交 `{targets, active, interval, position, items}` 完整保存；`/api/ext/list` 原样返回 | 通过 |
| 3 | 其他扩展配置不受影响 | `ext-image` 仍返回 `{fitToWindow: true}`，`ext-txt` 仍返回 `{fontSize: 14, wordWrap: true}`（仍走 configRules 过滤） | 通过 |
| 4 | 构建产物 | `build/ext/ext-comfyMonitor.umd.js`（25.4 kB），元数据头含 `canvasOverlay` | 通过 |

## 三、监控代理（curl 实测）

| # | 用例 | 期望 | 实际 | 结论 |
| --- | --- | --- | --- | --- |
| 5 | 纯 ComfyUI 目标 | 归一化 + 标记缺失项 | `source: comfyui`，RAM 75%、VRAM 12.0/24 GB、队列 2/1，`missing` 含 cpuPercent/gpuUtil/temperature/power | 通过 |
| 6 | 带采集脚本目标 | 全量指标 | `source: sidecar`，CPU 37.5%、GPU 88%、71°C、320.5W、VRAM 20/24 GB、队列 1/4，`missing: []` | 通过 |
| 7 | 目标不可达 | 502 + 可读提示 | `无法读取监控状态：连接不上目标主机，请检查地址与网络` | 通过 |
| 8 | 非 HTTP 协议 | 400 | `请填写不含账号密码和查询参数的 HTTP(S) 地址` | 通过 |
| 9 | 地址带账号密码 | 400 | 同上 | 通过 |
| 10 | 非本机调用 | 403 | `只能在本机查询监控状态`（无 `x-toonflow-workspace`/Origin 时命中） | 通过 |

## 四、浮层 UI（画布实测）

| # | 用例 | 实际 | 结论 |
| --- | --- | --- | --- |
| 11 | 浮层渲染 | 画布顶部出现状态条：在线点、目标名、CPU/内存/显存/GPU/队列 | 通过 |
| 12 | 拖动 | 手柄拖动 (40,20) → (240,110)，刷新页面后位置保持 | 通过 |
| 13 | 显示项开关 | 取消勾选「温度」，chip 立即消失，刷新后仍隐藏 | 通过 |
| 14 | 折叠/展开 | 折叠后仅剩「本机 ▸ ⚙」，再次点击恢复全部 chip | 通过 |
| 15 | 切换目标 | 从 sidecar 目标切到纯 ComfyUI 目标，CPU/GPU 显示「不可用」，内存/显存/队列有值 | 通过 |
| 16 | 目标不可达 | 红点 + 全部 chip 显示「—」，悬浮提示「连接不上目标主机」 | 通过 |
| 17 | 新增目标并填写地址 | 立即重新取数，不用等轮询周期（修复 `@change` 不刷新的问题） | 通过 |
| 18 | 多画布实例 | 浮层挂在 `canvasHost` 且 `v-if="active"`，页面中 `.canvasOverlays` 只有 1 个 | 通过 |

## 五、采集脚本

| # | 用例 | 实际 | 结论 |
| --- | --- | --- | --- |
| 19 | 本机直接执行 `collect()` | 返回 `{platform, ts, cpu:{percent,cores,freqMhz}, ram:{...}, gpus:[], queue:null, missing:["pynvml"]}` | 通过 |
| 20 | 无 `psutil` 的机器 | 代码路径返回 `None` 且不抛错（按依赖缺失分支检查） | 通过（代码审查） |
| 21 | 老版本 ComfyUI 无 `get_current_queue_volatile` | 回退 `get_current_queue` | 通过（代码审查） |
| 22 | macOS 不支持 `cpu_freq` | 仍返回使用率与核数，`freqMhz: null`（修复前整个 cpu 为 null） | 通过 |

## 六、打包

| 步骤 | 结果 |
| --- | --- |
| web 构建 + 服务端 bundle 重建 | 成功 |
| `build/ext` 同步到 `Resources/app/ext` 与 `/Applications/data/ext` | 完成 |
| 产物校验 | web 资产含 `canvasOverlays` 浮层代码，主进程 bundle 含 `canvasOverlay` |
| 重签 | `codesign --force --deep --sign -` 成功 |
| 旧包备份 | `/tmp/toonflow-exec-old7.app` |

## 未覆盖

- 打包 app 内的点击验证：验证期间 app 一直在运行旧进程，未强行重启，需用户重启后确认。
- 真实 ComfyUI + 真实 NVIDIA 显卡上的采集脚本联调（本机为 macOS，只能验证降级路径）。
- 移动端布局。

## 七、代码审查后修复

子 agent 审查出 6 条（1 critical / 5 important）与 5 条建议，处置如下：

| 编号 | 问题 | 处理 |
| --- | --- | --- |
| C1 | `canvasOverlay` 并入 `ExtResource` 后，既有扩展访问 `resource.path` 类型报错 | `ExtContext<R extends ExtResource = DocumentExtResource>` 泛型化，默认仍是文档资源；5 个既有扩展包 typecheck 全部恢复通过 |
| I2 | 切换监控目标不落盘，重开回到旧目标 | `watch([active, interval])` 内补 `persist()` |
| I3 | `refresh` 先 `abort` 再判 `inFlight`，可能中断请求却不重发 | 改为先判在途再中止，并为 `pointercancel` 补监听 |
| I4 | 采集脚本不返回 ComfyUI 版本，「版本」永久不可用 | sidecar 增加 `from comfyui_version import __version__` 兜底 |
| I5 | 离线只有红点，无可视原因 | 增加「离线」chip，hover 显示错误文本 |
| I6 | 多标签页各自轮询，外呼放大 | 服务端按目标地址 1.5 s 缓存 + 在途复用 |
| S7 | 拖拽未处理 pointercancel / 卸载残留监听 | 补 `pointercancel`、卸载时移除监听 |
| S8 | 防抖未落盘就被卸载，最后的位置/开关丢失 | 卸载前 `clearTimeout` 并立即 `saveNow()` |
| S9 | 超限配置会让 `/api/ext/list` 整体失败 | 读取路径 `try/catch` 回退 `{}` |
| S10 | 移动端/远端也挂浮层但接口 403 | 移动端不挂载浮层 |
| 提示 | 内网/link-local 仍可探测 | 属产品需求（监控 LAN 机器），保留，仅在文档注明 |

复测：`tsc` / `vue-tsc`（web、extScaffold、5 个既有扩展、comfyMonitor）全通过；重建 ext/web/server bundle 后，浏览器实测状态正常、缓存命中后响应 ~18 ms；重新打包 app（旧包 `/tmp/toonflow-exec-old8.app`）。

## 八、增量需求：清理显存按钮 + 指标标签细化

需求：温度/功耗需要区分对象；用户决定**不增加 CPU 温度/功耗**，同时新增「清理显存」按钮。

实现：
- 标签改为「GPU 利用率 / GPU 温度 / GPU 功耗」，明确只来自显卡。
- 新增 `POST /api/monitor/free`，代理 ComfyUI `/free {unload_models:true, free_memory:true}`；服务端共享缓存抽出到 `utils/monitor.ts`，清理后立即失效该目标的缓存。
- 状态栏新增清理按钮：请求中显示旋转图标；队列有任务时提示「显存会在该任务结束后释放」；1.8 秒后对比前后显存占用，提示「已释放 X GB」。

| # | 用例 | 实际 | 结论 |
| --- | --- | --- | --- |
| 23 | `POST /api/monitor/free` 直连假服务 | `{"code":200,"data":{"freed":true}}`，假服务显存 20 GB → 1 GB | 通过 |
| 24 | 清理后缓存立即失效 | 1.5 s TTL 内再次 GET 已返回新值（1 GB），未读到旧缓存 | 通过 |
| 25 | 目标不可达 | `清理显存失败：连接不上目标主机，请检查地址与网络`（502） | 通过 |
| 26 | 画布点击按钮 | 提示「当前有任务在运行，显存会在该任务结束后释放」+「已释放 19.0 GB 显存」，chip 从 20.0 GB 变 1.0 GB | 通过 |
| 27 | 标签 | 显示「GPU 利用率 / GPU 温度 / GPU 功耗」 | 通过 |
| 28 | 非本机调用 | 403（与状态接口同一守卫） | 通过 |

审查后修复（本轮）：`refresh` 先判在途再中止、切换目标补 `persist`（此前目标切换不落盘）、离线增加「离线」chip、卸载前立即落盘、拖动补 `pointercancel`；指标标签改用 tabler 图标替换字符图标。

## 九、增量：整条状态栏可拖动

- 根元素接管 `pointerdown`，命中 `button, input, textarea, select, .el-switch, .el-radio, .el-checkbox, .el-slider, .el-select, .el-popover` 或 `[role="slider"]` 时跳过拖动；手柄保留为视觉提示。
- 光标：整条 `grab`，拖动中 `grabbing`，按钮/输入框保持 `pointer`。
- `setPointerCapture` 包了 try/catch：个别环境（非活跃指针）会抛错，之前会中断拖动初始化。

| # | 用例 | 实际 | 结论 |
| --- | --- | --- | --- |
| 29 | 从目标名文字处拖动 | (240,110) → (340,150) | 通过 |
| 30 | 从指标 chip 处拖动 | → (400,180) | 通过 |
| 31 | 点设置按钮 | 不移动，正常打开设置面板 | 通过 |
| 32 | 手柄 | 仍可拖动（保留视觉提示） | 通过 |

已重新打包 app（仅替换 `ext-comfyMonitor.umd.js`，`Resources/app/ext` 与 `data/ext` 同步后重签）。
