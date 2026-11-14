# 记忆：桌面应用无窗口——桌面入口被 server 构建覆盖

- 时间：2026-11-14 11:45
- 类型：Bug 修复（部署流程）

## STAR

**Situation（背景）**
用户点击 Dock 的 toonflow 后没有窗口：进程在、服务端口在监听，但首页 404、`/api/nodes/get` 返回空，CoreGraphics 窗口列表里没有主窗口。

**Task（任务）**
恢复桌面应用启动，并防止再次把服务端构建覆盖到桌面入口。

**Action（行动）**
- 对比入口体积与标记：`Resources/app/bun/index.js` 23,338,356 B，与 `build/server/index.js` 完全一致，且不含 `BrowserWindow`；同目录 `.bak.202611131833`（17,839,323 B）含 2 处 `BrowserWindow`。
- 结论：11/13 18:33 部署「服务端包」时，把 server 构建覆盖了桌面入口。桌面主窗口由 `apps/desktop/src/index.ts` 创建（`hidden: Boolean(splash)`，前端 `desktop.ready()` 后才 `show()`），入口缺失后页面无法加载、`ready()` 不触发、窗口永远隐藏。
- 用 `bun run build:desktop` 重新构建，从自解压安装器的 `Resources/<hash>.tar.zst` 解出真实负载，取回 `app/bun/index.js`（17.8 MB）覆盖入口；同时把两个视频节点 UMD 的内置副本更新为当前构建。
- 保持 `version.json` 与 `data/nodes/initialized` 的 `2nv546dkpsgay` 不变，避免触发内置插件同步覆盖 `data/nodes` 里的新包。
- 验证：主窗口 2584×1454 出现，首页正常渲染，用户数据与节点文件未变。

**Result（结果）**
应用恢复正常启动；宫格节点改动仍在。新增部署约束：桌面入口必须来自桌面构建负载，`grep -c BrowserWindow` 必须非 0。

## 关键经验

1. **服务端构建 ≠ 桌面入口**：桌面应用的 `app/bun/index.js` 是 `apps/desktop/src/index.ts` 的完整构建（含 Electrobun 窗口逻辑），`build/server/index.js` 只有 `createApp`。覆盖它会让应用"服务正常、窗口永不出现"。
2. **静默失败的特征**：进程活着、日志有「服务启动成功」、API 可用，但静态根 404、无主窗口——看到这组组合先怀疑入口/静态根，而不是窗口系统。
3. **旧进程会掩盖部署错误**：错误文件在 18:33 写入，旧进程在内存中继续跑，直到下次重启才暴露。部署后应主动做一次冷启动验证。
4. 覆盖安装包内的文件会破坏签名；本机 dev 构建可运行，但仍应尽量用构建负载整体同步，而不是零散覆盖。
