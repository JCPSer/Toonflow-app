import json, os, subprocess, sys
from datetime import datetime

NOW = datetime.now().astimezone().isoformat(timespec="seconds")
CLI = ".easyvibe/map/_tools/easyvibe_map2.py"
ENV = dict(os.environ)

def h(score, coupling, complexity, churn, flags, note, concerns):
    return {"score": score, "coupling": coupling, "complexity": complexity, "churn": churn,
            "decay_flags": flags, "review_note": note, "concerns": concerns}

modules = {}
modules["shared-foundation"] = {
 "id":"shared-foundation","last_analyzed_at":NOW,"name":"共享基础","layer":"foundation",
 "responsibility":"文件原子读写、21 语国际化、模型图标与品牌资产",
 "files":["packages/file/**","packages/i18n/**","packages/modelIcons/**","packages/assets/**"],
 "key_entries":[
   {"file":"packages/file/src/index.ts","symbol":"writeAtomic","kind":"function"},
   {"file":"packages/file/src/access.ts","symbol":"withFileAccess","kind":"function"},
   {"file":"packages/i18n/src/index.ts","symbol":"translate","kind":"function"},
   {"file":"packages/i18n/src/transform.ts","symbol":"transform","kind":"function"},
   {"file":"packages/modelIcons/src/getModelIcon.ts","symbol":"getModelIcon","kind":"function"}],
 "dependencies":[],
 "health":h(84,"high","low","low",[],
   "15 文件 1,077 行，出边 0、入边 9，是最干净的基础叶子；file 统一原子写与独占重命名，i18n 在构建期由 transform.ts 抽取文案。近 3 个月 8 次提交、21 次文件变更。建议为消息键生成联合类型并在 CI 校验 21 个语言包与 messageSources 的键集合一致，避免构建期映射静默漂移。",
   [{"id":"c-shared-foundation-1","severity":"high",
     "finding":"packages/i18n 在构建期由 transform.ts（299 行）改写源码抽取文案，21 个语言包的键存在性只靠全量构建时校验，类型层发现不了漂移。",
     "suggestion":"由消息源生成键的联合类型，并在 CI 中校验 21 个语言包键集合与 messageSources 一致。"}])}

modules["media-toolkit"] = {
 "id":"media-toolkit","last_analyzed_at":NOW,"name":"音视频基础能力","layer":"foundation",
 "responsibility":"FFmpeg 二进制管理、音视频转码与浏览器语音识别封装",
 "files":["packages/ffmpeg/**","packages/asr/**"],
 "key_entries":[
   {"file":"packages/ffmpeg/src/runtime.ts","symbol":"createFfmpeg","kind":"function"},
   {"file":"packages/ffmpeg/src/index.ts","symbol":"executeRemoteFfmpeg","kind":"function"},
   {"file":"packages/ffmpeg/src/catalog.ts","symbol":"catalog","kind":"config"},
   {"file":"packages/asr/src/index.ts","symbol":"createBrowserAsr","kind":"function"}],
 "dependencies":["shared-foundation"],
 "health":h(82,"medium","medium","low",[],
   "8 文件 1,062 行，入边 5、出边 1；FFmpeg 运行时按 catalog.ts 下载/校验并回退系统 PATH，ASR 仅封装浏览器语音识别。近 3 个月 9 次提交、21 次文件变更。建议固定二进制版本与 checksum，并在 /api/ffmpeg/status 暴露实际版本、来源与校验结果，降低“同机不同编码器”的排障成本。",
   [{"id":"c-media-toolkit-1","severity":"high",
     "finding":"FFmpeg 二进制按 catalog.ts 下载并回退系统 PATH，实际版本与来源随机器不同，只会在具体转码任务失败时暴露。",
     "suggestion":"固定版本与 checksum，在 /api/ffmpeg/status 返回实际版本/来源/校验结果，下载失败降级为显式错误。"}])}

modules["ai-providers"] = {
 "id":"ai-providers","last_analyzed_at":NOW,"name":"模型供应商适配","layer":"domain",
 "responsibility":"语言与媒体模型供应商适配：模型目录、调用、价格与计费",
 "files":["packages/providers/**"],
 "key_entries":[
   {"file":"packages/providers/index.ts","symbol":"mediaProviders","kind":"config"},
   {"file":"packages/providers/types.d.ts","symbol":"ProviderDefinition","kind":"interface"},
   {"file":"packages/providers/src/media/compshare.ts","symbol":"default","kind":"function"},
   {"file":"packages/providers/src/media/tfRouter.ts","symbol":"default","kind":"function"}],
 "dependencies":["media-toolkit"],
 "health":h(68,"low","high","medium",["god_file","large_module"],
   "8 文件 3,009 行；compshare.ts 单文件 1,839 行（占 61%）集中模型目录、价格、生成、轮询与计费，近 3 个月 16 次提交、39 次文件变更。建议按 models/price/generate/poll 拆分并通过 ProviderDefinition 组合，把提交-轮询抽成公共 SDK，供应商接口变更只落在差异文件。",
   [{"id":"c-ai-providers-1","severity":"critical",
     "finding":"compshare.ts 单文件 1,839 行（占模块 3,009 行的 61%）同时实现模型目录、价格、生成、任务轮询与计费。",
     "suggestion":"按 models/price/generate/poll 拆分并通过 ProviderDefinition 组合，公共提交-轮询逻辑下沉为 SDK。"}])}

modules["agent-tools"] = {
 "id":"agent-tools","last_analyzed_at":NOW,"name":"Agent 工具与 MCP","layer":"domain",
 "responsibility":"Agent 工具插件与 MCP 服务：浏览器、画布、素材、检索与技能操作",
 "files":["packages/tools/**","packages/toolScaffold/**","packages/mcp/**"],
 "key_entries":[
   {"file":"packages/toolScaffold/src/runtime.ts","symbol":"toolMetadataSchema","kind":"config"},
   {"file":"packages/tools/browser/src/host.ts","symbol":"createBrowserHost","kind":"function"},
   {"file":"packages/tools/canvas/src/runtime.ts","symbol":"canvasOperations","kind":"function"},
   {"file":"packages/mcp/src/index.ts","symbol":"createMcpRouter","kind":"function"}],
 "dependencies":["shared-foundation","media-toolkit"],
 "health":h(78,"medium","medium","medium",[],
   "37 文件 3,592 行，入边 4、出边 2；10 个工具包以 .tool.js 产物由 server 装载，MCP 复用同一批工具定义，browser 工具自带 CDP 宿主与 Vue 面板。近 3 个月 15 次提交、70 次文件变更。建议为工具清单加契约测试，并把 browser 的 protocol/host/panel 拆成显式出口，宿主升级只改实现层。",
   [{"id":"c-agent-tools-1","severity":"high",
     "finding":"browser 工具在 host.ts（717 行）内实现 CDP 会话与元素解析，browserPanel.vue（616 行）又直接消费同一包内状态，协议、宿主与面板无法独立升级。",
     "suggestion":"抽出 browser-protocol/client 包并锁定宿主版本，面板只依赖协议客户端。"}])}

modules["agent-runtime"] = {
 "id":"agent-runtime","last_analyzed_at":NOW,"name":"Agent 运行时","layer":"domain",
 "responsibility":"Agent 会话主循环、模型选择、子代理、团队、技能与 A2A 协作编排",
 "files":["apps/server/src/agent/**","packages/teamScaffold/**","packages/teams/**","packages/skills/**"],
 "key_entries":[
   {"file":"apps/server/src/agent/runtime/index.ts","symbol":"run","kind":"function"},
   {"file":"apps/server/src/agent/runtime/sessions.ts","symbol":"registerAgentSession","kind":"function"},
   {"file":"apps/server/src/agent/a2a/index.ts","symbol":"createA2aRouter","kind":"function"},
   {"file":"apps/server/src/agent/teams/index.ts","symbol":"createTeamRunner","kind":"function"}],
 "dependencies":["agent-tools","shared-foundation","server-api"],
 "health":h(64,"medium","high","medium",["circular_dep","responsibility_overlap"],
   "30 文件 3,633 行，入边 2、出边 3；承担主循环、会话注册、模型选择、子代理、团队、技能与 A2A，20 个文件中 69 处 import 指回 server-api 的 utils/lib，server-api 又 24 处反向 import @/agent。近 3 个月 18 次提交、103 次文件变更。建议定义 AgentHost 端口注入 conf/workspace/ai/teams/mcp，并拆出 session registry、request supervisor 与 runner。",
   [{"id":"c-agent-runtime-1","severity":"critical",
     "finding":"Agent 运行时在 20 个文件中 69 处 import @/utils、@/lib 实现，server-api 又 24 处 import @/agent，utils.ts 还把 agent 聚合进服务入口，模块环落在每条 Agent 请求路径上。",
     "suggestion":"定义 AgentHost 端口（conf/workspace/ai/teams/mcp）由 createApp 注入，runtime 只依赖端口与内部类型，utils.ts 不再导出 agent。"},
    {"id":"c-agent-runtime-2","severity":"high",
     "finding":"runtime/index.ts（466 行）、sessions.ts（467 行）、requests.ts（393 行）把主循环、会话注册表、看门狗与重试混在同一层，会话隔离与单测都要跨这三个文件。",
     "suggestion":"拆出 session registry、request supervisor 与 runner，事件流改为显式接口。"}])}

modules["server-api"] = {
 "id":"server-api","last_analyzed_at":NOW,"name":"服务边界与业务编排","layer":"application",
 "responsibility":"Express 边界、154 个单接口路由与媒体/素材/插件/MCP/工作区编排",
 "files":["apps/server/src/app.ts","apps/server/src/index.ts","apps/server/src/core.ts","apps/server/src/router.ts","apps/server/src/utils.ts","apps/server/src/remoteConnection.ts","apps/server/src/lib/**","apps/server/src/routes/**","apps/server/src/types/**","apps/server/src/utils/**","apps/server/scripts/**"],
 "key_entries":[
   {"file":"apps/server/src/app.ts","symbol":"createApp","kind":"function"},
   {"file":"apps/server/src/core.ts","symbol":"generateRouter","kind":"function"},
   {"file":"apps/server/src/remoteConnection.ts","symbol":"createRemoteConnection","kind":"function"},
   {"file":"apps/server/src/routes/assets/list.ts","symbol":"GET /api/assets/list","kind":"route"},
   {"file":"apps/server/src/utils/assets/library.ts","symbol":"listAssetEntries","kind":"function"}],
 "dependencies":["shared-foundation","agent-runtime","agent-tools","ai-providers","media-toolkit","desktop-shell"],
 "notes":"2026-10-25 新增素材库子系统：routes/assets 18 文件 + utils/assets 9 文件，共 2,551 行，当前仍归入本模块。",
 "health":h(54,"critical","high","high",["god_module","circular_dep","coupling_high"],
   "228 文件 13,815 行、154 个单接口路由，入边 4、出边 6；同时承载媒体生成/计费、素材库、插件安装、MCP、工作区与命令执行。近 3 个月 36 次提交、488 次文件变更。建议先按素材库/媒体生成拆子模块，再收敛 utils.ts 聚合入口，routes 只做校验与编排。",
   [{"id":"c-server-api-1","severity":"critical",
     "finding":"模块 228 文件、13,815 行、154 个单接口路由，同时承担媒体生成/计费、素材库（27 文件 2,551 行）、插件安装、MCP、工作区与命令执行。",
     "suggestion":"先把素材库与媒体生成拆成独立应用模块，并按 routes 域拆目录，app.ts 只保留组合根。"},
    {"id":"c-server-api-2","severity":"critical",
     "finding":"utils.ts 以 34 个 namespace 聚合全部服务并被 138 个文件 import u，其中包含 @/agent，任何路由都隐式依赖 Agent 实现并放大与 agent-runtime 的环。",
     "suggestion":"拆分 utils 聚合入口为按域导入，移除对 @/agent 的聚合，服务通过构造注入而非全局 u。"},
    {"id":"c-server-api-3","severity":"high",
     "finding":"/api/exec 允许本机页面执行任意 shell 命令，仅靠本机来源、应用头与工作区路径校验，缺少逐命令审批与审计，只有 8 并发/1 小时上限。",
     "suggestion":"增加显式用户确认与审计日志，按工作区限制并发、时长与可执行命令白名单。"}])}

modules["workflow-nodes"] = {
 "id":"workflow-nodes","last_analyzed_at":NOW,"name":"画布节点插件","layer":"presentation",
 "responsibility":"短剧画布节点插件与共享节点 UI/运行时脚手架",
 "files":["packages/nodes/**","packages/nodeShared/**","packages/nodeScaffold/**"],
 "key_entries":[
   {"file":"packages/nodeScaffold/src/useNode.ts","symbol":"useNode","kind":"function"},
   {"file":"packages/nodeScaffold/src/nodeSkeleton.vue","symbol":"nodeSkeleton","kind":"function"},
   {"file":"packages/nodeShared/src/useNodeGeneration.ts","symbol":"useNodeGeneration","kind":"function"},
   {"file":"packages/nodes/director3dNode/src/index.vue","symbol":"director3dNode","kind":"function"}],
 "dependencies":["agent-tools","media-toolkit","shared-foundation"],
 "health":h(72,"medium","high","medium",["build_duplication","large_module"],
   "94 文件 16,675 行，入边 1、出边 3；9 个节点包各自维护 vite.config.ts（合计 72 行近似配置）与独立构建脚本；nodeSkeleton.vue 821 行为全部节点提供 UI 基座。近 3 个月 18 次提交、185 次文件变更。建议把重复构建配置收敛为共享 preset，并把骨架拆成布局/状态/操作三段、版本化接口。",
   [{"id":"c-workflow-nodes-1","severity":"high",
     "finding":"9 个节点包各自维护 vite.config.ts（合计 72 行近似配置）与独立构建脚本，新增节点靠脚手架复制。",
     "suggestion":"抽 @toonflow/nodes-build preset，节点只保留 package.json 与入口，差异用参数表达。"},
    {"id":"c-workflow-nodes-2","severity":"high",
     "finding":"nodeSkeleton.vue（821 行）是所有节点共用的 UI 基座，一处改动会同时影响全部 9 个节点插件。",
     "suggestion":"拆分骨架为布局/状态/操作三段并发布版本化接口，节点按需组合。"}])}

modules["canvas-extensions"] = {
 "id":"canvas-extensions","last_analyzed_at":NOW,"name":"画布扩展插件","layer":"presentation",
 "responsibility":"画布扩展插件（文本/图片/媒体/Markdown/节点）及注册脚手架",
 "files":["packages/ext/**","packages/extScaffold/**"],
 "key_entries":[
   {"file":"packages/extScaffold/src/runtime.ts","symbol":"defineExt","kind":"function"},
   {"file":"packages/ext/md/src/index.ts","symbol":"default","kind":"function"},
   {"file":"packages/ext/canvasNode/src/index.vue","symbol":"canvasNodeExtension","kind":"function"}],
 "dependencies":["shared-foundation"],
 "health":h(82,"low","medium","low",["duplicated_code"],
   "30 文件 2,519 行，入边 1、出边 1；扩展统一通过 defineExt 注册，md 扩展 index.vue 847 行，且与 textNode 各存一份近似 markdown 实现。近 3 个月仅 3 次提交、32 次文件变更。建议抽共享 markdown 渲染包，扩展只保留宿主差异。",
   [{"id":"c-canvas-extensions-1","severity":"high",
     "finding":"packages/ext/md 的 markdownExtensions.ts 与 textNode 版本仅差 4 行、markdownContent.ts 仅差 13 行，渲染行为改动需双份同步。",
     "suggestion":"抽 @toonflow/markdown 共享包，两处改为依赖同一实现，扩展只保留宿主差异。"}])}

modules["web-console"] = {
 "id":"web-console","last_analyzed_at":NOW,"name":"Vue 工作台","layer":"presentation",
 "responsibility":"Vue 工作台：画布、素材库、文档、对话与设置界面及本地状态",
 "files":["apps/web/**","postcss.config.ts"],
 "key_entries":[
   {"file":"apps/web/src/main.ts","symbol":"bootstrap","kind":"cli"},
   {"file":"apps/web/src/router/index.ts","symbol":"router","kind":"config"},
   {"file":"apps/web/src/stores/workspace.ts","symbol":"useWorkspaceStore","kind":"function"},
   {"file":"apps/web/src/pages/workspace/panels/canvas/index.vue","symbol":"canvasPanel","kind":"function"},
   {"file":"apps/web/src/pages/workspace/panels/assetLibrary/index.vue","symbol":"assetLibraryPanel","kind":"function"}],
 "dependencies":["server-api","agent-runtime","agent-tools","ai-providers","workflow-nodes","shared-foundation","canvas-extensions","media-toolkit"],
 "notes":"素材库面板（apps/web/src/pages/workspace/panels/assetLibrary）为 2026-10-25 新增，共 20 个文件。",
 "health":h(62,"high","high","high",["large_module","coupling_high"],
   "172 文件 41,214 行，是最大呈现模块，入边 1、出边 8；canvas/index.vue 1,525 行、pluginMarket 1,145 行、home 1,053 行、fileTree 986 行；13 个文件静态 import 16 处插件包，38 处引用 server 源码契约、124 处 /api 调用。近 3 个月 51 次提交、538 次文件变更。建议把画布/设置/首页/素材库拆子模块、插件 UI 改为注册表动态加载、共享类型下沉 contracts 包。",
   [{"id":"c-web-console-1","severity":"high",
     "finding":"canvas/index.vue 1,525 行、pluginMarket 1,145 行、home/index.vue 1,053 行、fileTree.vue 986 行，视图、拖拽状态与接口调用混在同一 SFC。",
     "suggestion":"抽出 composable/store 与纯渲染子组件，按面板拆目录，单文件控制在可评审范围。"},
    {"id":"c-web-console-2","severity":"high",
     "finding":"web 在 13 个文件中静态 import 16 处 node-/tool-/ext- 插件包（tool 8、ext 4、node 1），插件 UI 被编入主包，安装式扩展无法作用于界面。",
     "suggestion":"改为插件注册表 + 动态 import 入口，构建期只保留 scaffold 类型与受信内置插件。"},
    {"id":"c-web-console-3","severity":"high",
     "finding":"web 有 38 处 import @toonflow/server 源码契约、124 处硬编码 /api 调用，前后端契约没有独立包。",
     "suggestion":"把 agent types、modelReasoning、documentFormats、nodeMenu 等抽到 contracts 包，web 只依赖契约。"}])}

modules["desktop-shell"] = {
 "id":"desktop-shell","last_analyzed_at":NOW,"name":"桌面壳与更新分发","layer":"host-shell",
 "responsibility":"Electrobun 桌面壳、原生安装/更新程序、兼容层与更新分发",
 "files":["apps/desktop/**","apps/updateServer/**","packages/startup/**","compat/macIntel/**","electrobun.config.ts","hutch.config.ts"],
 "key_entries":[
   {"file":"apps/desktop/src/index.ts","symbol":"main","kind":"cli"},
   {"file":"apps/desktop/src/protocol.ts","symbol":"parseInstallUrl","kind":"function"},
   {"file":"apps/desktop/src/update/windowsUpdater.ts","symbol":"createWindowsUpdater","kind":"function"},
   {"file":"apps/updateServer/src/app.ts","symbol":"createApp","kind":"function"},
   {"file":"packages/startup/src/index.ts","symbol":"showNativeSplash","kind":"function"}],
 "dependencies":["server-api","shared-foundation"],
 "health":h(78,"low","medium","high",[],
   "37 文件 4,269 行，入边 1、出边 2；Electrobun 壳、NSIS/原生辅助程序、startup 启动画面、macIntel 兼容层与 updateServer 同属交付链路；updateHelper.cs 657 行、windowsUpdater.ts 378 行。近 3 个月 37 次提交、121 次文件变更。建议把 apps/desktop/src/index.ts 拆为 window/protocol/installer/updater 四段装配，并让更新清单/签名校验集中在 updateServer。",
   [{"id":"c-desktop-shell-1","severity":"high",
     "finding":"apps/desktop/src/index.ts（372 行）同时处理窗口创建、URL 协议、插件安装队列、启动画面与更新启动，平台分支难以单独测试。",
     "suggestion":"拆为 window/protocol/installer/updater 模块，index.ts 只做装配与事件转发。"}])}

modules["mobile-shell"] = {
 "id":"mobile-shell","last_analyzed_at":NOW,"name":"移动端宿主","layer":"host-shell",
 "responsibility":"Android WebView 宿主、OHOS 运行时与移动构建兼容层",
 "files":["apps/mobile/**","compat/ohos/**"],
 "key_entries":[
   {"file":"apps/mobile/src/server.ts","symbol":"main","kind":"cli"},
   {"file":"apps/mobile/native/mobileActivity.java","symbol":"mobileActivity","kind":"class"},
   {"file":"compat/ohos/runtime.ts","symbol":"createTranspiler","kind":"function"}],
 "dependencies":["server-api","shared-foundation","web-console"],
 "health":h(74,"low","high","low",[],
   "20 文件 3,502 行，入边 0、出边 3；Android WebView 宿主、OHOS 运行与原生桥接同属移动壳，mobileActivity.java 1,004 行承载 WebView、权限、文件导出与生命周期。近 3 个月 6 次提交、35 次文件变更。建议按 webview/bridge/export 拆类，并让 OHOS 运行时通过显式桥接协议与 Android 对齐。",
   [{"id":"c-mobile-shell-1","severity":"high",
     "finding":"mobileActivity.java 单文件 1,004 行同时管理 WebView、权限、文件导出与生命周期。",
     "suggestion":"按 webview/bridge/export 拆类，Activity 只保留装配与生命周期转发。"}])}

# edges: (from,to,type,strength,label,count,files,violation)
E=[
 ("media-toolkit","shared-foundation","import","normal","i18n 文案与 file 读写",7,3,False),
 ("ai-providers","media-toolkit","import","weak","ffmpeg 类型契约",2,2,False),
 ("agent-tools","shared-foundation","import","normal","file/i18n 基础调用",9,6,False),
 ("agent-tools","media-toolkit","import","normal","asr 与 ffmpeg 客户端",5,3,False),
 ("agent-runtime","agent-tools","import","strong","tools-scaffold 运行时与工具上下文",16,12,False),
 ("agent-runtime","shared-foundation","import","normal","file 会话文件",12,12,False),
 ("agent-runtime","server-api","import","strong","conf/workspace/ai/teams 应用能力",69,20,True),
 ("server-api","shared-foundation","import","strong","file/i18n/模型图标",75,71,False),
 ("server-api","agent-runtime","import","strong","agent.run / a2a / teams",24,14,False),
 ("server-api","agent-tools","import","strong","MCP 与工具运行时",25,20,False),
 ("server-api","ai-providers","import","normal","供应商清单与模型目录",9,7,False),
 ("server-api","media-toolkit","import","normal","ffmpeg 执行",4,2,False),
 ("server-api","desktop-shell","config","weak","启动读取 electrobun.config 的 app.version",2,2,True),
 ("workflow-nodes","agent-tools","import","weak","tools-scaffold 类型",3,2,False),
 ("workflow-nodes","media-toolkit","import","normal","ffmpeg/asr",7,4,False),
 ("workflow-nodes","shared-foundation","import","weak","file/i18n",1,1,False),
 ("canvas-extensions","shared-foundation","import","weak","file/i18n",3,3,False),
 ("web-console","server-api","api","strong","REST /api 与 server 契约类型",124,90,False),
 ("web-console","agent-runtime","import","normal","agent 会话类型与 mentionSources",18,15,False),
 ("web-console","agent-tools","import","strong","工具面板与运行时",16,11,False),
 ("web-console","ai-providers","import","normal","供应商清单与模板",15,10,False),
 ("web-console","workflow-nodes","import","strong","节点 UI 与运行时",32,25,False),
 ("web-console","shared-foundation","import","strong","i18n/assets/模型图标",70,63,False),
 ("web-console","canvas-extensions","import","weak","ext-scaffold 运行时",4,4,False),
 ("web-console","media-toolkit","import","weak","asr 语音输入",2,2,False),
 ("desktop-shell","server-api","call","strong","内嵌 createApp / remoteConnection / i18n",15,6,False),
 ("desktop-shell","shared-foundation","import","strong","file/i18n/startup",25,17,False),
 ("mobile-shell","server-api","call","normal","内嵌 createApp 与 remoteConnection",5,1,False),
 ("mobile-shell","shared-foundation","import","normal","file 读写",14,7,False),
 ("mobile-shell","web-console","import","weak","browserCapabilities 探针",1,1,False),
]
edges=[]
for i,(f,t,ty,st,label,count,nfiles,viol) in enumerate(E,1):
    e={"id":f"e{i}","from":f,"to":t,"type":ty,"label":label,"strength":st}
    if viol: e["direction_violation"]=True
    edges.append(e)
by_mod={}
for e in edges: by_mod.setdefault(e["from"],[]).append(e)

# write parts via CLI (validation) in emit order
order=json.load(open(".easyvibe/map/emit_order.json"))["modules"]
for idx,mid in enumerate(order,1):
    mod=modules[mid]
    deps=sorted({e["to"] for e in by_mod.get(mid,[])})
    assert sorted(mod["dependencies"])==deps,(mid,mod["dependencies"],deps)
    p=subprocess.run([sys.executable,CLI,"emit-module"],input=json.dumps(mod,ensure_ascii=False),
                     text=True,capture_output=True,env=ENV)
    if p.returncode!=0:
        print("EMIT FAIL",mid,p.stderr); sys.exit(1)
    ed={"module":mid,"edges":by_mod.get(mid,[])}
    p=subprocess.run([sys.executable,CLI,"write-edges"],input=json.dumps(ed,ensure_ascii=False),
                     text=True,capture_output=True,env=ENV)
    if p.returncode!=0:
        print("EDGE FAIL",mid,p.stderr); sys.exit(1)
    # progress + growth
    pct=35+round(35*idx/len(order))
    prog={"phase":"module-analysis","modules_total":len(order),"modules_done":idx,
          "current_module":mid,"percent":pct,"updated_at":datetime.now().astimezone().isoformat(timespec="seconds")}
    tmp=".easyvibe/map/progress.json.tmp"
    open(tmp,"w",encoding="utf-8").write(json.dumps(prog,ensure_ascii=False,indent=2)+"\n")
    os.replace(tmp,".easyvibe/map/progress.json")
    p=subprocess.run([sys.executable,CLI,"append-log"],capture_output=True,text=True,env=ENV)
    if p.returncode!=0:
        print("APPEND FAIL",mid,p.stderr); sys.exit(1)
    print(f"{idx}/{len(order)} {mid} part+edges+growth ok ({pct}%) -> {p.stdout.strip()}")
print("ALL PARTS DONE")
