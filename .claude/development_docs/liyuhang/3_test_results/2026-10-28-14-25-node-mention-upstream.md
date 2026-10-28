# 测试结果：节点引用附带直接上游

日期：2026-10-28 14:25

## 一、静态检查

| 项目 | 结果 |
| --- | --- |
| `@toonflow/server` typecheck | 0 |
| `@toonflow/web` typecheck | 仍只有仓库既有报错 `apps/server/src/modules/agentAccess/singleAgent/types.ts(2,33): Cannot find module '@/agentRuntime'`（本轮改动后新加的连线映射无报错） |
| `@toonflow/web` build | 成功 |
| 节点包 build | 9 个包全部成功 |

## 二、接口验证（隔离实例 + 夹具画布）

夹具：`/tmp/tf4-data/workspaces/demo/画布1.json`，含 `img1 →(image→in) txt1 →(text→in) txt2` 两条边。

| 用例 | 期望 | 结果 |
| --- | --- | --- |
| `selectNode` 取 `txt2`（有入边） | `value.upstream[0]` 含目标端口名、来源节点名/类型、输出名、dataType、预览 | PASS：`targetHandleName:"文本输入"`、`nodeName:"文案"`、`nodeType:"remote-textNode"`、`outputName:"文本输出"`、`dataType:"STRING"` |
| 图片上游 | 带 `path` + `mimeType`，不带缩略图/内容 | PASS：`path:"assets/img1/a.png"`、`mimeType:"image/png"`、`preview:"a.png"` |
| 文本上游预览 | 压平空白、按 200 字截断并加省略号 | PASS：多行文本被压成单行，`len=201`（200 字 + `…`） |
| 无入边节点（`img1`） | `upstream: []`，不写 `truncated` | PASS |
| 25 条入边 | 只取 20 条且 `truncated: true` | PASS：`count=20`、`truncated=true`、序列化 4221 字节 |
| 旧 `value: null` 的节点引用 | 仍能通过 `agentMentionsSchema` | 代码核对：schema 对 NODE 的 value 只走 `isBoundedValue`，对象合法 |

## 三、构建与部署

- 前端与节点包已重建，桌面入口 23,560,970 B 已部署到 `/Applications`。

## 四、审查意见与修复（2026-10-28 15:10 补）

子 agent 代码审查结论：1 条重要问题、3 条建议，全部成立并已修。

| # | 问题 | 处置 |
| --- | --- | --- |
| 1 | 真实 textNode 写入画布时 `outputs` 被 `toJSON` 清空，正文只在 `textPath`；离线取上游时 `selected.value` 为 `undefined`，预览恒为「文本内容」，R2/R3 不达标。原夹具用内联 `value` 恰好绕过这条真实路径 | `collectUpstream` 增加可选 `readText`，`textPath` 存在时读正文再截 200 字；读不到时预览写「文本内容（需用工具读取）」。`createNodeMention` 改 async，`selectNode` 返回类型放宽；离线与实时两条链路都挂 `readText` |
| 2 | 离线只判 `typeof string`，实时用真值过滤；端点节点已删除的边也会保留，坏边产生「暂无输出」噪声，两链路口径不一致 | `collectUpstream` 内统一过滤 `!!sourceHandle && !!targetHandle` 与 `nodesById.has(edge.source)` |
| 3 | `router.ts` 524 行纯编号重排掩盖本功能改动 | `git checkout -- apps/server/src/router.ts` 还原，本轮不含该文件 |
| 4 | `mentions.ts:50/:73` 注释仍写「只带身份/没有内容」，与 `value` 新结构矛盾 | 注释同步改为「身份 + 直接上游摘要」 |

### 修复后复验（真实形态夹具：「outputs 为 `{}`、正文只在 textPath」的 txt2 节点）

| 用例 | 结果 |
| --- | --- |
| 带 `readText` 的文本上游 | PASS：`preview` 为压平后的真实正文「第一行文案内容 第二行 有多余空白 第三行」 |
| 不带 `readText`（模拟未挂载） | PASS：`文本内容（需用工具读取）`，不再裸给占位 |
| `readText` 抛错（文件缺失） | PASS：不抛异常，降级同一文案 |
| 悬空边（来源节点不存在） | PASS：`upstream: []`，不产生噪声项 |
| `sourceHandle: null` 的边 | PASS：`readCanvas` 解析阶段即被滤掉 |
| 25 条入边 | PASS：20 条 + `truncated: true`，序列化 3855 字节 |
| 无入边节点 | PASS：`{upstream: []}`，不写 `truncated` |
| 旧 `value: null` + 新对象混发 | PASS：`agentMentionsSchema` 通过 |
| `@toonflow/server` typecheck | 0 |
| `@toonflow/web` typecheck | 只剩仓库既有 `singleAgent/types.ts(2,33) Cannot find module '@/agentRuntime'` |

## 五、未覆盖 / 待手测

- 实时画布链路（`canvasHost.mentionSource.selectNode` 取当前 `flow.getEdges`）需要打开画布在界面验证。
- 上游来源节点被删除后的降级表现（预览「暂无输出」、`nodeName` 退回 nodeId）。
- 模型侧实际使用效果：发一条带节点引用的消息，看它是否会先读上游摘要而不是直接调用 `getCanvasEdges`。
