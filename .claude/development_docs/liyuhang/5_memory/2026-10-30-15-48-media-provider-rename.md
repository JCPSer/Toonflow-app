# 记忆：媒体供应商支持重命名（显示名称）

- 时间：2026-10-30 15:48
- 改动文件：`apps/server/src/modules/mediaGeneration/media/provider.ts`、新增 `apps/server/src/routes/providers/media/rename.ts`、`apps/server/src/router.ts`、`apps/web/src/components/settings/panels/mediaModel/index.vue`、新增 `renameProviderDialog.vue`

## Situation

媒体供应商的显示名称只存在于供应商 `.ts` 源码的 `label` 字面量里（ID 就是文件名），设置页与节点下拉都直接展示它，但后端只有安装/保存模型/获取模型/删除四个写接口，用户装好之后没法改名。

## Task

在「设置 → 媒体模型」的供应商卡片上提供「重命名」，只改显示名称，不改 ID/文件名、不影响模型、连接配置、隐藏设置与节点已选模型；禁止与其它供应商重名；并发修改不能互相覆盖。

## Action

- `parseProvider` 多返回 `labelExpression`（对 `ObjectProperty` 值做 `unwrap` 后的 AST 节点），用它拿 `start/end` 精确替换 label 值区间——引号/反引号、`as const` 后缀都原样保留，models、函数体、注释、CRLF 一个字节不动。
- 新增 `renameMediaProvider(fileName, label, revision)`：trim 后 1–200（UTF-16 码元）、拒绝 `\p{Cc}`/`\p{Cf}`/`\p{Zl}`/`\p{Zp}`（仅放行 ZWJ）；与其它**可正常解析**的供应商比较显示名（严格相等才拒绝，损坏文件的名字回退成 id 不参与）；`revision` 不匹配返回 409「…请刷新页面后再重命名」；读文件前 `lockWorkspaceFiles`、锁覆盖读-校验-写，`writeWorkspaceFile` 原子写；改成现名直接短路不写盘。
- 新增 `PUT /api/providers/media/rename`，`router.ts` 按仓库约定末尾追加 `route167`（不重排既有编号）。
- 前端卡片加「重命名」按钮（禁用条件同「编辑模型」），新增独立小弹窗：预填现名、`@opened` 聚焦全选、本地校验（非空/长度/不可见字符/重名）、保存中禁输入与关闭、错误就地显示并在输入时清除；成功更新卡片 + `invalidateNodeModels("media")` + 派发 `toonflow:provider-config-changed`（已展开的节点才会重新取模型、分组标题同步）；409「已被修改」关闭弹窗并通知父组件刷新列表（文案是前后端契约）。
- 官方 tfRouter 不做特例，可改名；官方标签、默认 `modelsUrl`、`getPrice`/`getBalance` 都以 id 判断，不受影响。

## Result

- 服务端 typecheck/build 通过；前端 build 通过（`web typecheck` 失败在仓库既有 `@/agentRuntime` 别名问题，与本次无关）。
- 函数级端到端 28 项断言全部通过；评审整改后重跑回归 27 项 + HTTP 6 项全部通过；复审改为 Unicode 类别判定后另跑 14 项字符用例通过（只改 label、CRLF、模板字面量、转义、重名 409、revision 409、非法名、坏文件、tfRouter 能力判定）；节点模型列表联动 3 项通过。
- `deploy-local.sh --build` 已安装，桌面入口与 build 产物逐字节一致、含新路由；**未重启应用**，等用户自行重启。

## 经验

- 这类「改源码里的某个字面量」的功能，别用字符串查找；用 AST 值节点区间，天然避开注释/重复文本/引号风格。
- Babel 的 `start/end` 类型是 `number | null`，仓库既有写法用 `!` + 前置空值检查，保持一致。
- 想跑真实 provider 模块的测试：`conf` 在 import 时读 `TOONFLOW_DATA_DIR`，必须先设环境变量再 `await import(...)`，且脚本要从 `apps/server` 目录运行（Bun 按最近 tsconfig 解析 `@/`），放在仓库根运行会 `Cannot find module '@/...'`。
- 名字存在源码里的代价：同名供应商再次安装会被 409 拒绝（独占写，`force` 无效）；升级必须先删除，而删除会连带清掉 API Key、隐藏设置与自定义名字。
- 节点下拉是**按 providerId 分组**、providerLabel 只作标题；改名后要 `invalidateNodeModels` + 派发 `toonflow:provider-config-changed`，已挂载的媒体节点才会重新 `loadModels()`。
- 不可见字符用 Unicode 类别判断比枚举稳：拒绝 Cc/Cf/Zl/Zp，单独放行 ZWJ（U+200D）保住组合 emoji。
