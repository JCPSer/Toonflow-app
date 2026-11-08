# Bug 方案：视频重新生成后首尾帧仍显示上一版视频

- 时间：2026-11-03 01:17
- 对应分析：`bug_analysis-2026-11-03-01-17-video-frame-thumbnail-stale.md`

## 1. 目标

同路径覆写的文件（典型：首尾帧 `frame-first.jpg` / `frame-last.jpg`）被改写后，所有展示该缩略图的位置立刻显示新内容；同时不牺牲未变化时的缓存收益。

## 2. 方案设计

### 2.1 B1：缩略图 URL 带文件版本号（前端）

```
模块级：versions: Map<"<目录>\0<路径>", number>

invalidateUrls(directory, path):
    清掉 fileUrls 里该路径（含子路径）的 blob 缓存   // 现有行为
    versions[key(目录, 路径)] += 1                    // 新增：即使没有 blob 缓存也计数

thumbUrl(path, size):
    url = /api/workspaces/files/thumb?directory&path&size   // 现有
    返回 url + "&v=" + (versions[key] ?? 0)                 // 新增
```

要点：

- 触发点沿用 `write` / `writeTextSnapshot` / `rename` / `copy` / `remove` 已有的 `invalidateUrls` 调用，不改任何业务代码。首尾帧的 `remove + rename` 天然各触发一次，版本号在输出值写回之前就已递增。
- 键做与 `cachePath` 相同的规范化（统一分隔符、小写），两条大小写不同的路径最多多做一次请求，不会读到旧图。
- 服务端 `validateFields` 用的是非严格 `z.object`，多余的 `v` 参数会被忽略，**路由参数校验不用改**。
- 版本号只活在当前会话：重启后归零、URL 回到 v=0；这正是需要 2.2 兜底的原因。

### 2.2 B2：缩略图响应改为可协商（服务端）

```
/api/workspaces/files/thumb 响应头：
- Cache-Control: private, max-age=31536000, immutable
+ Cache-Control: private, no-cache
  ETag: 已有（含源文件 mtimeMs）
  If-None-Match 命中 → 304（已有实现）
```

- 文件没变：一次本地 304，体量极小。
- 文件变了（mtime 变）：ETag 不匹配 → 200 + 新图。
- 重启/换客户端后 URL 即使相同，也会回源校验，不会停在旧图。
- `/api/assets/thumb` 不动。

### 2.3 为什么不选「首尾帧用唯一文件名」

每次抽帧写新文件名虽然能绕开全部缓存，但节点目录会无限累积旧帧（现有策略为避免破坏撤销/复制而不删文件），且只解决首尾帧一处，其它同路径覆写仍会复发。

## 3. 影响面

| 文件 | 改动 |
| --- | --- |
| `apps/web/src/lib/workspaceFiles.ts` | 版本表 + `invalidateUrls` 递增 + `thumbUrl` 追加 `&v=` |
| `apps/server/src/routes/workspaces/files/thumb.ts` | 响应头改 `no-cache` |
| 新增 `apps/web/src/lib/fileVersions.ts` + 测试 | 抽出纯函数便于单测 |

不改节点包，不需要重编 `*.umd.js`；web 需重新构建同步，server 需重编 `bun/index.js`。

## 4. 验证

1. 单测：版本号按路径独立递增、大小写/分隔符归一、未变更时返回 0。
2. `bun test` 全量通过；web `vue-tsc --noEmit` 仅剩既有 `@/agentRuntime` 报错。
3. 人工：重新生成视频 → 输出项下拉与下游引用卡都显示新帧；不重新生成时反复开关画布不触发重复生成缩略图。

## 5. 评审意见

用户选型确认：no-cache + 前端 URL 版本号；素材库缩略图路由不改。

## 6. 已知边界（评审 P2，本次不处理）

1. **版本表不是响应式的**：主链路（输出项下拉、下游引用卡）靠 `writeValue` 换新值对象触发 computed 重算，成立。以下路径不刷新：同项目复制节点不搬文件，副本与源节点共用 `assets/<源节点id>/frame-*.jpg`，源节点重新生成后副本卡片不会重算；同工程开第二个窗口时版本表各自从 0 开始。
2. **服务端缓存键只看 mtime**：`(realpath, edge, size, mtimeMs)`。抽帧是「新临时文件 rename」，mtime 必然前进，所以本路径安全；但任何保留 mtime 的原地覆写（外部工具、`cp -p`、同步盘回写）仍会命中旧缩略图。
3. **版本表无界增长**：一次抽帧会产生 target 两次 bump 与一个临时文件键；条目数随本次会话写过的路径数增长，无淘汰。单条极小，暂不处理。
4. **测试只覆盖纯函数**：`invalidateUrls→bump`、`thumbUrl→带 v` 的接线没有断言。
5. **`no-cache` 的代价按本机估算**：远程连接/移动端每张缩略图会多一次网络往返，尚未实测。
