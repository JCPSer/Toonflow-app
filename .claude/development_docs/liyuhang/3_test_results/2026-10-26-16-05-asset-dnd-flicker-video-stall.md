# 测试结果：上一级拖拽 / 上传不闪 / 视频单播 / 文本流式节流

日期：2026-10-26 16:05
环境：dev（vite :5173 + bun :3121），Chrome DevTools MCP 实机操作，仓库 libproj 测试工作区

## 一、「上一级」卡片拖拽

| 用例 | 操作 | 结果 |
| --- | --- | --- |
| 目录拖到「上一级」 | 在 `dndtest/` 新建 `child`，构造 dragstart → dragover → drop | 卡片出现 `dropTarget` 高亮、`opacity` 0.75→1；drop 后磁盘上出现 `/assets/child`，当前目录列表不再包含它 |
| 二次验证 | 新建 `child2` 重复同一流程 | 同上，`/assets/child2` 到位 |
| 重复触发 | 观察请求与目录结果 | 只移动一次，没有「卡片 + 空白区」双发 |

说明：用合成 `DragEvent + DataTransfer` 走的是组件真实监听（`dragstart` 会写模块级 `activeAssetDrag`），不是直接调用内部函数。

## 二、上传后目录树不再重建 + 计数实时

| 用例 | 操作 | 结果 |
| --- | --- | --- |
| 上传单个文件 | 通过隐藏 `input.fileInput` 提交 `flicker.png` | 上传成功（`dndtest/` 出现文件）；`el-tree` DOM 实例前后同一（`sameTreeInstance: true`） |
| 计数实时 | 再传 `flicker2.png` | 树行 `dndtest` 计数 1 → 2，就地更新，无重建 |
| 外部改动补刷 | 磁盘直接 `mkdir extdir` | 约 3 s 后出现在树里（trailing 重建生效） |
| 观察窗口 | 每次上传后等 4 s | 期间没有第二次整树重建 |

首版实现（只写 `treeRefreshAt`）实测仍有 1 次延迟 2 s 的重建（trailing 触发），已改为 `treeSuppressedUntil = now + 2500`，上传后 2.5 s 内连补刷一起跳过，复测通过。

## 三、视频单播协调器

用两段 data-URL mp4 在页面内创建两个 `<video>`：

```
{ firstPlaying: true, afterSecond: { v1: true(paused), v2: false } }
```

即第二个开始播放时第一个被自动暂停。协调器是 `main.ts` 安装的文档级捕获监听，覆盖画布节点、素材库预览、历史记录等所有原生播放器；`data-concurrent="on"` 可豁免。

## 四、文本节点流式节流（代码层验证）

- 构建产物中确认存在自适应节流常量（`400:200`），`build/nodes/textNode.umd.js` 已同步到 dev 数据目录与 app。
- 未做实机长文生成：当前测试环境没有可用模型供应商，留待有模型时验证「帧率/长任务」与「无 delta 失败不覆盖正文」两条。

## 五、构建与检查

- `apps/web` `vue-tsc` 通过；`apps/web` build 通过。
- `apps/server` `tsc` 通过（本轮无服务端改动）。
- `bun run build:nodes` 通过，`textNode.umd.js` 已同步。
- 桌面入口重新打包并安装到 `/Applications/toonflow-exec.app`。

## 五之二、代码审查后的加固与复测

审查确认无阻塞问题，按建议补了 6 处，并全部复测：

| 加固 | 复测结果 |
| --- | --- |
| `countExtra` 的 key 改为树节点身份（`library:path` / `library:directory:path`），并在 `treeVersion` 变化时统一清空 | 上传后计数就地 4→5，跨库不会串 |
| `refreshTree()` 清理挂起的 trailing 计时器 | 主动刷新不再触发二次重建 |
| `pauseMediaIn` 支持 `{audio:false}` 且遵守 `data-concurrent`；扫码摄像头加 `data-concurrent="on"`；隐藏窗口只停视频 | 两段视频互斥仍生效 |
| 文本节点：`result.text` 为空且无 delta 时不覆盖正文；`streamClosed` 忽略迟到回调；卸载清计时器 | 构建产物确认包含 |
| `canDropHere/canHighlightTarget` 合并为 `canDropOn`；跨库 drop 分支改为静默；高亮键改为 NUL 前缀 | 拖拽复测：高亮出现、`k1` 成功上移 |
| 上传抑制改为「按目录」判定：只有事件目录全部落在上传目标（含其祖先，如库根）时才跳过树重建 | 实测日志显示上传会同时产生 `move1` 与根 `""` 两个目录事件；改为祖先感知后 `el-tree` 实例不再变化，外部新建目录约 3 s 仍能补刷出来 |

排查过程：首版按 `pendingDirs ⊆ suppressDirs` 判断，实测上传仍重建一次；加临时日志后发现根目录也会收到事件，加入祖先判定后通过。日志已删除。

## 六、未覆盖

1. 真实模型下文本节点生成期间的帧率与画布卡死复现（需要可用模型 + 视频节点组合）。
2. 素材库预览弹窗播放时画布视频暂停的联动手测（协调器逻辑已用两段视频验证）。
3. Finder 文件拖到「上一级」的上传行为回归（代码路径明确为放行冒泡，未手测）。
