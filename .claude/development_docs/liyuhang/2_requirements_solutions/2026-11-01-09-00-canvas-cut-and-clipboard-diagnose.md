# 需求方案：画布 ⌘X 剪切 + 剪贴板复制失败诊断

- 时间：2026-11-01 09:00
- 对应需求：`1_requirements_matrix/2026-11-01-09-00-canvas-cut-and-clipboard-diagnose.md`
- 代码基线：`feat/exec-node`

## 1. 方案总览

### 1.1 ⌘X 剪切

不新增第二套删除逻辑，复用现有「复制节点」和「删除选区」两条链路：

```
⌘X（keydown 或原生 cut 事件）
  → 守卫：画布/面板语境、有选中节点、没有文本选区、至少一个可删除
  → copySelectedNodes()（改为返回 boolean）
      ├─ false：提示失败原因，节点不动
      └─ true：
          → 用入口快照的选区删除
          → canvasHistory.batch(() => menu.deleteSelection(入口选区))
          → 一次撤销即可恢复
```

关键点：

- **原子性靠顺序而不是事务**：复制成功才删；复制失败直接返回，节点保留。
- **删除范围与复制范围一致**：删除传入口快照选中的节点对象，不在复制结束后重读当前选区。复制期间用户点了别的节点时，剪贴板里是 A、被删的也必须是 A；`deleteSelection` 会跳过已经消失的节点。
- **复制结果必须可判定**：`copySelectedNodes` 原来吞掉异常、返回 void，剪切无法知道成败；改为返回 `Promise<boolean>`，原有调用方忽略返回值，行为不变；另加 `silent` 参数让剪切不弹「已复制图片」。
- **撤销**：删除走 `canvasHistory.batch`，与 Delete 键一致，⌘Z 恢复。
- **图片节点**：沿用 `copyImageNodeToClipboard` 分支，复制图片成功后再删除。
- **不可删除节点**：至少一个可删除才进入；实际删除仍由 `menu.deleteSelection` 过滤 `deletable === false`，并在分组含不可删子节点时给出原有错误。
- **竞态**：`cuttingNodes` 防止连续触发；同时检查 `copyingNodes`，避免与 ⌘C 并发写同一份剪贴板。

### 1.2 触发入口

| 入口 | 处理 |
| --- | --- |
| 画布 keydown | 快捷键 action 增加 `cut`；`event.preventDefault()` 后调用 `cutSelectedNodes` |
| 原生 cut 事件（菜单/WebView 命令） | `document` 上新增 `cut` 监听，守卫同 copy；`beforecut` 与 `beforecopy` 同一套判定 |
| 输入框/文本选区 | `canUseCanvasClipboard` 排除 input/textarea/contenteditable；keydown 的 `editing` 提前返回；`window.getSelection()` 非空时 copy/cut 都不拦截 |
| Agent 面板语境 | 面板白名单从 `copy/paste/delete` 扩为 `copy/cut/paste/delete`；选文字时仍走原生 |

### 1.3 设置项

`defaultCanvasShortcuts` 增加 `cut: Meta+KeyX`（Windows 为 Ctrl+KeyX），`canvasShortcutFields` 增加「剪切到剪贴板」。旧配置没有该键时，`settings.ts` 的合并逻辑自动回落默认值，无需迁移。

## 2. 剪贴板假失败诊断

### 2.1 目标

先拿到「客户端认为失败」和「服务端实际写入」两侧的同一次请求记录，不猜根因。

### 2.2 链路

```
writeClipboardText()
  ├─ 生成 clipboardId（crypto.randomUUID）
  ├─ POST /api/desktop/clipboard/write，带 x-toonflow-clipboard-id
  │     ├─ 桌面桥拒绝 → lib/desktop.ts 记 desktop.request.rejected(reason, host/origin/referer/id/ua)
  │     └─ 进入路由 → 记 clipboard.write.request → done / error
  └─ 失败：POST /api/desktop/clipboard/diagnose { id, message, status, origin, href, ua, length, hasClipboard }
        → 记 clipboard.write.clientError
```

- 日志落在现有 `agent.log`（`agentLog`，best-effort，不影响业务）。
- **只记录正文长度，不记录正文**。
- `clipboardId` 把两侧记录串起来：如果服务端有 `request/done` 而客户端有 `clientError`，说明路由处理完成但响应丢失（`done` 只代表路由没抛错，原生 FFI 的返回值不在此处）；如果只有客户端记录、没有 request，说明请求没到服务端；如果只有 rejected，说明被同源/桌面头校验拦下。
- 诊断接口放在 `/api/desktop` 下，自动受同一套桌面同源校验保护；远程连接模式下加入 `nativePosts`，交给本机处理。

### 2.3 边界

- 诊断请求本身失败不重试、不弹提示。
- 非桌面端（浏览器/手机）不走该诊断，避免无意义请求。
- 诊断接口是临时排查设施，定位后移除（保留普通业务日志时再评估）。

## 3. 代码改动清单

| 文件 | 改动 |
| --- | --- |
| `apps/web/src/lib/canvasShortcuts.ts` | 默认快捷键与设置字段增加 cut |
| `apps/web/src/pages/workspace/panels/canvas/index.vue` | `copySelectedNodes` 返回 boolean；新增 `cutSelectedNodes`；cut/beforecut 监听；keydown 与面板白名单增加 cut |
| `apps/web/src/lib/clipboard.ts` | 写入请求带 id；失败上报诊断（不含正文） |
| `apps/server/src/lib/desktop.ts` | 桌面桥拒绝时记录原因与请求来源 |
| `apps/server/src/routes/desktop/clipboard/write.ts` | 记录 request/done/error |
| `apps/server/src/routes/desktop/clipboard/diagnose.ts` | 新增诊断上报路由 |
| `apps/server/src/router.ts` | 挂载诊断路由 |
| `apps/desktop/src/connection.ts` | 远程连接时诊断路径走本机 |

## 4. UI / 交互

- 设置 → 通用 → 快捷键新增一行「剪切到剪贴板」，默认 `⌘X` / `Ctrl+X`。
- 剪切成功不额外弹「已剪切」；复制失败沿用现有错误提示，节点不删。
- 剪切行为与右键菜单「删除」共用撤销批次，无新增视觉元素。

## 5. 测试计划

按 `AGENTS.md` 测试边界，不新增测试文件：

| 层级 | 内容 |
| --- | --- |
| 类型检查 | web / server / desktop 三个包 |
| 构建 | 根 `build` + 桌面入口打包，产物含 cut 与诊断标记 |
| 静态核对 | 剪切顺序、守卫、面板白名单、诊断字段不含正文、路由挂载 |
| 手动 | 重启后：⌘X 剪切/粘贴/撤销、复制失败保留、文本选区剪切、面板内剪切、设置改键；复现复制失败后读 `agent.log` |

## 6. 评审意见

| 评审人 | 结论 | 意见 |
| --- | --- | --- |
| 用户（Grill 问答） | 通过 | 见需求矩阵第 6 节。 |
| 子 Agent 代码审查 | 复核通过 | 首轮 2 条 P1（删除选区快照、router 生成物）+ 6 条 P2 已整改；第二轮复核逐项确认通过，仅留注释/文档级 P3 已同步修改。见 `3_test_results/2026-11-01-09-30-canvas-cut-and-clipboard-diagnose.md`。 |
