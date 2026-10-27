#!/usr/bin/env python3
"""Deterministic repo scan: module ownership, code stats, import/API edges."""
import fnmatch, json, os, re, subprocess
from collections import Counter, defaultdict

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
MAP_DIR = os.path.join(ROOT, ".easyvibe", "map")
CODE_EXTS = {".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts", ".vue",
             ".sql", ".ets", ".java", ".kt", ".kts", ".cs", ".cpp", ".h", ".hpp", ".m", ".mm"}
SKIP_DIRS = {"node_modules", "dist", "build", ".git", ".easyvibe", ".hutch", "__pycache__", ".cottontail-tmp"}

MODULES = [
    {"id": "shared-foundation", "layer": "foundation", "files": ["packages/file/**", "packages/i18n/**", "packages/modelIcons/**", "packages/assets/**"]},
    {"id": "media-toolkit", "layer": "foundation", "files": ["packages/ffmpeg/**", "packages/asr/**"]},
    {"id": "ai-providers", "layer": "domain", "files": ["packages/providers/**"]},
    {"id": "agent-tools", "layer": "domain", "files": ["packages/tools/**", "packages/toolScaffold/**", "packages/mcp/**"]},
    {"id": "agent-runtime", "layer": "domain", "files": ["apps/server/src/agent/**", "packages/teamScaffold/**", "packages/teams/**", "packages/skills/**"]},
    {"id": "workflow-nodes", "layer": "presentation", "files": ["packages/nodes/**", "packages/nodeShared/**", "packages/nodeScaffold/**"]},
    {"id": "canvas-extensions", "layer": "presentation", "files": ["packages/ext/**", "packages/extScaffold/**"]},
    {"id": "web-console", "layer": "presentation", "files": ["apps/web/**", "postcss.config.ts"]},
    {"id": "server-api", "layer": "application", "files": ["apps/server/src/app.ts", "apps/server/src/index.ts", "apps/server/src/core.ts", "apps/server/src/router.ts", "apps/server/src/utils.ts", "apps/server/src/lib/**", "apps/server/src/modules/**", "apps/server/src/routes/**", "apps/server/src/types/**", "apps/server/scripts/**"]},
    {"id": "desktop-shell", "layer": "host-shell", "files": ["apps/desktop/**", "apps/updateServer/**", "packages/startup/**", "compat/macIntel/**", "electrobun.config.ts", "hutch.config.ts", "scripts/bundle-desktop.ts"]},
    {"id": "mobile-shell", "layer": "host-shell", "files": ["apps/mobile/**", "compat/ohos/**"]},
]

LAYERS = [
    {"id": "host-shell", "name": "宿主壳层", "order": 0, "description": "Electrobun 桌面端、Android/OHOS 移动端与更新分发服务，托管 Web 界面并提供原生能力"},
    {"id": "presentation", "name": "交互呈现层", "order": 1, "description": "Vue 工作区、画布节点与扩展插件：节点图编辑、文档面板、对话与设置界面"},
    {"id": "application", "name": "应用服务层", "order": 2, "description": "Express 应用边界、单接口路由、媒体/插件/MCP/工作区业务编排与进程组合根"},
    {"id": "domain", "name": "领域能力层", "order": 3, "description": "Agent 会话运行时、模型供应商适配与 Agent 工具插件，承载短剧创作的核心智能能力"},
    {"id": "foundation", "name": "基础能力层", "order": 4, "description": "文件访问、国际化、图标与音视频/语音基础能力，零业务依赖，被所有上层复用"},
]

def all_code_files():
    out = []
    for base, dirs, files in os.walk(ROOT):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS and not d.startswith(".git")]
        for name in files:
            if os.path.splitext(name)[1] in CODE_EXTS:
                out.append(os.path.relpath(os.path.join(base, name), ROOT).replace(os.sep, "/"))
    return sorted(out)

def owner(path, modules=MODULES):
    matches = []
    for m in modules:
        for g in m["files"]:
            if fnmatch.fnmatch(path, g):
                matches.append((len(g), m["id"]))
    if not matches:
        return None
    # most specific glob wins; tie-break deterministic
    matches.sort(key=lambda x: (-x[0], x[1]))
    return matches[0][1]

def package_map():
    mapping = {}
    for base, dirs, files in os.walk(ROOT):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS and not d.startswith(".git")]
        if "package.json" in files:
            try:
                data = json.load(open(os.path.join(base, "package.json"), encoding="utf-8"))
            except Exception:
                continue
            name = data.get("name")
            if not name:
                continue
            rel = os.path.relpath(base, ROOT).replace(os.sep, "/")
            # map package directory to its owning module
            mid = owner(rel + "/__pkg__")
            if mid:
                mapping[name] = mid
    # explicit subpath overrides for the server package's agent exports
    mapping["@toonflow/server/agent"] = "agent-runtime"
    mapping["@toonflow/server/singleAgent"] = "server-api"
    # tool package names that may not resolve via dir walk fallback
    for n in ["ask-user", "asset-operator", "browser", "canvas", "ffmpeg", "media-generation",
              "skill-operator", "web-fetch", "web-search", "workspace"]:
        mapping.setdefault("@toonflow/tool-" + n, "agent-tools")
    for n in ["text", "image", "video", "audio", "audio-generation", "image-generation",
              "video-generation", "frame-analysis", "director3d"]:
        mapping.setdefault("@toonflow/node-" + n, "workflow-nodes")
    mapping.setdefault("@toonflow/nodes-scaffold", "workflow-nodes")
    mapping.setdefault("@toonflow/node-shared", "workflow-nodes")
    mapping.setdefault("@toonflow/ext-scaffold", "canvas-extensions")
    mapping.setdefault("@toonflow/teams-scaffold", "agent-runtime")
    mapping.setdefault("@toonflow/tools-scaffold", "agent-tools")
    mapping.setdefault("@toonflow/startup", "desktop-shell")
    mapping.setdefault("@toonflow/web", "web-console")
    mapping.setdefault("@toonflow/server", "server-api")
    return mapping

IMPORT_RE = re.compile(r"""(?:from\s*|import\s*\(\s*|require\s*\(\s*|import\s+)["']([^"']+)["']""")
FETCH_RE = re.compile(r"""(?:fetch|axios\.(?:get|post|put|delete|patch))\s*\(\s*[`"'](/api/[^`"'?$]*)""")

def resolve_spec(spec, source, pkgmap):
    if spec.startswith("@toonflow/"):
        parts = spec.split("/")
        # server subpath: agent/* belongs to agent-runtime
        if spec.startswith("@toonflow/server/"):
            sub = spec[len("@toonflow/server/"):]
            if sub.startswith("agent/") or sub == "agent":
                return "agent-runtime"
            return "server-api"
        name = "/".join(parts[:2])
        return pkgmap.get(name)
    if spec.startswith("@/"):
        base = "apps/web/src" if source.startswith("apps/web/") else "apps/server/src"
        cand = os.path.normpath(os.path.join(base, spec[2:])).replace(os.sep, "/")
    elif spec.startswith("."):
        cand = os.path.normpath(os.path.join(os.path.dirname(source), spec)).replace(os.sep, "/")
    else:
        return None
    # try direct and common extensions/index files
    options = [cand] + [cand + e for e in [".ts", ".tsx", ".vue", ".js", ".mjs", ".ets"]]
    options += [cand + "/index" + e for e in [".ts", ".tsx", ".vue", ".js"]]
    for opt in options:
        if os.path.isfile(os.path.join(ROOT, opt)):
            return owner(opt)
    # fallback: longest directory prefix
    for opt in options:
        m = owner(opt)
        if m:
            return m
    return None

def main():
    files = all_code_files()
    pkgmap = package_map()
    owned = {}
    for f in files:
        owned[f] = owner(f)
    unowned = [f for f, m in owned.items() if not m]
    print("files", len(files), "unowned", len(unowned))
    for f in unowned: print("UNOWNED", f)

    stats = {m["id"]: {"files": 0, "loc": 0, "module_files": []} for m in MODULES}
    for f, mid in owned.items():
        if not mid: continue
        stats[mid]["files"] += 1
        try:
            with open(os.path.join(ROOT, f), encoding="utf-8", errors="ignore") as fh:
                stats[mid]["loc"] += sum(1 for _ in fh)
        except Exception:
            pass
        stats[mid]["module_files"].append(f)

    edges = Counter()
    edge_types = defaultdict(Counter)
    edge_samples = defaultdict(list)
    for f, mid in owned.items():
        if not mid: continue
        try:
            text = open(os.path.join(ROOT, f), encoding="utf-8", errors="ignore").read()
        except Exception:
            continue
        for spec in IMPORT_RE.findall(text):
            target = resolve_spec(spec, f, pkgmap)
            if target and target != mid:
                edges[(mid, target)] += 1
                edge_types[(mid, target)]["import"] += 1
                if len(edge_samples[(mid, target)]) < 4:
                    edge_samples[(mid, target)].append(f + " -> " + spec)
        if mid == "web-console":
            for api in FETCH_RE.findall(text):
                edges[(mid, "server-api")] += 1
                edge_types[(mid, "server-api")]["api"] += 1
                if len(edge_samples[(mid, "server-api")]) < 4:
                    edge_samples[(mid, "server-api")].append(f + " -> " + api)

    print("\nMODULE STATS")
    for m in MODULES:
        s = stats[m["id"]]
        print(f"{m['id']:20s} files={s['files']:4d} loc={s['loc']:6d}")
    print("\nEDGES")
    for (a, b), n in sorted(edges.items(), key=lambda kv: (-kv[1], kv[0])):
        print(f"{a:20s} -> {b:20s} n={n:4d} types={dict(edge_types[(a,b)])}")
        for s in edge_samples[(a,b)][:2]:
            print("    ", s)

    # git churn: unique commits touching each module in the last 3 months
    churn = {m["id"]: {"commits": 0, "file_occurrences": 0} for m in MODULES}
    try:
        gitlog = subprocess.check_output(
            ["git", "-C", ROOT, "log", "--since=3 months ago", "--name-only", "--pretty=format:COMMIT %H"],
            text=True, errors="ignore")
        current = None
        touched = defaultdict(set)
        occurrences = Counter()
        for line in gitlog.splitlines():
            line = line.strip()
            if line.startswith("COMMIT "):
                current = line.split()[1]
            elif line and current:
                mid = owned.get(line)
                if mid:
                    touched[mid].add(current)
                    occurrences[mid] += 1
        for mid in churn:
            churn[mid] = {"commits": len(touched[mid]), "file_occurrences": occurrences[mid]}
    except Exception as exc:
        print("churn unavailable:", exc)

    out = {
        "modules": MODULES,
        "churn": churn,
        "layers": LAYERS,
        "files": files,
        "owned": owned,
        "unowned": unowned,
        "stats": {k: {"files": v["files"], "loc": v["loc"]} for k, v in stats.items()},
        "edges": [
            {"from": a, "to": b, "count": n, "types": dict(edge_types[(a, b)]), "samples": edge_samples[(a, b)]}
            for (a, b), n in sorted(edges.items())
        ],
    }
    os.makedirs(os.path.join(MAP_DIR, "_analysis"), exist_ok=True)
    with open(os.path.join(MAP_DIR, "_analysis", "repo_profile.json"), "w", encoding="utf-8") as fh:
        json.dump(out, fh, ensure_ascii=False, indent=2)
    print("\nwrote", os.path.join(MAP_DIR, "_analysis", "repo_profile.json"))

if __name__ == "__main__":
    main()
