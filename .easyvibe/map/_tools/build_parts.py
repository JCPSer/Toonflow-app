# -*- coding: utf-8 -*-
#!/usr/bin/env python3
"""Author module parts from the current code evidence and drive progress."""
import json, os, subprocess, sys
from datetime import datetime, timezone

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
MAP_DIR = os.path.join(ROOT, ".easyvibe", "map")
PARTS = os.path.join(MAP_DIR, "parts")
CLI = os.path.join(MAP_DIR, "_tools", "easyvibe_map2.py")
SCHEMA = os.environ.get("EASYVIBE_SCHEMA_PATH", os.path.expanduser("~/.easyvibe/assets/easyvibe-map-schema-v1.1.json"))
os.environ["EASYVIBE_SCHEMA_PATH"] = SCHEMA
NOW = datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")

LAYERS_BOTTOM_UP = [
    {"id": "foundation", "name": "基础能力层", "order": 4, "description": "文件访问、国际化、图标与音视频/语音基础能力，零业务依赖，被所有上层复用"},
    {"id": "domain", "name": "领域能力层", "order": 3, "description": "Agent 会话运行时、模型供应商适配与 Agent 工具插件，承载短剧创作的核心智能能力"},
    {"id": "application", "name": "应用服务层", "order": 2, "description": "Express 应用边界、单接口路由、媒体/插件/MCP/工作区业务编排与进程组合根"},
    {"id": "presentation", "name": "交互呈现层", "order": 1, "description": "Vue 工作区、画布节点与扩展插件：节点图编辑、文档面板、对话与设置界面"},
    {"id": "host-shell", "name": "宿主壳层", "order": 0, "description": "Electrobun 桌面端、Android/OHOS 移动端与更新分发服务，托管 Web 界面并提供原生能力"},
]

# Bottom-up append order: foundation -> domain -> application -> presentation -> host shells.
MODULE_ORDER = [
    "shared-foundation", "media-toolkit", "ai-providers", "agent-tools", "agent-runtime",
    "server-api", "workflow-nodes", "canvas-extensions", "web-console",
    "desktop-shell", "mobile-shell",
]

EDGES = [
    # id, from, to, type, strength, label, direction_violation
    ("e1", "media-toolkit", "shared-foundation", "import", "normal", "7 处 i18n/file 基础调用", False),
    ("e2", "ai-providers", "media-toolkit", "import", "weak", "2 处 ffmpeg 类型契约", False),
    ("e3", "agent-tools", "shared-foundation", "import", "normal", "9 处 file/i18n 基础调用", False),
    ("e4", "agent-tools", "media-toolkit", "import", "normal", "5 处 asr/ffmpeg 客户端", False),
    ("e5", "agent-runtime", "agent-tools", "import", "strong", "16 处 tools-scaffold 运行时与工具上下文", False),
    ("e6", "agent-runtime", "shared-foundation", "import", "normal", "28 处 file/i18n/formats import", False),
    ("e8", "server-api", "shared-foundation", "import", "strong", "91 处 file/i18n/模型图标/assets", False),
    ("e9", "server-api", "agent-runtime", "import", "strong", "17 处 agent 会话与 teams 契约 import", False),
    ("e10", "server-api", "agent-tools", "import", "strong", "25 处 MCP 与工具运行时", False),
    ("e11", "server-api", "ai-providers", "import", "normal", "9 处供应商清单与模型目录", False),
    ("e12", "server-api", "media-toolkit", "import", "normal", "4 处 ffmpeg 执行", False),
    ("e13", "server-api", "desktop-shell", "config", "weak", "启动读取 electrobun.config 的 app.version", True),
    ("e14", "workflow-nodes", "agent-tools", "import", "weak", "3 处 tools-scaffold 类型", False),
    ("e15", "workflow-nodes", "media-toolkit", "import", "normal", "7 处 ffmpeg/asr", False),
    ("e16", "workflow-nodes", "shared-foundation", "import", "weak", "1 处 file 构建脚手架", False),
    ("e17", "canvas-extensions", "shared-foundation", "import", "weak", "3 处 i18n/file", False),
    ("e18", "web-console", "server-api", "api", "strong", "30 文件 38 处 @toonflow/server 契约与 130 处 /api 字面调用", False),
    ("e19", "web-console", "agent-runtime", "import", "normal", "18 处 agent 类型与 mentionSources", False),
    ("e20", "web-console", "agent-tools", "import", "strong", "16 处工具面板与运行时", False),
    ("e21", "web-console", "ai-providers", "import", "normal", "15 处供应商清单与模板", False),
    ("e22", "web-console", "workflow-nodes", "import", "strong", "32 处节点 UI 与运行时", False),
    ("e23", "web-console", "shared-foundation", "import", "strong", "70 处 i18n/assets/模型图标", False),
    ("e24", "web-console", "canvas-extensions", "import", "weak", "4 处 ext-scaffold 运行时", False),
    ("e25", "web-console", "media-toolkit", "import", "weak", "2 处 asr 语音输入", False),
    ("e26", "desktop-shell", "server-api", "call", "strong", "14 处 createApp/remoteConnection/i18n 装配", False),
    ("e27", "desktop-shell", "shared-foundation", "import", "strong", "26 处 file/i18n/startup 启动", False),
    ("e28", "mobile-shell", "server-api", "call", "normal", "5 处 createApp/remoteConnection/i18n", False),
    ("e29", "mobile-shell", "shared-foundation", "import", "normal", "14 处 file 读写", False),
    ("e30", "mobile-shell", "web-console", "import", "weak", "1 处 browserCapabilities 探针", False),
    ("e31", "mobile-shell", "desktop-shell", "config", "weak", "启动读取 electrobun.config 的 app.version", False),
]

MODULES = {
 "shared-foundation": {
  "id": "shared-foundation",
  "name": "共享基础",
  "layer": "foundation",
  "responsibility": "文件原子读写、21 语国际化与模型图标的零业务基础件",
  "files": [
   "packages/file/**",
   "packages/i18n/**",
   "packages/modelIcons/**",
   "packages/assets/**",
   "packages/formats/**"
  ],
  "key_entries": [
   {
    "file": "packages/file/src/index.ts",
    "symbol": "writeAtomic",
    "kind": "function"
   },
   {
    "file": "packages/file/src/access.ts",
    "symbol": "withFileAccess",
    "kind": "function"
   },
   {
    "file": "packages/i18n/src/index.ts",
    "symbol": "translate",
    "kind": "function"
   },
   {
    "file": "packages/i18n/src/transform.ts",
    "symbol": "transformSource",
    "kind": "function"
   },
   {
    "file": "packages/modelIcons/src/getModelIcon.ts",
    "symbol": "getModelIcon",
    "kind": "function"
   }
  ],
  "health": {
   "score": 84,
   "coupling": "high",
   "complexity": "medium",
   "churn": "low",
   "decay_flags": [],
   "review_note": "20 文件 / 1,230 行（含 2026-10-27 新增的 packages/formats 纯契约包 5 文件 153 行：模型推理/文档格式/mention 源/A2A 设置类型），出边为 0、被 9 个模块引用，是干净的基础叶子；file 以原子写与路径访问队列托底全库磁盘操作。建议为 i18n/transform.ts（299 行）的源码改写加消息键存在性校验与类型声明，并把品牌图片资产与代码包解耦。",
   "concerns": [
    {
     "id": "c-shared-foundation-1",
     "severity": "high",
     "finding": "i18n 的 transform.ts（299 行）在构建期改写源码抽取文案，消息键与 21 个语言包之间没有生成类型，键漂移只能等完整构建或运行时才暴露。",
     "suggestion": "由 i18n 包生成消息键联合类型并在构建脚本中做键存在性校验，把 transform 映射表纳入受控清单。"
    }
   ]
  }
 },
 "media-toolkit": {
  "id": "media-toolkit",
  "name": "音视频基础能力",
  "layer": "foundation",
  "responsibility": "FFmpeg 二进制管理与音视频处理、浏览器语音识别封装",
  "files": [
   "packages/ffmpeg/**",
   "packages/asr/**"
  ],
  "key_entries": [
   {
    "file": "packages/ffmpeg/src/runtime.ts",
    "symbol": "createFfmpeg",
    "kind": "function"
   },
   {
    "file": "packages/ffmpeg/src/index.ts",
    "symbol": "installFfmpeg",
    "kind": "function"
   },
   {
    "file": "packages/ffmpeg/src/remote.ts",
    "symbol": "executeRemoteFfmpeg",
    "kind": "function"
   },
   {
    "file": "packages/asr/src/index.ts",
    "symbol": "createBrowserAsr",
    "kind": "function"
   }
  ],
  "health": {
   "score": 82,
   "coupling": "medium",
   "complexity": "medium",
   "churn": "low",
   "decay_flags": [],
   "review_note": "8 文件 / 1,062 行，出边 1、入边 5；FFmpeg 下载源集中声明并校验 sha256，安装走临时目录整体替换，浏览器/远程执行共用 browserTypes 白名单。建议把 ASR 能力探测从 UA 版本判断改为特性探测，避免宿主内核升级后静默失效。",
   "concerns": [
    {
     "id": "c-media-toolkit-1",
     "severity": "high",
     "finding": "ASR 以 UA 中的 Chromium 主版本号 ≥135 判断音频轨道识别能力，Electron/WebView 或非 Chrome 内核会被直接判为不支持，且注释承认这是临时门槛。",
     "suggestion": "改为探测 SpeechRecognition 与 AudioContext 的特性组合，并把不支持原因作为可展示的能力缺失返回。"
    }
   ]
  }
 },
 "ai-providers": {
  "id": "ai-providers",
  "name": "模型供应商适配",
  "layer": "domain",
  "responsibility": "语言与媒体模型供应商适配：模型目录、调用与计费",
  "files": [
   "packages/providers/**"
  ],
  "key_entries": [
   {
    "file": "packages/providers/index.ts",
    "symbol": "mediaProviders",
    "kind": "config"
   },
   {
    "file": "packages/providers/src/media/compshare.ts",
    "symbol": "default",
    "kind": "function"
   },
   {
    "file": "packages/providers/src/media/tfRouter.ts",
    "symbol": "default",
    "kind": "function"
   },
   {
    "file": "packages/providers/src/media/apiMart.ts",
    "symbol": "default",
    "kind": "function"
   },
   {
    "file": "packages/providers/types.d.ts",
    "symbol": "ProviderDefinition",
    "kind": "interface"
   }
  ],
  "health": {
   "score": 66,
   "coupling": "low",
   "complexity": "high",
   "churn": "low",
   "decay_flags": [
    "god_file"
   ],
   "review_note": "8 文件 / 3,009 行；供应商契约清晰、出边仅 ffmpeg 类型，但 compshare.ts 单文件 1,839 行，占模块 61%，鉴权、媒体协议、任务轮询与错误映射混在一起。建议按协议拆分并让入口只保留供应商注册与能力声明。",
   "concerns": [
    {
     "id": "c-ai-providers-1",
     "severity": "high",
     "finding": "compshare.ts 单文件 1,839 行（占模块 61%），同时实现鉴权、图片/视频/音频协议、任务轮询、base64 转换与错误映射。",
     "suggestion": "按 image/video/audio/task 拆成四个适配文件，入口只保留供应商注册、能力声明与计费映射。"
    }
   ]
  }
 },
 "agent-tools": {
  "id": "agent-tools",
  "name": "Agent 工具插件",
  "layer": "domain",
  "responsibility": "Agent 工具插件与 MCP 服务：浏览器、画布、素材、检索",
  "files": [
   "packages/tools/**",
   "packages/toolScaffold/**",
   "packages/mcp/**"
  ],
  "key_entries": [
   {
    "file": "packages/toolScaffold/src/runtime.ts",
    "symbol": "toolMetadataSchema",
    "kind": "config"
   },
   {
    "file": "packages/tools/browser/src/host.ts",
    "symbol": "createBrowserRuntime",
    "kind": "function"
   },
   {
    "file": "packages/tools/canvas/src/runtime.ts",
    "symbol": "canvasOperations",
    "kind": "config"
   },
   {
    "file": "packages/mcp/src/index.ts",
    "symbol": "createMcpRouter",
    "kind": "route"
   }
  ],
  "health": {
   "score": 77,
   "coupling": "medium",
   "complexity": "medium",
   "churn": "low",
   "decay_flags": [],
   "review_note": "37 文件 / 3,592 行，10 个工具包共享 toolScaffold 契约，出边 2、入边 5，边界清楚。浏览器工具长成模块内最大单体：host.ts 717 行 + browserPanel.vue 616 行，建议把 WebView/CDP 生命周期收进独立 runtime 包，工具壳只保留定义与面板。",
   "concerns": [
    {
     "id": "c-agent-tools-1",
     "severity": "high",
     "finding": "浏览器工具 host.ts 717 行 + browserPanel.vue 616 行，直接管理 WebView/CDP 生命周期，其余 9 个工具包多数不足 200 行。",
     "suggestion": "把浏览器进程与协议封装为独立 runtime 包，browser 工具只保留工具定义、配置 schema 与面板入口。"
    }
   ]
  }
 },
 "agent-runtime": {
  "id": "agent-runtime",
  "name": "Agent 运行时",
  "layer": "domain",
  "responsibility": "Agent 会话主循环、子代理、团队、技能与 A2A 编排",
  "files": [
   "apps/server/src/agent/**",
   "packages/teamScaffold/**",
   "packages/teams/**",
   "packages/skills/**"
  ],
  "key_entries": [
   {
    "file": "apps/server/src/agent/runtime/index.ts",
    "symbol": "run",
    "kind": "function"
   },
   {
    "file": "apps/server/src/agent/runtime/sessions.ts",
    "symbol": "registerAgentSession",
    "kind": "function"
   },
   {
    "file": "apps/server/src/agent/a2a/index.ts",
    "symbol": "createA2aRouter",
    "kind": "route"
   },
   {
    "file": "apps/server/src/agent/teams/index.ts",
    "symbol": "createTeamRunner",
    "kind": "function"
   },
   {
    "file": "apps/server/src/agent/skills/index.ts",
    "symbol": "loadAgentSkills",
    "kind": "function"
   }
  ],
  "health": {
   "score": 68,
   "coupling": "medium",
   "complexity": "high",
   "churn": "medium",
   "decay_flags": [],
   "review_note": "35 文件 / 4,612 行；2026-10-27 以 AgentHost 端口落地后，本模块对应用层源码的 import 为 0（A2P=0），配置/工作区/模型/团队等应用能力全部经 agent/host.ts（14 组契约）注入，应用层只经 agentRuntime.ts 门面单向引用 agent（e9 17 处），含 agent 的 file 级 SCC 为 0，模块级无环（原 71 处反向依赖已清零）。runtime/index.ts 的 run() 仍同时承担附件校验、会话锁、模型装配、工具装配与事件转发；sessions.ts 785 行把活跃会话放在进程级 Map。建议再拆 run() 与会话存储。",
   "concerns": [
    {
     "id": "c-agent-runtime-2",
     "severity": "high",
     "finding": "runtime/index.ts、sessions.ts、requests.ts 合计约 1,700 行，run() 同时承担附件校验、会话锁、模型装配、工具装配、事件转发与取消。",
     "suggestion": "把工具装配、模型配置、事件转发拆为独立模块，run() 只保留一次会话的编排流程。"
    },
    {
     "id": "c-agent-runtime-3",
     "severity": "high",
     "finding": "活跃会话存放在进程级 Map（sessions.ts），代码注释已注明多进程部署需要共享会话所有权，进程重启即丢失运行态。",
     "suggestion": "把活跃会话封装为可替换的 SessionStore，先提供文件或共享存储实现，再替换内存 Map。"
    }
   ]
  }
 },
 "server-api": {
  "id": "server-api",
  "name": "服务边界与编排",
  "layer": "application",
  "responsibility": "Express 组合根、161 个单接口路由与 7 个应用子模块的装配与编排",
  "files": [
   "apps/server/src/app.ts",
   "apps/server/src/index.ts",
   "apps/server/src/core.ts",
   "apps/server/src/router.ts",
   "apps/server/src/utils.ts",
   "apps/server/src/lib/**",
   "apps/server/src/modules/**",
   "apps/server/src/routes/**",
   "apps/server/src/types/**",
   "apps/server/scripts/**",
   "apps/server/src/agentHost.ts",
   "apps/server/src/agentRuntime.ts"
  ],
  "key_entries": [
   {
    "file": "apps/server/src/app.ts",
    "symbol": "createApp",
    "kind": "function"
   },
   {
    "file": "apps/server/src/core.ts",
    "symbol": "generateRouter",
    "kind": "function"
   },
   {
    "file": "apps/server/src/modules/localRuntime/remoteConnection.ts",
    "symbol": "createRemoteConnection",
    "kind": "function"
   },
   {
    "file": "apps/server/src/modules/platformCore/index.ts",
    "symbol": "corsGuard",
    "kind": "function"
   },
   {
    "file": "apps/server/src/modules/assetLibrary/index.ts",
    "symbol": "warmup",
    "kind": "function"
   },
   {
    "file": "apps/server/src/routes/assets/list.ts",
    "symbol": "GET /api/assets/list",
    "kind": "route"
   }
  ],
  "health": {
   "score": 76,
   "coupling": "high",
   "complexity": "high",
   "churn": "high",
   "decay_flags": [
    "coupling_high"
   ],
   "review_note": "已按素材库/媒体生成/插件市场/MCP/本机运行时/Agent 接入/平台核心拆出 7 个子模块，250 文件 / 14,774 行（app.ts/core.ts/router.ts/index.ts/utils.ts 5 + lib 9 + 域模块 66 + routes 163 + types 2 + scripts 3 + agentHost/agentRuntime 装配 2），app.ts 收敛为 78 行组合根，单模块 god module 形态消除。agent↔应用环已由 AgentHost 端口切断：本模块引用 agent 全部经 agentRuntime.ts 门面（e9 17 处），agent→应用 import 为 0（A2P=0）。仍剩四类结构债：① 子模块间 53 条直引对方域文件（36 个文件）绕过入口，仅 4 条经入口；② 启动入口 apps/server/src/index.ts 直接读宿主壳 electrobun.config（e13），与宿主壳的 e26 共同构成既有模块回边（非 Agent 环，按 layer_violation 跟踪）；③ utils.ts 以 38 键聚合全部应用能力（含 agentRuntime 门面出口）；④ 子图 bootstrap 的装配仍分散在 15 个步骤。建议按域把深引收敛到入口或 ModuleContext，并把版本号改为平台能力端口注入。",
   "concerns": [
    {
     "id": "c-server-api-2",
     "severity": "high",
     "finding": "utils.ts 以 38 个键聚合全部应用能力（含 agentRuntime 门面出口）并被 145 个文件引用，路由普遍隐式依赖该聚合面；依赖方向已单向（agent→应用 0 处），但聚合面仍在扩张。",
     "suggestion": "继续按域拆分 facade 或改构造注入；agent 门面只由组合根持有，不再经 utils 转发。"
    },
    {
     "id": "c-server-api-4",
     "severity": "high",
     "finding": "7 个子模块之间 57 条 import 中 53 条直接引用对方域文件（36 个文件），仅 4 条经模块入口；契约 dependencies 无运行时消费者，漂移只能靠人工与地图复核。",
     "suggestion": "按域逐条收敛到入口或 ModuleContext，并把深引清单冻结在子图中，新增需登记复核。"
    },
    {
     "id": "c-server-api-3",
     "severity": "high",
     "finding": "启动入口 apps/server/src/index.ts 直接 import electrobun.config 读取 app.version，使应用层反向依赖宿主壳配置；移动端 server.ts 也复制了同一读法。",
     "suggestion": "把版本号改为启动参数或平台能力端口注入，服务端代码不直接 import 宿主壳配置。"
    }
   ]
  }
 },
 "workflow-nodes": {
  "id": "workflow-nodes",
  "name": "画布节点插件",
  "layer": "presentation",
  "responsibility": "短剧画布节点插件与节点 UI/运行时脚手架",
  "files": [
   "packages/nodes/**",
   "packages/nodeShared/**",
   "packages/nodeScaffold/**"
  ],
  "key_entries": [
   {
    "file": "packages/nodeScaffold/src/useNode.ts",
    "symbol": "useNode",
    "kind": "function"
   },
   {
    "file": "packages/nodeScaffold/src/nodeSkeleton.vue",
    "symbol": "nodeSkeleton",
    "kind": "function"
   },
   {
    "file": "packages/nodeShared/src/useNodeGeneration.ts",
    "symbol": "useNodeGeneration",
    "kind": "function"
   },
   {
    "file": "packages/nodes/director3dNode/src/index.vue",
    "symbol": "director3dNode",
    "kind": "function"
   }
  ],
  "health": {
   "score": 70,
   "coupling": "medium",
   "complexity": "high",
   "churn": "medium",
   "decay_flags": [
    "large_module"
   ],
   "review_note": "94 文件 / 17,171 行，9 个节点包共享 nodeScaffold；出边 3、入边仅 web。nodeSkeleton.vue 854 行、sceneEditor.vue 833 行、imagePanoramaPreview.vue 599 行集中了布局、交互与场景生命周期。建议按布局/工具栏/场景拆组件，并由 nodeScaffold 统一节点 manifest 的生成与构建期校验。",
   "concerns": [
    {
     "id": "c-workflow-nodes-1",
     "severity": "high",
     "finding": "nodeSkeleton.vue 854 行、sceneEditor.vue 833 行、imagePanoramaPreview.vue 599 行，单文件同时承担布局、工具栏、交互与 3D 场景生命周期。",
     "suggestion": "按布局、工具栏、场景生命周期拆组件，交互逻辑移入 composable，节点入口只保留装配。"
    },
    {
     "id": "c-workflow-nodes-2",
     "severity": "high",
     "finding": "9 个节点包的元数据与构建产物格式依赖 nodeScaffold 注释隐式约定，缺少统一 manifest schema 与跨包校验，新增节点容易漏字段。",
     "suggestion": "由 nodeScaffold 生成统一的节点 manifest 类型，并在构建脚本中做 schema 校验。"
    }
   ]
  }
 },
 "canvas-extensions": {
  "id": "canvas-extensions",
  "name": "画布扩展插件",
  "layer": "presentation",
  "responsibility": "画布扩展插件（文档/图片/媒体/Markdown/节点）与注册脚手架",
  "files": [
   "packages/ext/**",
   "packages/extScaffold/**"
  ],
  "key_entries": [
   {
    "file": "packages/extScaffold/src/runtime.ts",
    "symbol": "defineExt",
    "kind": "function"
   },
   {
    "file": "packages/ext/md/src/index.vue",
    "symbol": "mdExtension",
    "kind": "function"
   },
   {
    "file": "packages/ext/comfyMonitor/src/index.vue",
    "symbol": "comfyMonitor",
    "kind": "function"
   },
   {
    "file": "packages/extScaffold/create.ts",
    "symbol": "create-ext",
    "kind": "cli"
   }
  ],
  "health": {
   "score": 79,
   "coupling": "low",
   "complexity": "medium",
   "churn": "low",
   "decay_flags": [
    "large_component"
   ],
   "review_note": "30 文件 / 2,523 行，6 个扩展包共享 defineExt，出边 1、入边 1，边界干净。md 扩展 index.vue 847 行，同时实现富文本/原文切换、图片粘贴、快捷键、渲染与持久化。建议拆出编辑、渲染、附件三层，插件入口只做 defineExt 注册。",
   "concerns": [
    {
     "id": "c-canvas-extensions-1",
     "severity": "high",
     "finding": "md 扩展 index.vue 847 行（占模块 34%），同时实现富文本/原文切换、图片粘贴、快捷键、渲染与持久化。",
     "suggestion": "拆出编辑、渲染、附件三个组件，插件入口只做 defineExt 注册与资源声明。"
    }
   ]
  }
 },
 "web-console": {
  "id": "web-console",
  "name": "Vue 工作台",
  "layer": "presentation",
  "responsibility": "Vue 工作台：画布、素材库、文档、对话与设置界面",
  "files": [
   "apps/web/**",
   "postcss.config.ts"
  ],
  "key_entries": [
   {
    "file": "apps/web/src/main.ts",
    "symbol": "notifyDesktopReady",
    "kind": "function"
   },
   {
    "file": "apps/web/src/router/index.ts",
    "symbol": "router",
    "kind": "config"
   },
   {
    "file": "apps/web/src/stores/workspace.ts",
    "symbol": "useWorkspaceStore",
    "kind": "function"
   },
   {
    "file": "apps/web/src/stores/sessionState.ts",
    "symbol": "useSessionStateStore",
    "kind": "function"
   },
   {
    "file": "apps/web/src/lib/workspaceFiles.ts",
    "symbol": "useWorkspaceFiles",
    "kind": "function"
   },
   {
    "file": "apps/web/src/pages/workspace/panels/canvas/index.vue",
    "symbol": "canvasPanel",
    "kind": "function"
   }
  ],
  "health": {
   "score": 58,
   "coupling": "high",
   "complexity": "high",
   "churn": "high",
   "decay_flags": [
    "large_module",
    "coupling_high"
   ],
   "review_note": "176 文件 / 42,491 行，出边 8、入边 1；8 个 Pinia store 与 130 处 /api 字面量、7 个 @toonflow/server 源码契约、17 个插件/骨架运行时子路径在编译期固化。canvas/index.vue 1,545 行、pluginMarket 1,145 行、canvasMenu 1,063 行、home 1,053 行、fileTree 986 行。建议先抽 contracts 包收敛路由常量与类型，再把巨型页面拆为容器 + 面板 + composable。",
   "concerns": [
    {
     "id": "c-web-console-1",
     "severity": "critical",
     "finding": "web 源码含 130 处 /api 字面量、7 个 @toonflow/server 源码契约与 17 个插件/骨架运行时子路径，前后端与插件契约在编译期固化。",
     "suggestion": "抽 contracts 包集中路由常量与请求/响应类型，插件 UI 改注册表动态加载。"
    },
    {
     "id": "c-web-console-2",
     "severity": "high",
     "finding": "canvas/index.vue 1,545 行、pluginMarket 1,145 行、canvasMenu 1,063 行、home 1,053 行、fileTree 986 行，8 个 Pinia store 与页面状态交织。",
     "suggestion": "按画布/设置/首页拆子域，巨型组件拆容器 + 面板 + composable，状态按子域拆分 store。"
    }
   ]
  }
 },
 "desktop-shell": {
  "id": "desktop-shell",
  "name": "桌面宿主壳",
  "layer": "host-shell",
  "responsibility": "Electrobun 桌面壳、原生安装/更新程序与更新分发",
  "files": [
   "apps/desktop/**",
   "apps/updateServer/**",
   "packages/startup/**",
   "compat/macIntel/**",
   "electrobun.config.ts",
   "hutch.config.ts",
   "scripts/bundle-desktop.ts"
  ],
  "key_entries": [
   {
    "file": "apps/desktop/src/index.ts",
    "symbol": "start",
    "kind": "cli"
   },
   {
    "file": "apps/desktop/src/update/windowsUpdater.ts",
    "symbol": "createWindowsUpdater",
    "kind": "function"
   },
   {
    "file": "apps/updateServer/src/app.ts",
    "symbol": "createApp",
    "kind": "function"
   },
   {
    "file": "packages/startup/src/index.ts",
    "symbol": "showNativeSplash",
    "kind": "function"
   },
   {
    "file": "scripts/bundle-desktop.ts",
    "symbol": "bundle-desktop",
    "kind": "cli"
   }
  ],
  "health": {
   "score": 76,
   "coupling": "medium",
   "complexity": "medium",
   "churn": "medium",
   "decay_flags": [
    "multi_runtime_duplication"
   ],
   "review_note": "39 文件 / 4,707 行，出边 2、入边 2；窗口生命周期、sidecar 启动、更新门控与协议分发集中在 index.ts（615 行），Windows 更新由 updateHelper.cs（657 行）、windowsUpdater.ts（378 行）与 installer.nsi（298 行）三处状态机共同实现。建议抽单一更新步骤协议，三端只做平台适配。",
   "concerns": [
    {
     "id": "c-desktop-shell-1",
     "severity": "high",
     "finding": "Windows 更新流程由 updateHelper.cs（657 行）、windowsUpdater.ts（378 行）与 installer.nsi（298 行）三处状态机共同实现，需人工保持步骤与错误码同步。",
     "suggestion": "抽出单一更新步骤/状态协议文件，C#、TS 与 NSIS 仅做平台适配与展示。"
    },
    {
     "id": "c-desktop-shell-2",
     "severity": "high",
     "finding": "src/index.ts 615 行集中窗口生命周期、关闭闸门、更新门控、菜单、协议分发与 sidecar 启动，是壳层全部运行逻辑的单点。",
     "suggestion": "拆 window/lifecycle/menu/protocol 模块，start() 只做装配与启动顺序编排。"
    }
   ]
  }
 },
 "mobile-shell": {
  "id": "mobile-shell",
  "name": "移动宿主壳",
  "layer": "host-shell",
  "responsibility": "Android WebView 宿主、OHOS 运行时与移动构建兼容层",
  "files": [
   "apps/mobile/**",
   "compat/ohos/**"
  ],
  "key_entries": [
   {
    "file": "apps/mobile/src/server.ts",
    "symbol": "main",
    "kind": "cli"
   },
   {
    "file": "apps/mobile/native/mobileActivity.java",
    "symbol": "mobileActivity",
    "kind": "class"
   },
   {
    "file": "compat/ohos/runtime.ts",
    "symbol": "createTranspiler",
    "kind": "function"
   },
   {
    "file": "compat/ohos/browserCompatibility.ts",
    "symbol": "installBrowserCompatibility",
    "kind": "function"
   }
  ],
  "health": {
   "score": 72,
   "coupling": "medium",
   "complexity": "high",
   "churn": "low",
   "decay_flags": [
    "god_file"
   ],
   "review_note": "20 文件 / 3,502 行，出边 4、入边 0；Android 与 OHOS 两套宿主共存。mobileActivity.java 1,004 行集中 WebView 初始化、权限申请、文件选择、媒体采集与 URL 拦截；OHOS 兼容层通过跨包 node_modules 路径 require babel/typescript。建议拆 God Activity，并把兼容层独立为显式声明依赖的 workspace 包。",
   "concerns": [
    {
     "id": "c-mobile-shell-1",
     "severity": "high",
     "finding": "mobileActivity.java 1,004 行集中 WebView 初始化、权限申请、文件选择、媒体采集与 URL 拦截，Activity 难以单测与复用。",
     "suggestion": "拆 WebViewHost、MediaPermission、FileChooser 三类，Activity 只保留生命周期编排。"
    },
    {
     "id": "c-mobile-shell-2",
     "severity": "high",
     "finding": "compat/ohos/runtime.ts 通过 require ../../apps/server/node_modules/@babel/parser 与 ../../packages/extScaffold/node_modules/typescript 解析依赖，绑定他包 node_modules 布局。",
     "suggestion": "把 OHOS 兼容层独立为 workspace 包并显式声明 babel/typescript 依赖，由构建脚本注入。"
    }
   ]
  }
 }
}

ARCH_HEALTH = {
    "score": 73,
    "coupling": "high",
    "complexity": "high",
    "churn": "high",
    "decay_flags": [
        "layer_violation"
    ],
    "review_note": "五层（宿主 → 呈现 → 应用 → 领域 → 基础）大体成立：web 只向下取插件与共享契约，应用层统一装配，foundation 是无出边的叶子。2026-10-27 server-api 已由 246 文件单模块拆为 7 个子模块 + 组合根；同日以 AgentHost 端口（agent/host.ts 契约 + agentHost.ts 装配 + agentRuntime.ts 门面）切断 agent↔应用双向依赖：agent→应用 import 0 处（A2P=0），含 agent 的 file 级 SCC 0 个，模块边 e6 改指 shared-foundation、原 agent→server-api 边（71 处，e7）删除，环消失，decay_flags 中的循环依赖标记与 c-arch-1 同步关闭。复检口径：模块级仍有 1 个既有 SCC（server-api ↔ desktop-shell，由 e13 读 electrobun.config 与 e26 静态装配构成），与本次 Agent 环无关，按 layer_violation + c-arch-5 跟踪。剩余结构性问题：1）应用层内部 53 条跨子模块深引绕过入口，契约无运行时守卫（c-arch-4）；2）呈现层把 node/tool/ext 运行时包在编译期静态引入 30 处（c-arch-3）；3）server-api 启动入口直接读宿主壳 electrobun.config（e13，layer_violation 来源，c-arch-5）。建议按「子域深引收敛 → 契约包下沉与插件注册表 → 版本号端口注入」顺序治理。",
    "concerns": [
        {
            "id": "c-arch-4",
            "severity": "high",
            "finding": "应用层 7 个子模块的边界由目录与文档承担：57 条跨子模块 import 中 53 条直引对方域文件，入口只承载 4 条，边界漂移没有运行时或脚本守卫。",
            "suggestion": "把冻结的深引清单写入子图并纳入评审模板，新增深引必须登记，逐步以 ModuleContext 替换。"
        },
        {
            "id": "c-arch-3",
            "severity": "high",
            "finding": "web 在编译期 import 插件运行时包 30 处、引用 server 源码/接口 38 处，插件与前后端契约都被静态编入主包，安装式插件无法影响 UI。",
            "suggestion": "抽出 contracts 包并把插件 UI 改为注册表 + 动态入口，web 只依赖契约。"
        },
        {
            "id": "c-arch-5",
            "severity": "high",
            "finding": "server-api 启动入口 apps/server/src/index.ts 直接 import electrobun.config 读取 app.version，移动端 server.ts 复制同一读法，应用层反向依赖宿主壳配置（e13 direction_violation）。",
            "suggestion": "版本号改为启动参数或平台能力端口注入，服务端代码不直接 import 宿主壳配置。"
        }
    ]
}


def write_json(path, data):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")
    os.replace(tmp, path)


def write_progress(phase, total, done, current, percent):
    write_json(os.path.join(MAP_DIR, "progress.json"), {
        "phase": phase, "modules_total": total, "modules_done": done,
        "current_module": current, "percent": percent, "updated_at": NOW,
    })


def call_cli(cmd, payload):
    proc = subprocess.run([sys.executable, CLI, cmd], input=json.dumps(payload, ensure_ascii=False),
                          text=True, capture_output=True)
    if proc.returncode != 0:
        print(proc.stdout, proc.stderr, file=sys.stderr)
        raise SystemExit(f"CLI {cmd} failed")
    return proc.stdout.strip()


def main():
    os.makedirs(PARTS, exist_ok=True)
    # clustering: explicit append manifest, bottom-up.
    emit_order = {"layers": LAYERS_BOTTOM_UP, "modules": MODULE_ORDER}
    write_json(os.path.join(MAP_DIR, "emit_order.json"), emit_order)
    write_progress("scanning", 0, 0, None, 10)
    write_progress("clustering", len(MODULE_ORDER), 0, None, 35)

    # module-analysis: emit each module part, one at a time.
    deps_by_module = {mid: [] for mid in MODULE_ORDER}
    for e in EDGES:
        deps_by_module[e[1]].append(e[2])
    done = 0
    for mid in MODULE_ORDER:
        mod = dict(MODULES[mid])
        mod["dependencies"] = sorted(set(deps_by_module[mid]))
        mod["last_analyzed_at"] = NOW
        write_progress("module-analysis", len(MODULE_ORDER), done, mid, 35 + round(35 * done / len(MODULE_ORDER)))
        call_cli("emit-module", mod)
        done += 1
        write_progress("module-analysis", len(MODULE_ORDER), done, mid, 35 + round(35 * done / len(MODULE_ORDER)))
    write_progress("module-analysis", len(MODULE_ORDER), len(MODULE_ORDER), None, 70)

    # edging: write each module's out-edges.
    for mid in MODULE_ORDER:
        out = []
        for eid, frm, to, typ, strength, label, violation in EDGES:
            if frm != mid:
                continue
            edge = {"id": eid, "from": frm, "to": to, "type": typ, "strength": strength, "label": label}
            if violation:
                edge["direction_violation"] = True
            out.append(edge)
        call_cli("write-edges", {"module": mid, "edges": out})
    write_progress("edging", len(MODULE_ORDER), len(MODULE_ORDER), None, 80)

    # health: architecture-level health is the single source for the arch_health event.
    write_json(os.path.join(PARTS, "_arch_health.json"), ARCH_HEALTH)
    write_progress("health", len(MODULE_ORDER), len(MODULE_ORDER), None, 90)
    print("parts and arch health written")


if __name__ == "__main__":
    main()
