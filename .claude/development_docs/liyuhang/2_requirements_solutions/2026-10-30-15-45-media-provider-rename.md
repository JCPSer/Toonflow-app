# 需求方案：媒体供应商支持重命名（显示名称）

- 时间：2026-10-30 15:45
- 对应需求矩阵：`1_requirements_matrix/2026-10-30-15-37-media-provider-rename.md`
- 涉及文件：
  - 后端：`apps/server/src/modules/mediaGeneration/media/provider.ts`（新增 `renameMediaProvider`，`parseProvider` 多返回 label 值区间）、`apps/server/src/routes/providers/media/rename.ts`（新增）、`apps/server/src/router.ts`（追加一条路由）
  - 前端：`apps/web/src/components/settings/panels/mediaModel/index.vue`（卡片按钮 + 接线）、`renameProviderDialog.vue`（新增）
- 不改：语言模型供应商、节点包、MCP/Agent 工具、插件市场安装流程

## 1. 设计概要

```
设置卡片「重命名」 → 小弹窗（预填现名） → PUT /api/providers/media/rename
   { fileName, label, revision }
        │
        ▼
renameMediaProvider(fileName, label, revision)
   1. 校验文件名（沿用 mediaProviderFileSchema）
   2. 校验名称：trim 1–200、无控制字符/换行
   3. 读当前文件 → revision 不匹配则 409
   4. 解析源码定位 label 值区间（字符串字面量或无插值模板字面量）
   5. 与其它可解析供应商的显示名比较（trim 后严格相等 → 409 重名）
   6. 拼接新源码（只替换 label 值区间）→ metadata 重算 revision/label
   7. 加文件锁 → 原子写回 → 返回新 metadata（label、revision…）
        │
        ▼
前端 saveProviderItem 更新卡片 → invalidateNodeModels("media") → 节点下拉分组名同步
```

## 2. 后端

### 2.1 `parseProvider` 暴露 label 值区间

`parseProvider` 已经解析出 `export default` 对象字面量与各属性（`properties()` 返回 Map）。当前返回 `{ object, modelProperty, id, label, ... }`，新增返回 `labelExpression`：`unwrap(entries.get("label").value)`。

- 用 **unwrap 后**的表达式起止位置：`label: "xxx" as const` 这类写法替换后仍保留 `as const` 后缀。
- 字符串字面量与无插值模板字面量的 `start/end` 覆盖引号/反引号本身，替换整段即安全。
- `literal()` 只接受字面量（`provider.ts:138-157`），因此不会出现常量引用或计算表达式，区间一定存在；若极端情况下取不到区间，按 400「供应商文件结构无法定位显示名称」处理，不猜位置。

### 2.2 `renameMediaProvider(fileName, label, revision)`

```
renameMediaProvider(fileName, label, revision):
  if !mediaProviderFileSchema(fileName): 400
  next = label.trim()
  if !next.length || next.length > 200: 400「显示名称须为 1–200 个字符」
  if /[\p{Cc}\p{Zl}\p{Zp}]/u.test(next) || /\p{Cf}/u.test(next.replaceAll("\u200d", "")): 400「显示名称不能包含换行、控制字符或不可见字符」（Cf 仅放行 ZWJ）
  dir = await directory(); if !dir: 404
  release = lockWorkspaceFiles([join(dir, fileName)])   // 先加锁，再读文件，锁覆盖读-校验-写
  try:
    current = await readProvider(dir, fileName)          // 不存在 → ENOENT/404，沿用现有错误
    if current.revision !== revision: 409「供应商文件已被修改，请刷新页面后再重命名」
    parsed = parseProvider(current.source)
    if parsed.label.trim() === next: return metadata(...)  // 无操作，不写盘
    for other in await listMediaProviders():
        if other.fileName !== fileName && !other.loadError && other.label.trim() === next:
            throw 409「已存在同名供应商：${next}」      // Conflict；前端按文案区分「重名」与「revision 过期」
    start/end = parsed.labelExpression 区间
    source = current.source.slice(0, start) + JSON.stringify(next) + current.source.slice(end)
    result = metadata(fileName, source)                   // 重算 revision；id 必须不变（断言）
    await writeWorkspaceFile(join(dir, fileName), source)
    return result
  finally: release()
```

要点：

- **无操作短路**：改成自己现在的名字直接返回，不产生写盘与 revision 变化（R4）。
- **重名比较**：只和「能解析的其它供应商」比较，`trim` 后严格相等（与决策一致，大小写不同视为不同名）；`loadError` 的供应商名字不可信，跳过。
- **只替换值区间**：models、函数体、注释、CRLF、结尾换行全部原样保留（R2）。
- **返回值**：完整 `metadata`（与 `saveMediaProvider` 一致），前端据此更新 `revision`，避免后续保存模型撞 409。
- 与 save/delete 一样用 `lockWorkspaceFiles` + revision 乐观锁；`writeWorkspaceFile` 走原子写，失败不留半截文件（R5/R8）。

### 2.3 路由

新增 `apps/server/src/routes/providers/media/rename.ts`：

```
PUT /
  validateFields({
    fileName: mediaProviderFileSchema,
    label: z.string().min(1).max(200),
    revision: z.string().regex(/^[a-f0-9]{64}$/),
  })
  → success(await renameMediaProvider(...))
```

`router.ts` 按仓库约定**末尾追加**：`import route167 from "./routes/providers/media/rename";`，在 providers 段追加 `app.use("/api/providers/media/rename", route167);`（不重排既有编号）。

## 3. 前端

### 3.1 卡片入口（`mediaModel/index.vue`）

- 操作区在「编辑模型」旁新增 `<el-button text :icon="IconPencil">重命名</el-button>`。
- 禁用条件与「编辑模型」一致：`fetchingFile`/`deletingFile`/`loadError`/无 `revision`（R8）。
- `aria-label="重命名 ${item.label}"`。
- 异步加载 `renameProviderDialog.vue`（与其它弹窗一致用 `defineAsyncComponent`）。
- 弹窗 `saved` 回调：`saveProviderItem(provider)` 更新卡片与 `revision` → `invalidateNodeModels("media")` → `window.dispatchEvent(new Event("toonflow:provider-config-changed"))`，让已挂载的媒体节点重新取模型、分组标题同步（R6）。
- `conflict` 回调（服务端 409「已被修改」）：`loadProviders()` 刷新列表与 revision，提示「列表已刷新，请重新重命名」；否则弹窗里的 revision 已失效，重试必然再 409。

### 3.2 弹窗设计（`renameProviderDialog.vue`）

```
┌──────────────────────────────────────────────┐
│ 重命名媒体供应商                               │
├──────────────────────────────────────────────┤
│ 显示名称 *                                    │
│ ┌──────────────────────────────────────────┐ │
│ │ 现名（默认聚焦并全选）                     │ │
│ └──────────────────────────────────────────┘ │
│ 只修改显示名称；供应商 ID（文件名）与模型不变。 │
│                                              │
│ [错误提示条：仅失败时出现]                     │
├──────────────────────────────────────────────┤
│                        [取消]  [保存]         │
└──────────────────────────────────────────────┘
```

- props：`provider: MediaProvider`、`existingLabels: string[]`（其它供应商的显示名，用于本地查重）；`v-model` 控制显隐；`saved` 回传新 `MediaProvider`；`conflict` 通知父组件刷新列表。
- 打开时 `draft = provider.label`，`@opened` 里聚焦并 `select()`（等弹窗动画结束，比 `nextTick` 可靠）。
- 前端校验（就地提示，不发请求）：trim 后非空、≤200、无控制/不可见字符、不与 `existingLabels` 中的名字严格相同（排除自身）；名字没变直接关闭，先于重名校验（避免历史同名卡住「保持原名」）。
- 提交：`PUT /api/providers/media/rename`，body 带 `fileName`、`label`、`revision`；回车只走表单原生提交（不再额外监听 `keyup.enter`，避免一次回车发两个请求）。
- 保存中：输入框、取消按钮禁用，确定按钮 loading，禁止 Esc/点击遮罩/右上角关闭（与 `editProviderDialog` 一致）。
- 成功：`ElMessage.success("已重命名")` + `emit("saved", data)` + 关闭；失败：错误显示在弹窗内（HTTP 400/404 的 message 原样透出），再次输入时清除；409「已被修改」关闭弹窗并触发 `conflict`，409 重名留在弹窗内改名字。
- Esc 关闭（非保存中），输入框与按钮带可访问名（R9/R10）。

## 4. 异常与边界

| 场景 | 行为 |
| --- | --- |
| 新名字 = 现名字（trim 后） | 无操作，直接关闭；不写盘、不换 revision、不弹成功提示 |
| 新名字与其它供应商显示名严格相同 | 前端就地提示；服务端 409「已存在同名供应商」 |
| 大小写不同（Kling / kling） | 允许（严格相同才算重名） |
| 名字首尾空格 | trim 后保存；纯空白被拒 |
| 内部含 Cc/Cf/Zl/Zp（换行、C1、零宽、bidi、软连字符、BOM…） | 前端与服务端都拒绝；ZWJ（组合 emoji）放行 |
| 超过 200 字符（UTF-16 码元） | 前端与服务端都拒绝 |
| 客户端 revision 过期（两个窗口） | 409「供应商文件已被修改，请刷新页面后再重命名」，文件保持先提交者的名字；前端关闭弹窗并刷新列表 |
| 同一文件被其它操作占用 | `lockWorkspaceFiles` 直接 409「文件正在使用，请等待操作完成」 |
| 供应商文件被外部删除 | 404（沿用 `readProvider` 的 ENOENT 路径） |
| 文件解析失败（loadError） | 前端按钮禁用；服务端 parse 失败 400，不写盘 |
| 写入失败 | 原子写失败，原文件不变，错误原样提示 |
| tfRouter | 可改名；`id` 不变，默认 `modelsUrl`、`getPrice`、`getBalance` 的 id 特判全部不受影响；「官方」标签沿用 id 判断 |
| 重装/升级同一供应商 | 同名安装直接 409；要升级必须先删除（连带丢 API Key、隐藏设置与自定义名字）再安装——已知代价 |
| 两个不同供应商并发改成同一新名 | 锁是文件粒度，可能同时通过（已知限制，单窗口 UI 基本不可达） |
| 安装/插件市场装出同名供应商 | 允许（本次只约束重命名入口）；节点分组建在 providerId 上，不会合并 |
| 非 UTF-8 编码的供应商文件 | 不保证逐字节不变：`readFile(utf8)` 会把非法序列变成 U+FFFD；供应商文件由应用写入，正常为 UTF-8 |
| 文件权限/mtime | 原子写会把权限重置为 0600，mtime/inode 变化；不在保证范围 |
| 并发获取模型 | 两接口都持文件锁；先完成者写盘，后完成者 revision 不匹配报 409 |
| label 为模板字面量 | 区间包含反引号，整段替换为 JSON 字符串，安全 |
| label 带引号/反斜杠/`${` | `JSON.stringify` 负责转义 |
| 另一个窗口/标签页 | 保持旧名直到刷新（window 事件不跨窗口，与现有保存逻辑一致） |
| 已展开的媒体节点 | `invalidateNodeModels` + `toonflow:provider-config-changed` 后重新取模型，分组标题更新 |

## 5. 测试计划

| 用例 | 期望 |
| --- | --- |
| 服务函数：普通 `label: "旧名"` | 文件 diff 仅 label 一行；`id`、`models`、函数体字节不变；新 revision = 新源码 sha256 |
| 服务函数：模板字面量 label | 替换后为合法字符串字面量，文件仍可解析 |
| 服务函数：CRLF 文件 | 换行风格不变，改写后仍为 CRLF |
| 服务函数：改成自己的名字 | 不写盘，revision 不变 |
| 服务函数：与其它供应商同名 | 409「已存在同名供应商」，文件不变 |
| 服务函数：revision 过期 | 409「…请刷新页面后再重命名」，文件不变 |
| 服务函数：空名 / 201 字 / 内部含换行、C1、U+2028/2029、零宽/ZWNJ/LRM、软连字符、bidi、BOM | 400，文件不变；组合 emoji（ZWJ）与中文/emoji 允许 |
| 服务函数：名字含 `"`、`\`、`${`、中文、emoji | 写入后仍是合法字符串字面量，供应商可重新解析 |
| 服务函数：坏文件（语法错误） | 400，文件不变 |
| 服务函数：tfRouter | 改名成功，`supportsPrice/supportsBalance` 仍为 true |
| HTTP 路由：正常/空白/非法文件名/重名/revision 过期 | 200 / 400 / 400 / 409 / 409，错误文案可读 |
| 节点模型列表：改名后 `providerLabel` | 返回新分组标题，`providerId` 不变 |
| 后端 typecheck / build | 通过 |
| 前端 typecheck / build | 通过 |
| 应用内手测（重启后） | 卡片按钮 → 改名 → 卡片与**已展开的**节点下拉均显示新名；已选该供应商模型的节点仍能生成；API Key 保留 |

## 6. 评审意见

### 6.1 子 agent 初审

- 需求评审结论：**不通过 → 整改后复审通过**（必须整改项见需求矩阵 §6.1）。
- 实现/代码审查结论：**通过，无 P0 阻断项**；整改项与处理：
  1. **P1** 弹窗保存中输入框未禁用 → 已加 `:disabled="saving"`。
  2. **P2** 回车存在「表单原生提交 + `keyup.enter`」双提交路径 → 去掉 `keyup.enter`，只走表单提交。
  3. **P2** 控制字符正则未覆盖 C1/U+2028/2029/零宽/bidi → 与服务端一致扩为显式集合，保留 ZWJ。
  4. **P2** 跨文件并发改成同一新名不原子 → 接受为已知限制，写入需求与边界表。
  5. **P2** 重名状态码文档写 400、实现 409 → 文档改为 409。
  6. **P2** revision 文案「重试」vs「再重命名」不齐 → 代码统一为「请刷新页面后再重命名」。
  7. **P2** 前后端无操作判等口径不一致（前端未 trim）→ 前端改 `name === provider.label.trim()`，并把无操作判定提到重名校验之前。
  8. **P2** 输入时不清错误条 → 增加 `watch(draft)` 清空。
  9. **P2** 409 后 revision 快照失效、无法在弹窗内恢复 → 409「已被修改」关闭弹窗并 `conflict` 通知父组件刷新列表。
  10. **P2** 冗余非空断言 → 改为 `if (!range || range.start == null || range.end == null)` 后直接用 `range.start/end`。
  11. **P2** 路由层 `max(200)` 校验原始串 → 改为 `z.string().trim().min(1).max(200)`。
- 需求复审结论：**通过**（无 P0/P1）；复审 8 条 P2 已处理：不可见字符改为 `\p{Cc}`/`\p{Cf}`/`\p{Zl}`/`\p{Zp}` 判定并放行 ZWJ、R3 写明「首尾由 trim 去除、内部出现即拒绝」、§5 同名卡片表述、R10 图标/文字按钮口径、R2 补转义验收、409 文案标注为契约、测试文档同步、方案残留「重名 → 400」改 409。
- 未采纳：弹窗按钮额外 `aria-label`（可见文字已是可访问名）；200 改为按 Unicode 字符计数（与 `maxlength` 一致按 UTF-16 码元）；409 增加稳定错误码（改用文案契约 + 测试断言 + 两侧注释）。

### 6.2 用户评审

- 结论：待填写
- 意见：待填写
