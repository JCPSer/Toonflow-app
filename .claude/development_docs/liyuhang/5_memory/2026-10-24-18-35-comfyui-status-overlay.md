# ComfyUI 状态浮层插件（STAR）

## Situation

ComfyUI 跑在另一台机器上，出图时看不到显存是否吃紧、队列是否堆积。Toonflow 的扩展系统当时只有「文件预览」「画布节点预览」两类，画布上没有任何常驻浮层能力。

## Task

以插件形态交付一个画布顶部可拖动的 ComfyUI 状态栏，显示 CPU / 内存 / 显存 / GPU / 温度 / 功耗 / 队列 / 版本，支持配置显示项与多个监控地址，且在没有采集脚本时不能伪造指标。

## Action

1. **扩展系统扩展类型**：`ExtResource` 拆出 `DocumentExtResource`（file/canvasNode）与 `{ kind: "canvasOverlay" }`；`ExtContext` 泛型化，默认仍是文档资源，既有 5 个扩展包零改动。服务端 `metadataSchema` 放开 `canvasOverlay`，并对其配置**整体放行**（configRules 过滤会把浮层的开放式配置清成 `{}`），读写都限制在 64 KB。
2. **浮层宿主**：新增 `canvas/overlayHost.vue`，挂在 `canvasHost` 且 `v-if="active"`，避免每个画布实例各挂一份；只监听 `toonflow:ext-updated`（配置保存事件会导致反复重建）；上下文用报错桩替代文件 API。
3. **监控代理**：`GET /api/monitor/status?url=`，只允许本机调用、禁凭据/查询串/重定向、边读边限 256 KB；先试采集脚本 `/toonflow/metrics`（1.5 s），失败回退 `/system_stats` + `/queue`，统一归一化并显式下发 `missing`；按地址做 1.5 s 缓存与在途复用。英文运行时错误翻译成可操作提示。
4. **插件本体** `packages/ext/comfyMonitor`：canvasOverlay 类型；拖动（pointer capture + 容器夹取 + 位置持久化）、折叠、目标列表增删切换、刷新间隔、显示项开关、复制采集脚本；缺指标置灰、离线红点 + 「离线」chip。
5. **采集脚本** `sidecar/toonflow_metrics.py`：放进 ComfyUI `custom_nodes` 即可，psutil 拿 CPU/内存、pynvml 拿 GPU 利用率/显存/温度/功耗、`PromptServer.prompt_queue` 拿队列、`comfyui_version` 拿版本；缺依赖降级为 null，不影响 ComfyUI。

## Result

- 纯 ComfyUI 目标：内存、显存、队列、版本可用，CPU/GPU/温度/功耗显示「不可用」。
- 装采集脚本后：全部指标可用。
- 拖动位置、显示项、折叠状态、目标与刷新间隔落盘，刷新页面保持。
- 服务端路由经 curl 覆盖成功/回退/不可达/非法地址/非本机五种路径；画布 UI 经 chrome-devtools 实测渲染、拖动、折叠、切换目标、离线态。
- 已重建 web / server bundle / ext 并重打包 `/Applications/toonflow-exec.app`（备份 `/tmp/toonflow-exec-old8.app`），插件同时装到 `Resources/app/ext` 与 `data/ext`。
- 边界：监控接口只对本机开放；内网任意地址可探测属产品需求；浮层位置按像素保存，窗口大幅缩放时只夹取不缩放。

## 增量（清理显存）

- **S**：状态栏只能看，不能动；显存被模型占满时得回 ComfyUI 页面手动清理。
- **T**：加一个「清理显存」按钮，并让温度和功耗的标签说清楚是 GPU 的。
- **A**：新增 `POST /api/monitor/free` 代理 ComfyUI `/free`（源码里它只设置队列 flag，由执行线程在任务结束后消费，所以不会打断生成）；把状态缓存抽到 `utils/monitor.ts` 并在清理后立即失效；插件按钮带加载态、队列非空提示、清理前后显存对比提示；标签改为 GPU 利用率/GPU 温度/GPU 功耗，图标换成 tabler。
- **R**：点一下 20 GB → 1 GB，提示「已释放 19.0 GB」；缓存 1.5 s 内即刷新；旧包备份 `/tmp/toonflow-exec-old9.app`。
