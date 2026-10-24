# 需求矩阵：ComfyUI 状态浮层插件

## 一、需求背景

ComfyUI 跑在另一台机器（如 `192.168.2.6:8188`）上，出图时无法在 Toonflow 里看到「卡在算、显存是否爆、队列是否堆积」。需要一条常驻画布的轻量状态栏，同时希望这套东西按插件形态交付，未来能装到别的机器上。

## 二、事实基础（已核实，非猜测）

拉取 ComfyUI `server.py` 确认：

- `GET /system_stats` 返回 `system.{os, ram_total, ram_free, comfyui_version, python_version, pytorch_version, argv}`、`devices[].{name, type, index, vram_total, vram_free, torch_vram_total, torch_vram_free}`。
- `GET /queue` 返回 `queue_running`、`queue_pending` 两个数组。
- **没有** CPU 使用率、温度、GPU 利用率、功耗。这些只能由运行在 ComfyUI 主机上的采集进程提供（psutil / pynvml）。

## 三、需求目标

1. 画布顶部浮动状态栏，可拖动、可折叠，位置与显隐项持久化。
2. 手动配置监控目标（IP:端口，可多个，浮层内切换当前目标）。
3. 指标按数据源能力分级：ComfyUI 自带接口能给显存、内存、队列、版本；装了采集脚本再补 CPU%、GPU 利用率、温度、功耗，缺失项置灰而不是显示假数据。
4. 以插件形态交付：扩展系统新增 `canvasOverlay` 类型，插件可安装/停用，配置存插件配置。

## 四、需求描述

| 编号 | 需求 | 说明 | 优先级 | 难度 | 风险 |
| --- | --- | --- | --- | --- | --- |
| R1 | 扩展系统新增画布浮层类型 | `resourceKind: "canvasOverlay"`，在画布上渲染插件组件，不绑定文件/节点 | P0 | 中 | 影响 ext 元数据校验、插件市场展示、画布宿主 |
| R2 | 监控代理路由 | 服务端代取 `http(s)://目标/toonflow/metrics`，失败回退 `/system_stats` + `/queue`，归一化成统一结构 | P0 | 中 | 浏览器直连 ComfyUI 会被 CORS 拦；服务端需限制协议、超时、响应体大小 |
| R3 | 采集脚本 | 单文件 Python 丢进 ComfyUI `custom_nodes`，暴露 `/toonflow/metrics`（psutil+pynvml，缺依赖降级） | P0 | 中 | 用户需手动部署；NVIDIA 之外拿不到温度/功耗 |
| R4 | 浮动状态栏 | 可拖动、可折叠、位置持久化；刷新间隔可调 | P0 | 中 | 不能挡住画布交互 |
| R5 | 可配置显示项 | CPU / 内存 / 显存 / GPU 利用率 / 温度 / 功耗 / 队列 / 版本，逐项开关 | P0 | 低 | 数据缺失时要有明确「不可用」态 |
| R6 | 多目标 | 手动添加多个 `IP:端口`，浮层内切换 | P1 | 低 | 目标不可达要能看出来 |
| R7 | 离线与错误可见 | 红点 + 「离线」+ 错误原因（超时/连接失败/HTTP 4xx） | P0 | 低 | 不能静默空白 |
| R8 | 状态显隐 | 可在插件市场停用；停用后画布不渲染 | P1 | 低 | 已有停用机制复用 |

## 五、明确不做

- 不做自动发现（用户选择手动填写）。
- 不做历史曲线/告警推送。
- 不做在无采集脚本时伪造 CPU/温度。
- 不改 ComfyUI 自身的生成逻辑。

## 六、评审意见

> 待用户填写

| 评审人 | 结论 | 意见 |
| --- | --- | --- |
| 子 agent（初评） | | |
| 用户 | | |
