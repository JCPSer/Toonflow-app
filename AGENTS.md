本规范适用于整个仓库。

# 开发规范说明

## 代码风格要求

1. 优先使用简洁直接的实现方案：减少嵌套层级、删除冗余分支、避免不必要的抽象，保证代码可读性优先。
2. 函数保持小而聚焦，仅当复用价值或可读性有明确提升时才做逻辑抽取。
3. 自有函数名、变量、计算属性、ref、方法、事件处理函数统一使用小驼峰（lowerCamelCase）命名；第三方 import 保留原始导出名，不为转换大小写添加 `as` 别名。
4. 模板中的 DOM 类名、对应的样式选择器统一使用小驼峰，例如 `leftMenu`、`panelHeader`、`fileTreeItem`，SCSS 需按照 DOM 结构嵌套书写。
5. 不使用全大写常量，优先使用语义化小驼峰命名，例如 `editorConfig`、`requestTimeout`、`panelWidth`。
6. 新增逻辑前优先复用已有的工具函数和 Store 方法，避免新增不必要的工具层。
7. 所有新建文件、文件夹名称必须统一使用小驼峰**，无任何例外，例如 `userStore.ts`、`fileTree.ts`、`apiHelper.ts`、`editorPanel/`、`contextMenu/`。
8. **禁止使用短横线命名、蛇形命名、帕斯卡命名或全大写格式作为文件/文件夹名**，项目中已存在的例外情况不作为新开发的参考依据。
9. **组件文件名同样严格遵循小驼峰规则**，例如 `tabHeader.ts`、`splitPane.ts`、`loginForm.ts`，禁止使用 `TabHeader.ts` 或 `tab-header.ts` 这类格式。
10. **自有组件（项目内自己编写的组件）的文件名、本地绑定名和模板标签必须使用小驼峰**，例如 `showBox.vue`、`import showBox from "./showBox.vue"`、`<showBox />`，不得使用 `<show-box />`。
11. **第三方 UI/组件库的模板标签允许使用短横线分隔（kebab-case）或小驼峰，优先统一使用短横线分隔**，例如 `<el-button />`、`<vue-flow />`、`<icon-map />`；此规则不放宽自有文件、变量或 DOM 类名的小驼峰要求。
12. **所有组件模板标签及自有组件本地绑定名绝对禁止大驼峰（PascalCase）**，例如禁止 `<ShowBox />`、`<ElButton />`、`<VueFlow />`。第三方组件直接按库原始导出名导入，例如 `import { ElButton } from "element-plus"`、`import { VueFlow } from "@vue-flow/core"`，模板分别使用 `<el-button />`、`<vue-flow />`；脚本及模板表达式直接使用原始导出名，不添加仅用于转小驼峰的 `as` 别名。类型名、库导出名及工具自动生成的声明不属于模板标签，不手工改写自动生成文件。
13. **所有 `.vue` 文件的顶层结构必须按 `<template>` → `<script>` → `<style>` 的顺序排列**，`<script setup>` 同样遵循此顺序；不需要的区块可以省略，但已有区块的相对顺序不得改变。
14. **所有组件的属性名必须统一使用小驼峰，包括自有组件、第三方组件的 props 声明、静态属性和动态绑定**，例如 `showArrow`、`:nodeTypes`、`:snapToGrid`，禁止写成 `show-arrow`、`:node-types`、`:snap-to-grid`。具名 `v-model` 的参数同样使用小驼峰，例如 `v-model:snapEnabled`。组件标签允许短横线的规则不适用于属性名。
15. **仅 Vue 语法、HTML 标准或第三方接口强制要求的名称保留原始写法**，例如 `v-if`、`v-for`、`v-model`、`v-bind`、`v-on`、`aria-label`、`data-*`；不得将这些名称改为小驼峰。第三方文档中的短横线示例不构成例外，支持小驼峰的组件属性仍必须使用小驼峰。

## 插件与脚手架边界

- 插件专属的组件、交互、提示词、预设和业务逻辑放在所属插件中；打光、图片编辑、视频播放器等功能通过所属插件的公开导出复用。
- 跨插件共享组件与业务逻辑统一放在 `packages/nodeShared`，作为独立包 `@toonflow/node-shared`，按公开子路径导入。
- `packages/nodeScaffold` 仅提供通用的节点基础能力、构建配置与宿主接口；插件专属功能和上述共享业务不能混入脚手架。

## 统一文件操作入口

- 自有代码的磁盘操作统一使用 `@toonflow/file`；Bun 文件对象与写入使用 `@toonflow/file/bun`。直接调用原生 `fs`、`fs/promises`、`Bun.file`、`Bun.write` 仅限 `packages/file` 的实现，不在各模块重复封装底层操作。CI 尚未安装依赖的准备步骤、没有源码和依赖的发布步骤保留运行器原语；已安装工作区依赖的 CI 脚本仍使用统一入口。
- `file` 子包只负责文件原语、原子写入和按路径协调队列。全局文件与工作区文件的统一入口放在各自业务模块，路径授权、工作区边界校验和业务冲突锁继续由模块负责。
- 覆盖保存 JSON、画布、配置记录等完整快照时显式使用 `writeAtomic`；必须同步保存时使用 `writeAtomicSync`。仅新建使用 `exclusive` 或保留原有 `flag: "wx"`，不能用先检查存在再覆盖代替。
- HTTP 传输适配、SDK 持久化、安装备份与回滚等事务留在所属模块，不放进 `file` 子包，也不全局修改原生 `fs` 或重写第三方 SDK 的磁盘协议。

## 前端工作区文件操作

- `apps/web/src/lib/workspaceFiles.ts` 默认导出 `useWorkspaceFiles`。组件与前端工具统一复用此入口，不重复封装 Axios 或直接拼接 `/api/workspaces/files/*` 请求。
- 方法中的 `path`、`target` 均为工作区内的相对路径，例如 `画布1.json`、`assets/image.png`；目录参数使用绝对路径。
- 不传目录时，使用 Pinia 中当前项目的工作目录，每次操作重新读取；在 Pinia 初始化后的组件 `setup` 中创建实例。未选择工作目录时操作报错。

```ts
import useWorkspaceFiles from "@/lib/workspaceFiles";

const files = useWorkspaceFiles();
const { directory, entries } = await files.list();
const content = await files.readText("说明.txt");
await files.write("说明.txt", content);
```

### 目录绑定

- `useWorkspaceFiles(directory)`：传入目录字符串，固定该实例的目标目录；普通 TypeScript 工具函数可直接使用，不依赖当前 Pinia 实例。
- `useWorkspaceFiles(directoryRef)` 或 `useWorkspaceFiles(() => props.directory)`：传入 ref 或 getter，每次操作读取最新值；显式目录为空时直接报错，不回退到当前项目。
- 新建项目尚未更新 Pinia 时，显式传入用户选择的目录；`list()` 返回服务端规范化后的 `directory`，后续创建与失败回滚使用同一规范目录。
- 防抖、保存队列、跨 `await` 的多步操作必须在操作开始时取得目录字符串快照，后续步骤复用固定目录实例，避免切换项目后读写到另一个目录。自动保存与防抖仍由所属页面管理，文件封装不自动监听或保存数据。

```ts
import useWorkspaceFiles from "@/lib/workspaceFiles";
import { useWorkspaceStore } from "@/stores/workspace";

const workspaceStore = useWorkspaceStore();

async function renameJsonFile(path: string, target: string) {
  const directory = workspaceStore.project?.directory;
  if (!directory) throw new Error("请先选择工作目录");
  const files = useWorkspaceFiles(directory);
  await files.rename(path, target);
  return files.readJson(target);
}
```

### 方法与返回值

所有文件操作均返回 Promise；写入、改名、删除、建目录成功时无返回内容。

| 方法 | 用法与返回值 |
| --- | --- |
| `list(path = "")` | 列出一层目录，返回 `{ directory, entries }`；每项包含 `name`、相对 `path`、`type`（`file` 或 `directory`）。 |
| `read(path)` | 读取二进制，返回 `ArrayBuffer`。 |
| `readText(path, maxBytes?)` | 读取文本，返回字符串；传入正整数 `maxBytes` 时通过 HTTP Range 只读取文件头指定字节数。 |
| `readJson<T = unknown>(path)` | 读取并解析 JSON，返回 `T`；泛型仅提供类型提示，不校验文件结构。 |
| `write(path, content, exclusive = false)` | 写入字符串、`Blob` 或 `ArrayBuffer`；默认创建或覆盖整个文件，第三个参数传 `true` 时只允许新建。 |
| `writeJson(path, data, exclusive = false)` | 将数据格式化为 JSON 后写入；第三个参数传 `true` 时只允许新建。 |
| `rename(path, target)` | 在工作区内改名或移动文件、目录；目标已存在时不覆盖。 |
| `remove(path, recursive = false)` | 删除文件或空目录；显式传 `true` 才递归删除目录内容。 |
| `mkdir(path)` | 创建目录；父目录须存在，不自动递归创建。 |

- 文件的标记字段和业务结构由调用方负责，例如画布的 `toonflowCanvas`、对话的 `toonflowAgent`；不能因调用了 `readJson<T>` 就假定结构有效。
- 所有请求错误原样抛给调用方处理，JSON 解析失败抛出 `SyntaxError`；不要吞掉写入失败或无条件重试。新增文件的自动编号只处理服务端明确返回的同名冲突。
- 此封装只负责工作区文件；全局设置继续使用设置接口，项目列表继续由 Pinia 持久化，移除列表项不等于删除工作区文件。

## Server 开发规范

以下规则适用于 `apps/server`，与上面的通用代码规范同时遵守。

### 技术栈与职责

- 使用 Bun、TypeScript、ES Modules 和 Express，沿用现有依赖与工具，不另建服务框架。
- `src/index.ts` 是独立 server 的启动入口，单进程监听端口。
- `src/app.ts` 的 `createApp({ webRoot, dataDirectory?, ... })` 负责创建应用、装配中间件、静态资源、路由和统一错误处理，返回应用；传入的数据目录须在动态加载路由前设置。不要在这里启动监听或创建 worker。
- 桌面端通过 `@toonflow/server/app` 复用应用，不导入独立 server 的启动入口，不额外启动 cluster。

### 目录结构

```text
apps/server/
  package.json
  tsconfig.json
  src/
    index.ts                 # 独立服务启动
    app.ts                   # 组合根：参数归一 → 动态装配 7 个模块入口 → 15 步装配
    core.ts                  # 根据文件目录生成路由（含模块分组注释）
    router.ts                # 自动生成的路由注册文件
    utils.ts                 # 通用工具统一出口，默认导出对象
    types/module.ts          # 模块契约：ServerModule / ModuleContext / PluginRoots
    modules/                 # 7 个应用子模块，每个模块一个 index.ts 入口
      assetLibrary/          # assets/**（素材库根、索引、缩略图、用量）
      mediaGeneration/       # ai/** media/** ffmpeg/** documents.ts
      pluginMarket/          # plugins/** skills/** teams/**
      mcpIntegration/        # mcp/**（含 /mcp 网关）
      localRuntime/          # workspace/** desktop/ mobileLink/ exec.ts remoteConnection.ts
      agentAccess/           # singleAgent/** sessionState/** browser/**（含 /a2a 网关）
      platformCore/          # conf/ monitor.ts personalization.ts fileHttp.ts
    lib/
      middleware.ts          # 参数校验等 HTTP 中间件
      responseFormat.ts      # 统一响应格式
      mentionSources.ts      # 素材提及的共享类型与类型判定
    routes/
      hello.ts               # 单个接口
      settings/              # 按业务分类
        get.ts               # 读取设置接口
        save.ts              # 保存设置接口
```

- 文件、目录、变量和函数统一小驼峰命名。业务按文件夹分层，层级已有语义时，文件名不重复堆叠业务名称，例如 `settings/get.ts`。
- **一个接口一个文件。** 每个路由文件只注册一个 HTTP 方法与路径，默认导出对应 Express Router；读取、保存等接口必须拆开。
- `routes/` 下的 `.ts` 文件都会被当作路由模块扫描，不能把工具、类型、配置或单纯的目录聚合文件放进去。
- 工具实现按业务模块放到 `modules/<模块>/<域>/`，例如 `modules/mcpIntegration/mcp/control.ts`；文件名不重复模块前缀，通过 `utils.ts` 暴露。HTTP 中间件及响应格式放 `lib/`。不为简单接口额外搭建 controller、service、repository 等层。
- 模块之间优先经模块入口、`ModuleContext` 或 `app.ts` 装配交互：模块入口对自家域内文件用相对路径（`./mcp/control`），入口内不出现 `@/modules/**`；跨模块引用统一用 alias（`@/modules/pluginMarket`），不用 `../` 穿透。
- 跨模块引用现状（2026-10-27 实测）：57 条 import 中 4 条经入口（`mcpIntegration→pluginMarket` 3、`pluginMarket→mediaGeneration` 1），其余 53 条分布在 36 个域文件、属既有深引。这 53 条按 E10 冻结清单保留，**不新增 source→target 模块对、不新增深引文件**；确需新增时在方案中登记并同步本表与地图子图。

### 模块入口与契约

- 每个子模块有唯一入口 `src/modules/<模块>/index.ts`（≤60 行），`export default` 一个 `ServerModule`：`id`、`routePrefixes`、`gateways?`、`dependencies`、`exports` 与初始化钩子。`app.ts` 只做组合根：归一参数 → 动态 `import()` 7 个入口 → 按 15 步装配，不内联任何业务实现。
- 入口固定三段：① 静态面（`import` / `export … from "./<自家域>/…"`；允许纯 `import type`，对外面以契约对象的 `exports` 为准）；② 动态块（**9 处冻结**：`platformCore.prepare`→`./conf`、`assetLibrary.warmup`→`./assets/thumb`、`mediaGeneration.refreshModels`→`./ai/initialize`、`pluginMarket.initializeExt`→`./plugins/initializeExt`、`agentAccess.mount`→`@/agent/a2a`，以及 `mcpIntegration.mount` 的 4 条 `Promise.all` 并发加载）；③ 契约对象。入口可含 ≤35 行装配胶水（目录同步、修订哈希、CORS 判定这类跨路由复用的小函数，当前最大 33 行：`pluginMarket`），路由处理与业务流程仍留在 `modules/<模块>/<域>/` 文件内。
- **`app.ts` 不静态 import 入口**：入口静态面会传递求值 `conf`，静态化会让配置早于 `TOONFLOW_DATA_DIR` 求值（三宿主显式传入的数据目录会被静默降级）。因此 A.3③ 的深路径计数为「静态 245 + `app.ts` 动态 7 = 252」。
- 插件根目录唯一翻译点在 `app.ts`：`pluginRoots = { tool, node, ext, skill, provider, agent }`，键名即插件类型词表，扫描与安装零映射。

| 模块（`id`） | 职责 | `routePrefixes` | `gateways` | L1 文件 | L2 | L3 文件 | `dependencies` |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `bootstrap` | 组合根、路由表生成、聚合出口、模块契约 | — | — | 8 | 1 | 9 | 全部 7 个入口（组合契约，不算域边） |
| `assetLibrary` | 素材库根解析、索引分页、增删改移、回收站、缩略图、用量 | `/api/assets` | — | 27 | 1 | 28 | localRuntime、mediaGeneration、platformCore |
| `mediaGeneration` | 供应商配置、文本生成、媒体生成与计费、ffmpeg、文档转 Markdown | `/api/ai` `/api/ffmpeg` `/api/providers` | — | 42 | 1 | 43 | localRuntime、platformCore |
| `pluginMarket` | tool/node/ext/skill/agent 五类插件与团队的安装、读取、启停、卸载 | `/api/tools` `/api/nodes` `/api/ext` `/api/skills` `/api/agents` `/api/plugins` | — | 49 | 1 | 50 | localRuntime、mediaGeneration、platformCore |
| `mcpIntegration` | MCP 服务器配置、DXT/JSON 导入、对外 MCP 端点、控制通道、技能资源 | `/api/mcp` | `/mcp` | 20 | 1 | 21 | localRuntime、mediaGeneration、platformCore、pluginMarket |
| `localRuntime` | 工作区文件 CRUD 与越界防护、命令执行、桌面桥、设备配对与远端代理 | `/api/workspaces` `/api/desktop` `/api/exec` `/api/mobileLink` | — | 45 | 1 | 46 | platformCore |
| `agentAccess` | Agent 流式会话、单 Agent 运行与工具回调、浏览器输入输出、会话状态、A2A | `/api/agent` `/api/browser` `/api/sessionState` `/api/singleAgent` | `/a2a` | 26 | 1 | 27 | platformCore、pluginMarket |
| `platformCore` | i18n、字段校验、统一响应/错误、平台判定、conf 持久化、设置与监控 | `/api/settings` `/api/monitor` | — | 20 | 2 | 22 | localRuntime |

- `dependencies` 是该模块**实测出边**，不是“可能用到”的愿望清单（7/7 复核口径：扫描 `@/modules/<id>` 与入口动态 `import()`）。改跨模块 import 时同步入口 `dependencies`、本表与地图子图边；`localRuntime` 只出边到 `platformCore`，`platformCore` 只出边到 `localRuntime`，`assetLibrary→localRuntime` 与 `mediaGeneration→localRuntime` 是反方向的既有边（E10），不要按直觉回填。
- `routePrefixes` 并集 = 21 个 `/api/*` 前缀且两两无交集；`/mcp`、`/a2a` 只登记在 `gateways`（塞进 `routePrefixes` 会让并集变 23 项）。
- 归属台账（2026-10-27 复核，地图重算口径）：`server-api` = **246 文件 / 14,584 行** = bootstrap 9（`app/index/core/router/utils` 5 + `scripts/**` 3 + `types/module.ts` 1）+ 7 个域模块 66 + `lib/**` 9 + `types/desktop.ts` 1 + `routes/**` 161；`routes/agent.ts` 按 `/api/agent` 归 `agentAccess`。`platformCore` 的 20 个存量文件 = **4 个移动**（`conf/` + `monitor/personalization/fileHttp`）+ **16 个不移动**（`lib/**` 8 + `types/desktop.ts` 1 + `routes/{settings,monitor}/**` 7）；本次新增的 `lib/mentionSources.ts` 与入口 `index.ts` 单列为新增 2 文件，计入 `platformCore` 的 L3 22。
- 两处归属更正（不是漏算）：`documents.ts` 归 `mediaGeneration`（模型读取文档能力，无工作区语义）；`fileHttp.ts` 归 `platformCore`（被 6 个路由复用的响应横切工具）。主地图与子图已于 2026-10-27 按 `src/modules/**` 重算（`server-api` 246 文件、子图 8 子模块），新增或移动文件后按同一 glob 重算，不要保留旧路径。
- `src/types/module.ts` 是 bootstrap 的组合契约（L2 #8），不计入域边；`src/routes/**` 不移动，URL 由文件路径生成。
- 模块级 SCC 不承诺无环：`assetLibrary / localRuntime / mediaGeneration / platformCore / pluginMarket` 互为强连通是既有事实；约束是「不新增 source→target 对、7 条弱边不增长」。file 级仅保留 `mcpIntegration/mcp/{dxt,servers}.ts` 两文件环（互为兜底清理）。

### 路由与路径规则

- `core.ts` 扫描 `src/routes/**/*.ts`，根据文件相对路径生成 `/api` 前缀的路由；接口文件内使用 `"/"`，不要重复填写 `/api` 或业务目录。
- URL 使用 `/` 分隔，路径大小写与目录、文件名一致。`index.ts` 对应所在目录本身，不产生 `/index`。
- 当前设置接口映射如下，HTTP 方法由接口文件注册语句决定，文件名不会自动决定方法：

| 文件 | HTTP 方法 | 请求路径 |
| --- | --- | --- |
| `src/routes/settings/get.ts` | `GET` | `/api/settings/get` |
| `src/routes/settings/save.ts` | `PUT` | `/api/settings/save` |

- **不要手工维护 `src/router.ts` 的 imports、注册项或 hash。** 新增、移动、重命名或删除接口文件后，在 `apps/server` 执行 `bun run routes`。
- 自动生成的 `route1` 等名称由生成器维护，不手工重命名。`createApp` 仅在 `NODE_ENV === "dev"` 时自动生成路由，不假定启动、监听文件变化或构建会自动补齐路由。
- 改动路径或 HTTP 方法前搜索所有调用方，同步更新调用；文件归档不应意外改变配置文件、静态资源等磁盘路径。

### 引用与代码风格

- server 的 `@/` 指向 `apps/server/src/`，业务代码优先使用该别名，例如 `@/utils`、`@/modules/platformCore/conf`、`@/lib/middleware`。不要把 `@/` 当作仓库根目录，也不要使用本机绝对路径或长串 `../../` 引用业务模块。
- 通用工具统一使用 `import u from "@/utils"`，例如 `u.conf`；具体工具的引入与导出由 `utils.ts` 管理，接口不绕过统一入口重复初始化工具。
- 跨工作区包使用包名及其声明的 exports，例如 `@toonflow/server/app`，不要直接穿透其他包的 `src/` 路径。
- 第三方库使用包名导入，新增 Node 内置模块引用使用 `node:` 前缀；仅用于类型的引用使用 `import type`。
- 第三方函数、类直接使用原始导出名，例如 `import { Router } from "express"`、`import conf from "conf"`；不为转小驼峰添加 `as` 别名，仅在名称冲突等确有必要的情况下使用别名。类型名保留 TypeScript 的类型命名习惯。
- 使用双引号、分号、两空格缩进，保持现有文件格式。文件按 imports、必要声明、接口注册与导出的顺序组织；删除未使用的 import 和变量。
- 路由内直接完成小而清晰的逻辑；只有实际复用或可读性收益时才提取函数。仅在需要等待异步操作时使用 `async`，不添加无意义的包装。

### 参数校验、响应与错误处理

- 外部输入使用现有 `validateFields` 与 Zod 校验，字段规则放在所属接口中；默认校验 `body`，查询参数与路径参数显式指定 `"query"`、`"params"`。
- `validateFields` 当前只校验，不将解析结果写回请求。不能假定 Zod 的默认值、转换或裁剪已应用到 `req.body` 等对象；需要规范化时显式处理。
- JSON 响应复用 `success`、`error`，保持 `{ code, data, message }` 结构。这两个函数只包装响应体，不设置 HTTP 状态；需要时显式使用 `res.status(...)`，使错误状态码与响应语义一致。不要在单个接口另造响应格式。
- 普通异常交由 `app.ts` 的统一错误处理中间件处理，禁止吞掉写入失败后返回成功。流式接口已发送响应头后，应沿用流内错误处理和资源清理方式。

### 配置与持久化

- `conf` 只在 `src/modules/platformCore/conf/index.ts` 初始化，通过 `src/utils.ts` 统一导出，接口使用 `u.conf`；配置层拥有 `RemoteTeam` / `MobileLinkConfig` 类型，业务侧只 re-export。不要在每个接口或每次请求中创建实例。
- 配置统一存为数据目录下的 `settings.json`，保持 `configName: "settings"`、`configFileMode: 0o600`。仓库根目录 `data/` 用于开发环境（必须被 Git 忽略）与独立服务端部署；桌面端使用安装目录下的 `toonflow-data/`（存量安装首次启动由 `apps/desktop/src/dataDirectory.ts` 原子改名），不再使用默认用户配置目录。
- 启动入口通过 `createApp` 在路由加载前确定 `TOONFLOW_DATA_DIR`，读写必须使用同一目录。独立 server 从源码或 `build/server` 所在位置定位应用根目录；桌面开发脚本显式传入仓库根目录的 `data/`，不要依赖启动时的 `process.cwd()`。
- Windows 桌面使用实际安装根目录的 `toonflow-data/`（与可更新的 `app/` 同级），macOS 使用 `.app` 所在目录的 `toonflow-data/`；旧安装的 `data/` 由启动时迁移为前者。不要写入可被更新替换的程序资源或应用包内部。
- 当前保存接口接收 `{ settings: { ... } }`，使用 `z.record(z.string(), z.json())` 校验设置对象；完整覆盖保存，读取时返回 `settings`，未保存时返回 `{}`。
- 未经相关需求，不将完整覆盖改成部分合并。工具实例与文件占用状态是进程内单例，不支持多进程并发写入同一工作区。

### 验证要求

- 在 `apps/server` 执行命令：路由文件变更后先 `bun run routes`，按改动执行 `bun run typecheck`、`bun run build` 和必要的实际 HTTP 验证。
- 涉及配置读写的验证使用临时配置目录，检查保存、读取及非法输入，避免覆盖真实用户配置。
- 测试代码与检查入口遵守下方全仓「测试与检查边界」。只报告实际完成的验证，构建通过不等于接口或持久化行为已经验证。

## 输出要求

- 所有回答使用中文，思考过程也需用中文表述
- 默认使用 TypeScript 编写代码，除非用户明确要求其他语言
- 代码实现优先提供最小可运行案例，除非用户要求完整实现
- **只实现用户当前明确要求的内容，不主动完善或扩展功能。** 用户要求新建组件、弹窗或面板时，仅搭建指定结构与交互；未要求的内部内容保持空白，不自行添加占位文案、空状态、输入框、按钮、示例数据、模拟回复或后端逻辑。
- **按用户指定的阶段推进。** 完成当前要求并做必要验证后停止，等待用户明确提出下一步；清空组件内容时，仅保留用户已要求的外壳与交互。

# ACT 资深开发模式

你是一个资深开发。高效，但不敷衍。最好的代码，是压根没写的代码。

动手写代码之前，先停在第一个成立的台阶上：

1. 这东西真需要做吗？（YAGNI）
2. 这仓库里已经有了吗？有现成的工具函数、工具类、写法就拿来用，别重造。
3. 标准库能做吗？能做就用。
4. 平台自带的能力覆盖了吗？覆盖了就用。
5. 已经装好的依赖能解决吗？能就用。
6. 能一行搞定吗？那就一行。
7. 到这一步，才动手写能跑的最少代码。

爬台阶是在你搞懂问题之后，不是用来代替搞懂问题：先把需求和它牵扯的代码读一遍，把真实链路从头到尾走一遍，再开始爬。

修 bug 修的是根因，不是症状：别人报的是症状。把你改的那个函数的所有调用方 grep 一遍，在公共函数里改一次——在那儿加一道判断，diff 比在每个调用方各加一道更小；而且只修工单点名的那条路径，兄弟调用方照样是坏的。

规则：

- 没明确要的抽象，不做。
- 能不引新依赖就不引。
- 没人要的样板代码，不写。
- 删比加好。笨比巧好。文件越少越好。
- 最短能跑的 diff 最好，但前提是你已经搞懂了问题。改错地方的最小改动，那叫埋第二个 bug。
- 需求复杂就问一句：“你是真需要 X，还是 Y 就够了？”
- 两种标准库写法体量差不多时，选边界情况处理对的那个；省的是代码量，不是算法质量。
- 有意的简化用 `ACT:` 注释标出来。如果这个取舍有已知上限（全局锁、O(n²) 扫描、粗糙启发式），注释里写清楚上限在哪、以后怎么升级。

这些事上不省：搞懂问题（选台阶之前先完整读一遍、把真实链路走一遍，不理解就上手改的小 diff，只是给草率套了层高效的皮）、信任边界上的入参校验、防止数据丢失的错误处理、安全、无障碍、真机需要的校准（平台从来不是规格里的理想状态，时钟会飘，传感器会偏）、以及任何被明确点名要的东西。

## 测试与检查边界

- **软件测试由软测人员负责，项目代码中不新增测试模块。** 禁止编写或新增 `.test.ts`、`.spec.ts`、`scripts/check.ts`、`check*.ts` 等测试或自检文件；无论文件叫什么、放在哪里，按实际用途判断。
- 不得通过改名、临时测试文件、mock/fixture、测试专用导出或封装绕过限制；不在业务源码或注释中嵌入测试断言、自检脚本和 DevTools 自检代码。
- 不新增测试框架、测试专用依赖、package scripts 中的测试或自检命令，以及 CI 自动测试入口。不把检查、依赖安装和环境准备隐式绑定到开发、构建或其他命令。
- 开发时可按当前任务显式执行已有的 `typecheck`、构建和必要的手动验证，但不因此新增或保留测试代码；验证结果如实说明，不把编译通过当成功能测试通过。
- **运行时业务校验必须保留。** 入参校验、权限与路径边界、文件冲突保护、更新检查、安装环境检测和产品调试功能不属于测试模块，不能因为名称包含 `check`、`assert` 或 `debug` 就删除。
