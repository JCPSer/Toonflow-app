# Bug 修复方案：Agent 执行期全线超时 / 轮次跳转落点偏移 / 文本节点摘要丢失

- 记录时间：2026-10-29 14:10
- 对应分析：`bug_analysis-2026-10-29-14-10-agent-run-stall-turn-jump-text-summary.md`（v2）

---

## 第 0 步：先测，再改（B1 专用，必须先做）

B1 的分析结论是「机制方向已锁定为浏览器同源 6 连接耗尽（C4），但量级未实测」。**不做这一步就写修复代码，会有一半概率改错层。**

### 0.1 页面内探针（前端，一次性，可保留）

在 `apps/web/src/lib/netProbe.ts` 增加一个开发期可达的统计对象，挂到 `window.__toonflowNet`：

```
netProbe = {
  openStreams: Map<url, count>      // EventSource / fetch 长流登记
  inflight: number                  // 在飞 XHR/fetch
  queued: number                    // 已发起但 >200ms 未收到首字节
  peakInflight, peakQueued, lastReset
}
```

登记点（只有这几处，不侵入业务）：

- `apps/web/src/pages/workspace/panels/assetLibrary/useAssetLibrary.ts`（素材变更流）
- `apps/web/src/lib/providerBilling.ts`（余额 EventSource）
- 播放器 ffmpeg 提示组件（EventSource）
- `apps/web/src/components/agent/conversation.vue` 的 NDJSON 长流
- axios 全局请求拦截器（`apps/web/src/lib/i18n.ts` 已有一个 request 拦截器，在其中加计数与清尾）

### 0.2 复现录制

用 chrome-devtools 连本地应用，在**一个分支节点执行期间**录 Network：

1. 记录 `Connection ID` 分布：同源活跃连接是否恒为 6；
2. 看失败请求的 Timing：是 `Queued/Stalled`（→ C4 坐实）还是 `Waiting(TTFB)` 长（→ 服务端真慢，回到 C3 或新机制）；
3. 记录 `window.__toonflowNet` 的 `peakInflight / peakQueued / openStreams`。

### 0.3 判据

| 观测 | 结论 | 走哪套方案 |
| --- | --- | --- |
| 连接数恒 6 + 失败请求 `Queued/Stalled` | C4 成立 | 走 1A |
| TTFB 普遍 >1s，连接数 <6 | 服务端慢 | 走 1B |
| 两者都轻微 | 另一机制 | 停下来汇报，不带猜测改代码 |

---

## 1. B1 修复方案

### 1A 主选：收敛同源长连接（C4 成立时）

**目标**：任意时刻同源长连接 ≤ 2 条，且不随 Agent 节点数线性增长。

分四层，按收益排序：

1. **合并事件通道**：新增一条多路复用流 `/api/events`（NDJSON，带 `topic` 字段），把
   `assets/events`、余额变动、ffmpeg 进度三条 EventSource 合成 1 条。
   客户端侧保留原有 API 形状（`useAssetLibrary` 等仍订阅同一接口），只在内部换成 topic 过滤。
   → 长连接从 3 条降到 1 条。

2. **懒连接 + 可见性**：所有订阅在 `document.hidden` 或面板不可见时断开，恢复时重连并补一次全量拉取
   （沿用现有 `refresh()`）。
   → 后台态长连接归零。

3. **缩略图不占长连接**：缩略图请求加并发闸门（≤3），失败不重试；依赖 `Cache-Control` 让二次打开走缓存。
   → 避免 `<img>` 串打满。

4. **Agent NDJSON 保持每节点 1 条**（必要），停止/结束时确保连接关闭
   （`conversation.vue` 的 `finally` 已有 abort，补一条连接计数校验）。

**兜底（仅当实测仍有 >6 需求）**：桌面网关再开一个本地端口专供媒体（缩略图/预览/下载），
让大流量媒体绕开 6 条同源上限。这是结构性解法，改动集中在 `apps/desktop/src/connection.ts` 与
`apps/web/src/pages/workspace/panels/assetLibrary/api.ts` 的 URL 拼接，不动业务逻辑。

### 1B 备选：削服务端尖峰（TTFB 长时）

1. `message_end` 的 `getAgentStats/getAgentContext` 从同步全量改为增量累加（`runtime/index.ts:395-397`）。
2. `_persist` 的 `appendFileSync` 改为按消息批异步追加（SDK 侧不可改时的替代：包一层写队列）。
3. NDJSON 事件加节流（同一 blockId 合并到 1 帧）。
   → 把单次尖峰从「几十~几百毫秒」压到「个位数毫秒」。

### 1C 可观测性（无论走 1A 还是 1B 都做）

- 服务端加事件循环延迟探针：50ms 定时器测漂移，>500ms 记一条 `[eventloop] lag=…ms`。
- 请求级慢日志：>1s 的请求记 `[slow] method path ms`。
- 前端在「工具界面加载失败」的提示里带上 `rendererError` 的原始文案与时间，便于下次定位。

---

## 2. B2 修复方案：跳转后按真实 DOM 收敛

### 2.1 设计

```
jumpToTurn(index):
  1. atLatestMessage = false
  2. virtualizer.scrollToIndex(index, {align:"start"})     // 先粗跳，保证目标行进入渲染窗口
  3. 收敛循环（最多 3 次）:
       await nextTick() + requestAnimationFrame
       row = querySelector(`[data-message-id="<id>"]`)
       若无 row → 用 getOffsetForIndex(index) 调 scrollToOffset 后再试一次
       delta = row.getBoundingClientRect().top - container.getBoundingClientRect().top
       if |delta| <= 2 → 结束
       container.scrollTop += delta
  4. atLatestMessage = virtualizer.isAtEnd()
```

### 2.2 关键取舍

- **用 `getBoundingClientRect` 而不是 `offsetTop`**：行是绝对定位 + `transform: translateY()`，`offsetTop` 不反映实际位置。
- **不关闭 `anchorTo: "end"`**：它只影响贴底场景，关掉会破坏「回到最新消息」。
- **收敛期间保持 `atLatestMessage=false`**：否则实时行测量会把视图拉回底部（`messageList.vue:212-217`）。
- **上限 3 次**：库自身的 reconcile 上限是 5s，我们的循环在 3 帧内结束，不与之冲突；若 3 次后仍有偏差，说明行高还在变（图片加载），接受当前结果并停止（不无限追）。

### 2.3 验收

点第 2/5/N-1 轮，读 `data-message-id` 行的 `rect.top - 容器 top`，应 ≤ 2px；再等 1 秒复测不变。

---

## 3. B3 修复方案：正文前 150 字摘要

### 3.1 单一常量

`mentionSources.ts` 引入 `export const mentionPreviewLength = 150`，替换现有 `previewLength = 200`；
提示词文案（`runtime/mentions.ts:77`）同步改为「预览最多 150 字」。

### 3.2 引用带摘要

`createCanvasMention(node, canvasId, outputId, options?)`：

- 文本输出若走 `textPath`，在保留 `{ path, mimeType }` 的同时补 `summary`：
  - 优先 `data.textSnapshot`；
  - 否则用注入的 `readText` 读正文，取**压平空白后的前 150 字**；
  - 读失败/超限 → `summary` 省略，不抛错（引用仍可用）。
- 两条调用链都要传 reader：
  - 实时画布：`canvasHost.vue:481-488` 传入 `useWorkspaceFiles(directory).readText`
  - 服务端离线：`mentionFiles.ts:98-103` 传入 `readMentionText(directory, path)`

### 3.3 展示

`mentionContent.vue`：

- 文本引用（`value.summary` 存在）→ 渲染摘要，并在下方注明「完整内容由助手按路径读取」。
- `dataType === "NODE"` → 渲染 `value.upstream` 列表（每条 `targetHandleName` + 150 字 `preview`），
  替换现在那句「节点引用含节点身份与直接上游摘要（最多 200 字预览）」的空说明。

### 3.4 边界

| 情况 | 行为 |
| --- | --- |
| 正文为空 | 摘要空串，引用仍可用 |
| 正文 > 400000 字节 / 100000 字符 | 摘要省略，`path` 保留 |
| 文件读失败 | 摘要省略，不阻断发送 |
| `data.textSnapshot` 存在 | 直接用快照，不读盘 |

---

## 4. 实施顺序与验收

| 阶段 | 内容 | 验收 |
| --- | --- | --- |
| S0 | B1 探针 + 一次复现录制 | 得到"连接数 / Queued vs TTFB"结论，写进测试结果 |
| S1 | B2 跳转收敛 | 多点几轮，误差 ≤2px；贴底/回到最新不回退 |
| S2 | B3 摘要 | 文本引用带 150 字；气泡可见；超限/失败不阻断 |
| S3 | B1 修复（按 S0 结论选 1A/1B） | 执行期间其它接口 P95 <1s，不再出现全线超时 |
| S4 | 子 agent 代码审查 + 部署验证 | 按 `rule_bugfix.md` 归档 |

> S0 未出结论前不动 B1 代码。

---

## 五、评审意见（用户填写）

> 评审人：
> 结论：通过 / 驳回
> 意见：

---

## 六、评审意见（子 agent 初审）

> 评审人：
> 结论：
> 意见：
