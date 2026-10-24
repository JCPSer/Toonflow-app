# 方案：ComfyUI 状态浮层插件

对应需求：`1_requirements_matrix/2026-10-24-17-47-comfyui-status-overlay.md`

## 一、分层

```
ComfyUI 主机
 ├─ /system_stats /queue          （官方，默认可用）
 └─ /toonflow/metrics             （可选，采集脚本，psutil+pynvml）
            ▲
            │ 服务端代取（绕开 CORS、统一超时）
Toonflow 服务端  GET /api/monitor/status?url=...
            ▲
            │ 相对路径 fetch
画布浮层插件 ext-comfyMonitor（canvasOverlay 类型）
```

## 二、扩展系统：新增 `canvasOverlay`

| 位置 | 改动 |
| --- | --- |
| `packages/extScaffold/src/runtime.ts` | `ExtResource` 增加 `{ kind: "canvasOverlay" }`；`defineExt` 允许该 kind，且不要求 `extensions`；`ExtContext.files` 改为可选（浮层不碰工作区文件） |
| `apps/server/src/utils/plugins/ext.ts` | `resourceKind` 枚举加 `canvasOverlay`；文件型仍强制至少一个后缀 |
| `apps/web/src/pages/workspace/panels/document/extensions.ts` | 导出 `loadExtension`（供浮层宿主复用），`extensionCandidates` 只接受 file/canvasNode 资源（浮层不走这里） |
| 新增 `apps/web/src/pages/workspace/panels/canvas/overlayHost.vue` | 取 `resourceKind === "canvasOverlay" && enabled && !loadError` 的扩展，逐个 `load()` 并渲染；容器 `pointer-events: none`，插件自身 `pointer-events: auto`；上下文由宿主构造 |
| `apps/web/src/pages/workspace/panels/canvas/index.vue` | 在 `.canvas` 内挂 `<overlayHost />`（vue-flow 之外，绝对定位最上层） |

浮层 `ExtContext` 构造：`resource = { kind: "canvasOverlay" }`、`files = 空实现（调用即报「浮层不支持文件操作」）`、`config` / `saveConfig` 复用 `extensionConfig` / `saveExtensionConfig`、`active` 恒为真。

## 三、监控代理

新增 `apps/server/src/routes/monitor/status.ts`（`bun src/core.ts` 重新生成 router）：

```
GET /api/monitor/status?url=<base>
  校验：http/https、无账号密码、长度上限
  ① GET base + /toonflow/metrics  （3 s）
  ② 失败则 GET base + /system_stats（3 s）+ /queue（2 s，可失败）
  归一化后返回；两端都失败 → 502 + error 文本
```

归一化结构（插件只认这个）：

```
{
  online: true,
  source: "sidecar" | "comfyui",
  metrics: { cpu, ram, vram, gpu, temperature, power, queue, version },  // 可用性标记
  system: { os, ramTotal, ramUsed, ramPercent, cpuPercent, cores, version },
  gpus: [{ index, name, type, vramTotal, vramUsed, vramPercent, util, temperature, power }],
  queue: { running, pending },
  missing: ["cpuPercent", "temperature", ...],
  error: ""
}
```

- `source: "comfyui"` 时 `missing` 自动包含 `cpuPercent/gpuUtil/temperature/power`，前端据此置灰。
- 响应加 `Cache-Control: no-store`；响应体超过 256 KiB 截断丢弃。

## 四、采集脚本

`packages/ext/comfyMonitor/sidecar/toonflow_metrics.py`，部署到 ComfyUI `custom_nodes/toonflow_metrics/__init__.py`（或直接单文件 + `__init__.py` 引用）。

```
import psutil?  pynvml?
@PromptServer.instance.routes.get("/toonflow/metrics")
  → { cpu:{percent,cores,freqMhz}, ram:{total,used,percent},
      gpus:[{index,name,util,memoryTotal,memoryUsed,temperature,power}],
      queue:{running,pending}, platform, ts }
```

- 缺 psutil/pynvml 时对应字段为 null，并返回 `missing: [...]`，不抛错。
- 队列直接从 `PromptServer.instance.prompt_queue.get_current_queue_volatile()` 取长度。
- 脚本同时内嵌在插件「复制采集脚本」按钮里，用户不必找仓库。

## 五、插件本体 `packages/ext/comfyMonitor`

metadata：`id: "ext-comfyMonitor"`、`resourceKind: "canvasOverlay"`、`extensions: []`、无 configRules（配置全部在浮层内编辑）。

配置结构（存插件配置）：

```
{
  targets: [{ id, label, url }],
  active: id,
  interval: 3000,
  position: { x, y },
  collapsed: false,
  items: { cpu, ram, vram, gpu, temperature, power, queue, version }  // 布尔
}
```

UI：

```
┌────────────────────────────────────────────────────────────┐
│ ⣿  ● 本地 · 192.168.2.6   CPU 42% ▮▮▮▯▯  RAM 12.3/32G      │
│ VRAM 8.1/24G 34%  GPU 78%  62°C  210W  队列 1/3   ⚙  ▾     │
└────────────────────────────────────────────────────────────┘
```

- 拖动手柄（左侧 ⣿），位置按容器百分比存，窗口尺寸变化不跑出边界。
- 齿轮弹出设置：目标列表增删改、当前目标、刷新间隔、显示项复选、复制采集脚本。
- 折叠后只剩状态点 + 当前目标名，点开展开。
- 无采集脚本时 CPU/GPU/温度/功耗标灰并加 title「需要安装采集脚本」。
- 目标离线：红点 + 「离线」，title 显示服务端返回的错误。

## 六、改动清单

| # | 文件 | 改动 |
| --- | --- | --- |
| 1 | `packages/extScaffold/src/runtime.ts` | 新 kind、`files` 可选、校验放宽 |
| 2 | `apps/server/src/utils/plugins/ext.ts` | 枚举加 `canvasOverlay` |
| 3 | `apps/server/src/routes/monitor/status.ts` | 新增代理与归一化 |
| 4 | `apps/server/src/router.ts` | 自动重新生成 |
| 5 | `apps/web/.../document/extensions.ts` | 导出 `loadExtension` |
| 6 | `apps/web/.../canvas/overlayHost.vue` | 新增浮层宿主 |
| 7 | `apps/web/.../canvas/index.vue` | 挂载宿主 |
| 8 | `packages/ext/comfyMonitor/**` | 插件本体 + 采集脚本 + readme |
| 9 | `package.json` workspaces | 已在 `packages/ext/*`，无需改 |

## 七、构建与交付

1. `NODE_ENV=production bun run build:ext` → `build/ext/ext-comfyMonitor.umd.js`。
2. 复制到 `/Applications/data/ext/`（用户数据目录，插件市场可见）与 `Resources/app/ext/`（内置）。
3. 重新构建 web / server，重打包 app。

## 八、测试方案

| 层 | 用例 |
| --- | --- |
| 代理 | 本地起假 ComfyUI（有/无 sidecar 两种），校验归一化、超时、404 回退、非法 URL 拒绝 |
| 采集脚本 | 本机用 `python3 -c` 直接跑一次函数体（无 ComfyUI 时用 stub 注册），校验 JSON 结构；缺 pynvml 时降级 |
| 插件加载 | `/api/ext/list` 返回 `resourceKind: canvasOverlay`；画布渲染浮层 |
| 交互 | 拖动后刷新页面位置保持；显示项开关生效；折叠；多目标切换；离线态与缺指标置灰 |
| 打包 | app 内 `data/ext` 与 `Resources/app/ext` 均存在插件，重启后可见 |

## 九、评审意见

> 待用户填写

| 评审人 | 结论 | 意见 |
| --- | --- | --- |
| 子 agent（初评） | | |
| 用户 | | |
