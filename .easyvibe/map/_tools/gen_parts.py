import json, os, datetime
ROOT='/Users/liyuhang/Documents/git_projects/Toonflow-app-master'
NOW=datetime.datetime.now().astimezone().isoformat(timespec='seconds')
P=os.path.join(ROOT,'.easyvibe/map/parts')

def h(score,coupling,complexity,churn,flags,note,concerns=None):
    d={"score":score,"coupling":coupling,"complexity":complexity,"churn":churn,
       "decay_flags":flags,"review_note":note}
    if concerns is not None: d["concerns"]=concerns
    return d

def c(mid,i,sev,finding,suggestion):
    return {"id":f"c-{mid}-{i}","severity":sev,"finding":finding,"suggestion":suggestion}

mods={}

mods['shared-foundation']={
 "id":"shared-foundation","name":"共享基础","layer":"foundation",
 "responsibility":"文件读写、国际化、模型图标与品牌资产等零业务基础件",
 "files":["packages/file/**","packages/i18n/**","packages/modelIcons/**","packages/assets/**"],
 "key_entries":[
   {"file":"packages/file/src/index.ts","symbol":"writeAtomic","kind":"function"},
   {"file":"packages/i18n/src/index.ts","symbol":"translate","kind":"function"},
   {"file":"packages/modelIcons/src/index.ts","symbol":"getModelIcon","kind":"function"}],
 "dependencies":[],
 "health":h(86,"high","low","low",[],
   "15 文件 1,077 行，出边为 0、被 9 个模块引用，是干净的基础叶子；file 统一原子写与 Android/OHOS 独占重命名，i18n 承担编译期文案抽取。入边多是基础件的正常形态，但建议为 transform.ts（299 行）补回归用例，并把 locales 按语言拆包以缩短构建链路。",
   [c('shared-foundation',1,"high",
      "i18n 通过 transform.ts（299 行）在构建期改写源码提取文案，消息键与 messageSources.json 靠全量构建校验，键漂移在类型层无法发现。",
      "为消息键生成类型声明并在 CI 跑键存在性检查，把 transform 映射表纳入受控清单与回归测试。")]),
 "last_analyzed_at":NOW}

mods['media-toolkit']={
 "id":"media-toolkit","name":"音视频基础能力","layer":"foundation",
 "responsibility":"FFmpeg 二进制管理与音视频处理、浏览器语音识别封装",
 "files":["packages/ffmpeg/**","packages/asr/**"],
 "key_entries":[
   {"file":"packages/ffmpeg/src/runtime.ts","symbol":"createFfmpeg","kind":"function"},
   {"file":"packages/ffmpeg/src/catalog.ts","symbol":"builds","kind":"config"},
   {"file":"packages/asr/src/index.ts","symbol":"createBrowserAsr","kind":"function"}],
 "dependencies":[],
 "health":h(82,"medium","medium","low",[],
   "8 文件 1,062 行，FFmpeg 负责下载/校验/回退系统二进制的三态选择，ASR 仅浏览器端封装；browser/remote/runtime 出口清晰。建议在 ffmpeg 状态接口暴露实际二进制来源与版本，降低“同机不同编码器”的排障成本。",
   [c('media-toolkit',1,"high",
      "FFmpeg 运行时按 catalog.ts 下载二进制并回退系统 PATH，不同机器的编码器版本与来源不一致，问题只在具体转码任务失败时暴露。",
      "固定目标版本与 checksum，在 /api/ffmpeg/status 暴露实际版本、来源与校验结果，并把下载失败降级为显式错误。")]),
 "last_analyzed_at":NOW}

mods['ai-providers']={
 "id":"ai-providers","name":"模型供应商适配","layer":"domain",
 "responsibility":"语言与媒体模型供应商适配：模型目录、调用、价格与计费",
 "files":["packages/providers/**"],
 "key_entries":[
   {"file":"packages/providers/index.ts","symbol":"mediaProviders","kind":"config"},
   {"file":"packages/providers/types.d.ts","symbol":"ProviderDefinition","kind":"interface"},
   {"file":"packages/providers/src/media/compshare.ts","symbol":"default","kind":"config"}],
 "dependencies":[],
 "health":h(70,"low","high","low",["god_module"],
   "8 文件 3,009 行，语言/媒体供应商统一以 ProviderDefinition 暴露；compshare.ts 单文件 1,839 行集中了模型目录、价格、生成与轮询。建议抽媒体供应商公共 SDK，compshare 只保留差异，并把 web 端以 ?raw 引用的源码移出前端包。",
   [c('ai-providers',1,"critical",
      "compshare.ts 单文件 1,839 行同时实现模型清单、价格、生成、任务轮询与计费，任何供应商接口变更都落在同一文件。",
      "按 models/price/generate/poll 拆分并在 ProviderDefinition 组合，公共提交-轮询逻辑下沉为 SDK。"),
    c('ai-providers',2,"high",
      "设置页与 hello 页共 5 处用 ?raw 直接打包 providers/media/*.ts 源码作为自定义供应商模板，前端包与供应商实现强绑定。",
      "把模板源码移至独立 assets 包或由 server 接口下发，前端只保留类型与元数据。")]),
 "last_analyzed_at":NOW}

mods['agent-tools']={
 "id":"agent-tools","name":"Agent 工具与 MCP","layer":"domain",
 "responsibility":"Agent 工具插件与 MCP 服务：浏览器、画布、资产、检索等能力",
 "files":["packages/tools/**","packages/mcp/**","packages/toolScaffold/**"],
 "key_entries":[
   {"file":"packages/toolScaffold/src/runtime.ts","symbol":"toolMetadataSchema","kind":"config"},
   {"file":"packages/tools/browser/src/index.ts","symbol":"default","kind":"config"},
   {"file":"packages/tools/canvas/src/runtime.ts","symbol":"canvasOperations","kind":"config"},
   {"file":"packages/mcp/src/index.ts","symbol":"createMcpRouter","kind":"function"}],
 "dependencies":[],
 "health":h(78,"medium","medium","low",[],
   "37 文件 3,579 行，工具以 .tool.js 产物被 server 装载，MCP 复用同一批工具定义；browser 工具自带宿主协议与 Vue 面板。建议为工具清单加契约测试，并把 browser 的协议/宿主/面板拆成三个显式出口。",
   [c('agent-tools',1,"high",
      "browser 工具在 host.ts（717 行）内自建浏览器会话、CDP 协议与元素引用解析，协议、宿主与面板同包演进，升级 Puppeteer 时需三处同步。",
      "抽出 browser-protocol/client 包并锁定宿主版本，面板只依赖协议客户端，宿主实现可独立替换。")]),
 "last_analyzed_at":NOW}

mods['agent-runtime']={
 "id":"agent-runtime","name":"Agent 运行时","layer":"domain",
 "responsibility":"Agent 会话运行、子代理/团队/技能与 A2A 协作编排",
 "files":["apps/server/src/agent/**","packages/skills/**","packages/teams/**","packages/teamScaffold/**"],
 "key_entries":[
   {"file":"apps/server/src/agent/runtime/index.ts","symbol":"run","kind":"function"},
   {"file":"apps/server/src/agent/runtime/sessions.ts","symbol":"getActiveAgentSession","kind":"function"},
   {"file":"apps/server/src/agent/a2a/index.ts","symbol":"createA2aRouter","kind":"function"},
   {"file":"apps/server/src/agent/teams/index.ts","symbol":"createTeamRunner","kind":"function"}],
 "dependencies":[],
 "health":h(70,"medium","high","low",["circular_dep"],
   "30 文件 3,492 行，承担会话主循环、模型选择、子代理、团队、技能与 A2A 六类职责；66 处 import 指回 server-api 的 utils/lib，而 server-api 又导出 agent。建议将 conf/workspace/ai/teams 抽象为 AgentHost 端口由 createApp 注入。",
   [c('agent-runtime',1,"critical",
      "Agent 运行时直接 import @/utils/conf、workspace/files、ai、teams 等应用层实现（66 处），server-api 的 utils.ts 与 app.ts 又反向导出 agent，形成模块环。",
      "定义 AgentHost 端口（配置/工作区/模型/团队）并在 createApp 注入，runtime 仅依赖端口与 agent 内部类型。"),
    c('agent-runtime',2,"high",
      "runtime/index.ts（462 行）与 sessions.ts（467 行）同时持有主循环、会话注册表与事件追踪，状态与编排混在单文件。",
      "拆出 session registry 与 runner，事件流改为显式接口，便于按会话隔离与单测。")]),
 "last_analyzed_at":NOW}

mods['server-api']={
 "id":"server-api","name":"服务边界与业务编排","layer":"application",
 "responsibility":"Express 路由边界、媒体/插件/工作区业务编排与应用装配",
 "files":["apps/server/src/app.ts","apps/server/src/index.ts","apps/server/src/core.ts","apps/server/src/router.ts","apps/server/src/utils.ts","apps/server/src/remoteConnection.ts","apps/server/src/lib/**","apps/server/src/routes/**","apps/server/src/types/**","apps/server/src/utils/**","apps/server/scripts/**"],
 "key_entries":[
   {"file":"apps/server/src/app.ts","symbol":"createApp","kind":"function"},
   {"file":"apps/server/src/core.ts","symbol":"generateRouter","kind":"function"},
   {"file":"apps/server/src/remoteConnection.ts","symbol":"createRemoteConnection","kind":"function"},
   {"file":"apps/server/src/routes/settings/get.ts","symbol":"GET /api/settings/get","kind":"route"}],
 "dependencies":[],
 "health":h(62,"critical","high","low",["god_module","circular_dep","coupling_high"],
   "201 文件 10,856 行、138 个单接口路由，模块同时承载 HTTP 边界、媒体生成/计费、插件安装、MCP、工作区与单 Agent；出边 5、入边 4。建议先按媒体、插件市场、工作区拆子模块，再把 agent 依赖的基础能力端口化，最后让 routes 只做校验与编排。",
   [c('server-api',1,"critical",
      "201 文件的模块同时承载 138 个路由、媒体生成/计费、插件安装、MCP 与工作区能力，god module 使任何改动都要全量回归。",
      "按 routes/media/plugins/workspace 拆成独立模块，保留 app.ts 作为唯一组合根。"),
    c('server-api',2,"critical",
      "server-api 与 agent-runtime 双向引用（server→agent 23 处、agent→server 66 处），应用层与领域层的依赖方向被打破。",
      "把 agent 需要的配置、工作区、模型能力抽成 foundation 端口，utils.ts 不再聚合导出 agent，由 app.ts 负责装配。"),
    c('server-api',3,"high",
      "路由由 core.ts 扫描文件生成 router.ts（281 行），仅 dev 环境自动刷新，源文件与生成文件存在漂移风险。",
      "把 router.ts 纳入构建校验（重新生成后 diff 必须为空），并在 CI 执行 bun run routes 检查。")]),
 "last_analyzed_at":NOW}

mods['canvas-extensions']={
 "id":"canvas-extensions","name":"画布扩展插件","layer":"presentation",
 "responsibility":"画布扩展插件（文本/图片/媒体/Markdown/节点）及注册脚手架",
 "files":["packages/ext/**","packages/extScaffold/**"],
 "key_entries":[
   {"file":"packages/extScaffold/src/runtime.ts","symbol":"defineExt","kind":"function"},
   {"file":"packages/ext/md/src/index.ts","symbol":"default","kind":"config"},
   {"file":"packages/ext/canvasNode/src/index.vue","symbol":"canvasNodeExtension","kind":"class"}],
 "dependencies":[],
 "health":h(83,"low","medium","low",["duplicated_code"],
   "26 文件 1,963 行，扩展统一通过 defineExt 注册；md 扩展 847 行，且 markdownExtensions.ts 与 textNode 的实现逐行重复。建议抽出共享 markdown 渲染包，md 扩展只保留宿主差异。",
   [c('canvas-extensions',1,"high",
      "packages/ext/md 与 packages/nodes/textNode 各存一份 markdownExtensions.ts（各 122 行，内容相同）和近似重复的 markdownContent.ts，渲染行为改动需双份同步。",
      "抽 @toonflow/markdown 共享包，两处改为依赖同一实现，扩展只保留宿主差异。")]),
 "last_analyzed_at":NOW}

mods['workflow-nodes']={
 "id":"workflow-nodes","name":"画布节点插件","layer":"presentation",
 "responsibility":"短剧画布节点插件与共享节点 UI/运行时脚手架",
 "files":["packages/nodes/**","packages/nodeShared/**","packages/nodeScaffold/**"],
 "key_entries":[
   {"file":"packages/nodeScaffold/src/useNode.ts","symbol":"useNode","kind":"function"},
   {"file":"packages/nodeScaffold/src/nodeSkeleton.vue","symbol":"nodeSkeleton","kind":"class"},
   {"file":"packages/nodes/director3dNode/src/index.vue","symbol":"director3dNode","kind":"class"},
   {"file":"packages/nodes/textNode/src/markdownEditor.vue","symbol":"markdownEditor","kind":"class"}],
 "dependencies":[],
 "health":h(76,"medium","high","low",["build_duplication"],
   "93 文件 16,146 行，9 个节点各自维护 vite.config 与 build.ts；nodeSkeleton.vue 786 行为全部节点提供 UI 基座。建议把重复构建配置收敛为共享 preset，并为节点元数据与端口契约加统一校验。",
   [c('workflow-nodes',1,"high",
      "9 个节点包各自复制 vite.config.ts 与 build.ts，新增节点靠脚手架复制，构建配置已出现多份近似实现。",
      "抽 @toonflow/nodes-build preset，节点只保留 package.json 与入口，构建差异用参数表达。"),
    c('workflow-nodes',2,"high",
      "nodeSkeleton.vue（786 行）是所有节点共用的 UI 基座，一处改动会同时影响全部节点插件。",
      "拆分骨架为布局/状态/操作三段并发布版本化接口，节点按需组合，避免基座变更引发全量回归。")]),
 "last_analyzed_at":NOW}

mods['web-console']={
 "id":"web-console","name":"Vue 工作台","layer":"presentation",
 "responsibility":"Vue 工作区界面：节点画布、文档面板、对话、设置与本地状态",
 "files":["apps/web/**","postcss.config.ts"],
 "key_entries":[
   {"file":"apps/web/src/main.ts","symbol":"bootstrap","kind":"function"},
   {"file":"apps/web/src/router/index.ts","symbol":"router","kind":"config"},
   {"file":"apps/web/src/stores/workspace.ts","symbol":"useWorkspaceStore","kind":"function"},
   {"file":"apps/web/src/pages/workspace/panels/canvas/index.vue","symbol":"canvasPanel","kind":"class"},
   {"file":"apps/web/src/components/agent/conversation/messageInput.vue","symbol":"messageInput","kind":"class"}],
 "dependencies":[],
 "health":h(72,"high","high","low",["god_module","coupling_high"],
   "147 文件 35,103 行，是最大的呈现模块；canvas/index.vue 1,246 行、pluginMarket 1,145 行、home 1,016 行，且 30 处 import 插件运行时包。建议把画布/设置/首页拆为子模块，把插件 UI 改为注册表加载，前后端共享类型下沉为契约包。",
   [c('web-console',1,"high",
      "画布、首页与插件市场单个 .vue 均超 1,000 行，视图、拖拽状态与接口调用混在同一 SFC。",
      "抽出 composable/store 与纯渲染子组件，按面板拆分目录，单文件控制在可评审范围。"),
    c('web-console',2,"high",
      "30 处编译期 import 节点/工具/扩展包（node-text、tool-canvas、ext-scaffold 等），插件 UI 被静态编入 web bundle，插件市场安装的扩展无法作用于界面。",
      "改为插件注册表加动态 import 插件入口，构建期只保留 scaffold 类型与受信内置插件。"),
    c('web-console',3,"high",
      "39 处直接 import @toonflow/server 的运行时/类型文件（其中 26 处 type-only），前后端契约没有独立包。",
      "把 agent types、documentFormats、nodeMenu 等契约抽到独立 contracts 包，web 不再引用 server 源码。")]),
 "last_analyzed_at":NOW}

mods['mobile-shell']={
 "id":"mobile-shell","name":"移动端宿主","layer":"host-shell",
 "responsibility":"Android/OHOS 移动端 WebView 宿主、桥接与移动构建兼容层",
 "files":["apps/mobile/**","compat/**"],
 "key_entries":[
   {"file":"apps/mobile/src/server.ts","symbol":"main","kind":"cli"},
   {"file":"apps/mobile/native/mobileActivity.java","symbol":"mobileActivity","kind":"class"},
   {"file":"compat/ohos/runtime.ts","symbol":"createTranspiler","kind":"function"}],
 "dependencies":[],
 "health":h(70,"low","high","low",["responsibility_overlap"],
   "25 文件 4,028 行，Android WebView 宿主、OHOS 运行时与 macIntel 兼容层三套平台代码同属一模块；mobileActivity.java 1,004 行承载 WebView、文件导出与生命周期。建议把 macIntel 兼容层迁回桌面侧，并拆分 Activity 的桥接与导出逻辑。",
   [c('mobile-shell',1,"high",
      "compat/macIntel 是桌面构建兼容层，却被归入移动壳，模块职责跨平台漂移，修改桌面构建会触碰移动模块。",
      "把 compat/macIntel 迁到 desktop-shell 或独立 tooling 模块，compat/ohos 留在移动壳。"),
    c('mobile-shell',2,"high",
      "mobileActivity.java 1,004 行单文件同时管理 WebView、权限、文件导出与生命周期，任何宿主能力调整都集中在这一文件。",
      "按 webview/bridge/export 拆类，Activity 只保留装配与生命周期转发。")]),
 "last_analyzed_at":NOW}

mods['desktop-shell']={
 "id":"desktop-shell","name":"桌面壳与更新分发","layer":"host-shell",
 "responsibility":"Electrobun 桌面壳、原生安装/更新程序与更新分发服务",
 "files":["apps/desktop/**","apps/updateServer/**","packages/startup/**","electrobun.config.ts","hutch.config.ts"],
 "key_entries":[
   {"file":"apps/desktop/src/index.ts","symbol":"main","kind":"cli"},
   {"file":"apps/desktop/src/protocol.ts","symbol":"parseInstallUrl","kind":"function"},
   {"file":"apps/desktop/src/update/windowsUpdater.ts","symbol":"createWindowsUpdater","kind":"function"},
   {"file":"apps/updateServer/src/app.ts","symbol":"createApp","kind":"function"},
   {"file":"packages/startup/src/index.ts","symbol":"showNativeSplash","kind":"function"}],
 "dependencies":[],
 "health":h(80,"low","medium","low",[],
   "32 文件 3,736 行，Electrobun 壳、NSIS/原生辅助程序、startup 启动画面与 updateServer 同属交付链路；运行期只依赖 server-api 与 file/i18n。建议把 apps/desktop/src/index.ts 拆为 window/protocol/installer/updater 四段装配。",
   [c('desktop-shell',1,"high",
      "apps/desktop/src/index.ts（365 行）单文件同时处理窗口创建、协议注册、插件安装队列、启动画面与更新启动，桌面入口难以分平台测试。",
      "拆为 window/protocol/installer/updater 模块，index.ts 只做装配与事件转发，平台分支收敛到各自模块。")]),
 "last_analyzed_at":NOW}

for mid,m in mods.items():
    json.dump(m,open(os.path.join(P,mid+'.json'),'w'),ensure_ascii=False,indent=2)
print('wrote',len(mods),'parts')
