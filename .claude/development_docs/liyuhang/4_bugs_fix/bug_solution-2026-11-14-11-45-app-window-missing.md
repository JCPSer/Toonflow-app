# Bug 修复方案：恢复桌面入口与主窗口

- 时间：2026-11-14 11:45
- 对应分析：`bug_analysis-2026-11-14-11-45-app-window-missing.md`
- 状态：已实施并验证

## 1. 修复原则

不要在旧的错误文件上继续打补丁：桌面入口必须是 `apps/desktop/src/index.ts` 的完整构建（含服务端 + 窗口逻辑），不能拿 `build/server/index.js` 替代。用当前源码重新构建桌面应用，从构建产物的真实负载里取回正确的入口。

## 2. 步骤

```text
1) bun run build:desktop
   → build/desktop/app/stable-macos-arm64/toonflow.app（自解压安装器）
   → Resources/<hash>.tar.zst 内是真实 app 负载（扁平布局）

2) 解出负载到临时目录
   tar --zstd -xf <hash>.tar.zst → /tmp/toonflow-payload/toonflow.app

3) 备份并替换桌面入口
   Resources/app/bun/index.js  ← 负载的 app/bun/index.js（17.8 MB，含 BrowserWindow）
   原 server 构建备份为 index.js.serverbuild.<时间戳>

4) 同步内置节点副本
   Resources/app/nodes/videoNode.umd.js、videoGenerationNode.umd.js ← 负载中的同名文件
   （负载由当前源码构建，已包含今天的宫格改动；内置目录与 data/nodes 各留一份最新）

5) 不替换 version.json / data/nodes/initialized
   两者都是 2nv546dkpsgay，保持版本一致，避免启动时触发内置插件同步覆盖 data/nodes。

6) open -a /Applications/toonflow-exec.app 验证
```

## 3. 验证

| 项 | 结果 |
| --- | --- |
| 进程 | launcher + bun 存在 |
| CoreGraphics 窗口 | `owner=toonflow-exec 2584×1454`，主窗口存在 |
| 首页渲染 | 截图确认侧栏、项目卡片、探索区正常 |
| 服务端口 | 随机高位端口监听（非固定 3000） |
| 用户数据 | `data/nodes/initialized=2nv546dkpsgay` 未变，节点文件时间仍为 11:27 |

## 4. 后续约束（写进记忆）

- 部署「服务端」到桌面应用时，只能通过桌面构建产物的负载同步整个 `app/bun`，禁止把 `build/server/index.js` 覆盖到 `Resources/app/bun/index.js`。
- 桌面入口构建完成后可核对一行：`grep -c BrowserWindow Resources/app/bun/index.js` 必须非 0。
- 若只更新 web/节点，不需要动桌面入口。

## 5. 评审意见

（待填写）

- 是否通过：
- 其他要求：
