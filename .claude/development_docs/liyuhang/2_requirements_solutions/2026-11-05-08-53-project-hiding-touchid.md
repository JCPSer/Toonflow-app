# 需求方案：项目隐藏（Touch ID 验证）

- 时间：2026-11-05 08:53
- 对应需求：`../1_requirements_matrix/2026-11-05-08-53-project-hiding-touchid.md`
- 状态：待评审

## 1. 背景与目标

桌面应用要能给别人演示：把隐私项目标记为隐藏后，桌面端项目列表、画布项目下拉、素材库项目分组等所有入口都不显示；解锁需要 macOS 系统验证（Touch ID，可回落登录密码），且重启后自动锁定。

隐藏是**展示层**能力：项目目录与文件仍在磁盘上，Finder 能直接看到，不做加密（已在需求中与用户确认）。

## 2. 总体结构

```
首页锁图标 / 设置开关
   │  (点击)
   ▼
web: lib/projectPrivacy.ts  ── 调 ──►  lib/desktopAuth.ts（两段式轮询）
                                          │ POST /api/desktop/auth  + GET ?id=
                                          ▼
                                   server: routes/desktop/auth.ts
                                          │ 复用 dialogSessions
                                          ▼
                                   desktop runtime.authenticate(reason)
                                          │ bun:ffi JSCallback
                                          ▼
                                   libToonflowAuth.dylib（LAContext）
                                          │ 系统弹窗：Touch ID / 输入密码
                                          ▼
                                      回调 int code
```

- 解锁状态只存在 web 端内存（`ref`），不写 settings，不进 localStorage，因此重启必然回到锁定态。
- 项目列表的 `hidden` 标记写进现有 `toonflow.projectList`（`data/settings.json`），随现有持久化链路保存。

## 3. 原生层

### 3.1 `apps/desktop/native/auth.m` → `build/desktop/mac/libToonflowAuth.dylib`

- `tnf_auth_available()`：返回 0 有生物识别 / 1 只能密码 / 2 不可用（仅用于兜底提示，不决定是否验证）。
- `tnf_authenticate(const char *reason, void (*cb)(int))`：
  - 在后台队列创建 `LAContext`，`canEvaluatePolicy(LAPolicyDeviceOwnerAuthentication)` 不通过直接回 2；
  - `evaluatePolicy` 的结果映射：成功 0；用户取消/系统取消 1；不可交互 4；其他失败 3；
  - 回调从非 JS 线程触发，Bun 侧必须用 `JSCallback({ threadsafe: true })` 接收（默认只允许同线程调用）。
- 用 `LAPolicyDeviceOwnerAuthentication`（而不是 `...WithBiometrics`）：没有 Touch ID 或识别失败时，系统弹窗自带「输入密码」回落。
- 进程身份：dylib 载入 Bun 主进程，系统弹窗归属于 Toonflow 应用本身。

### 3.2 构建

- 在现有 `apps/desktop/scripts/buildMacFolderPicker.mjs` 末尾追加编译 + `codesign --force --sign -`，产出与 activation dylib 同目录。
- `electrobun.config.ts` 已把 `build/desktop/mac` 整目录复制到 `Resources/app/mac`，无需改 copy 表。

### 3.3 主进程 `apps/desktop/src/index.ts`

- 仿照 `libToonflowActivation.dylib` 的 dlopen 写法加载；加载失败只记日志，功能降级为「不可用」。
- 新增 `authenticate(reason)`：返回 `Promise<{ok, code}>`；内部用 `threadsafe` 的 `JSCallback` 接收 code，4 分钟超时兜底（早于服务端会话 5 分钟 TTL）。
- 新增 `supportsAuthentication()`：调用 `tnf_auth_available()` 判断本机是否真的可用（无指纹且未设密码也算不可用）；不可用时前端禁止隐藏项目。
- 新增 `tnf_cancel()`：4 分钟超时主动 `invalidate()` 关闭系统弹窗；同进程同时只允许一个验证。
- 加入 `app.locals.desktop` 对象，类型补到 `apps/server/src/types/desktop.ts`。

## 4. 服务端

- 新路由 `apps/server/src/routes/desktop/auth.ts`，挂在 `/api/desktop/auth`：
  - `POST` body `{reason}`（1–120 字）→ 复用 `startDesktopDialog`，返回 `{id}`；
  - `GET ?id=` → `{done, value: "1"|"0", name: 原因码}`；
  - `GET` 不带 `id` → `{available: boolean}` 能力探测；
  - 非桌面运行：`getDesktopRuntime` 抛错，前端按「不支持」处理。
- 复用 dialogSessions 的原因：WKWebView 对无数据请求有 60 秒断流上限，验证弹窗可能被用户搁置；两段式轮询与现有目录选择器同构，且天然限制「同时只有一个原生弹窗」。

## 5. Web 端

### 5.1 状态 `apps/web/src/lib/projectPrivacy.ts`

- `hiddenUnlocked = ref(!isDesktop || isRemoteConnection)`：本机桌面默认锁定；浏览器/手机远程、以及桌面端连远端服务器（`remote=1`）默认视为已解锁（需求 R7）。
- `authSupported` + `refreshAuthSupport()`：探测本机是否具备系统验证能力，不具备时禁止隐藏。
- `useHiddenUnlocked()` 暴露：`unlocked`、`unlock()`（调验证）、`lock()`。
- 纯函数 `projectVisible(project, unlocked)`、`filterVisibleProjects(list, unlocked)` 便于单测。

### 5.2 首页 `pages/home/index.vue`

- 项目区标题右侧：
  - 锁定：一个锁图标按钮（tooltip「显示隐藏项目」），不带「隐藏」字样；
  - 解锁：`el-radio-group` 分段「项目 / 隐藏项目」+ 锁图标按钮（点击立即锁定）。
- 未解锁点击锁图标 → 验证；成功切到解锁态（停留在「项目」页），失败 `ElMessage.warning`。
- 锁图标/开关只在具备本机验证能力时出现；隐藏按钮在能力探测为 false 时禁用。
- 卡片新增第三颗悬停按钮：普通页为「隐藏」（斜杠眼睛），隐藏页为「取消隐藏」（眼睛）。
- 网格数据 = 按 tab 过滤后的项目；隐藏页排序沿用 `lastOpenedAt`。
- 锁定或非桌面时隐藏 tab 不参与渲染。

### 5.3 设置 → 隐私 `components/settings/panels/privacy.vue`

- 新 section「隐藏项目」：说明文字（仅桌面可用、需系统验证、重启自动锁定），右侧 `el-switch` 绑定 `unlocked`：
  - 打开 → `unlock()`，失败则开关回弹；
  - 关闭 → `lock()`。
- 非桌面（`!isDesktop`）不渲染该 section。

### 5.4 路由与外部入口

- `router.beforeEach`：进入 `/workspace` 时若当前项目是隐藏项目且未解锁，直接回首页并清空当前项目指针（页面不会先挂载）。
- 工作区页保留同名 watch 作为兜底（项目切换、解锁状态变化）。
- MCP `openProject` 指令同样拒绝锁定态的隐藏目录。

### 5.5 其他入口过滤（仅在桌面端锁定态）

| 位置 | 改法 |
| --- | --- |
| `canvasMenu.vue` `filteredProjects` | 计算时过滤 `hidden` |
| `pages/home/assetLibraryView.vue` 传入的 projects | 过滤后再传 |
| `components/settings/panels/deviceLink.vue` 默认目录 | **不过滤**（远程设备按 R7 可访问隐藏项目，过滤会破坏远程访问）；作为已知边界记录 |
| `lib/mcpControl.ts` 项目状态与 settings 快照 | 过滤列表项，并抹掉按隐藏目录命名的 store 键 |
| `pages/workspace/index.vue` 进入时 | 当前项目 hidden 且未解锁 → `router.replace("/home")` + 提示 |

过滤统一调用 `filterVisibleProjects`，避免各处重复判断。

## 6. 数据模型

```ts
type Project = { directory: string; name: string; lastOpenedAt: number; hidden?: boolean }
```

- `addProject` 重建对象时必须带过 `existing.hidden`，否则打开项目会丢标记（实现重点）。
- 服务端 MCP 的 `projectList` zod 会丢弃未知字段，不需要改 schema。

## 7. UI 草图

```
┌ 项目 ─────────────────────────  [项目|隐藏项目] 🔓  [导入工程…] ┐
│ ┌────────┐ ┌────────┐ ┌────────┐                              │
│ │ + 新建 │ │ 封面   │ │ 封面   │   ← 悬停显示 ✎ 🗑 👁‍🗨          │
│ └────────┘ └────────┘ └────────┘                              │
└────────────────────────────────────────────────────────────────┘

锁定态：┌ 项目 ───────────────────────── 🔒  [导入工程…] ┐
```

## 8. 边界与降级

1. 非 macOS/无 dylib：验证不可用 → 提示「当前环境不支持系统验证」，保持锁定。
2. 验证弹窗期间又点开关：服务端 409「已有验证正在进行」，前端提示等待。
3. 远程/手机：默认显示隐藏项目；设置里不出现该开关。
4. 隐藏项目文件夹被移除/不可达：与普通项目同样报打开失败；若在隐藏 tab，用户可取消隐藏或移除。
5. `hidden` 标记在 settings.json 明文可见；这是需求已确认的边界。
6. 设备连接的目录列表仍会显示隐藏项目路径：远程访问与「远程照常显示」一致，属于有意保留。

## 9. 发布影响

需要同时更新：web 静态资源、主进程包 `app/bun/index.js`、`app/mac/libToonflowAuth.dylib`。三者都进已安装应用后**必须重启应用**；由用户自行重启（不代关应用）。
本地安装包是 ad-hoc 签名（`Signature=adhoc`，无 Team ID），替换资源会破坏封印但不影响本机启动——与既有 rsync 部署方式一致；未做公证的门槛不适用。

## 10. 测试计划

- 单测：`filterVisibleProjects` / `projectVisible` 在解锁、锁定、非桌面、hidden 缺省四种组合下的行为；`addProject` 保留 hidden。
- 类型检查：`bun run typecheck`（web + desktop）。
- 构建：web build、desktop main bundle 构建、dylib 编译与 codesign 校验。
- 人工（重启后）：按需求文档第 2 节逐条走。

## 11. 评审意见

（待用户填写）

- 是否通过：
- 其他要求：
