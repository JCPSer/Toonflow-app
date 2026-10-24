#!/usr/bin/env python3
"""Deterministic repo profile + import-edge scanner for Toonflow-app."""
import json, os, re, sys
from collections import defaultdict

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
CODE_EXTS = {".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts", ".vue",
             ".sql", ".ets", ".java", ".kt", ".kts", ".cs", ".cpp", ".h", ".hpp", ".m", ".mm"}
SKIP = {"node_modules", "dist", "build", ".git", ".easyvibe", ".hutch", "__pycache__"}

MODULES = [
    ("shared-foundation", ["packages/file/", "packages/i18n/", "packages/modelIcons/", "packages/assets/"]),
    ("media-toolkit", ["packages/ffmpeg/", "packages/asr/"]),
    ("ai-providers", ["packages/providers/"]),
    ("agent-runtime", ["apps/server/src/agent/", "packages/skills/", "packages/teams/", "packages/teamScaffold/"]),
    ("agent-tools", ["packages/tools/", "packages/mcp/", "packages/toolScaffold/"]),
    ("workflow-nodes", ["packages/nodes/", "packages/nodeShared/", "packages/nodeScaffold/"]),
    ("canvas-extensions", ["packages/ext/", "packages/extScaffold/"]),
    ("server-api", ["apps/server/"]),
    ("web-console", ["apps/web/", "postcss.config.ts"]),
    ("desktop-shell", ["apps/desktop/", "apps/updateServer/", "packages/startup/", "electrobun.config.ts", "hutch.config.ts"]),
    ("mobile-shell", ["apps/mobile/", "compat/"]),
]

PKG_TO_MODULE = {
    "@toonflow/file": "shared-foundation", "@toonflow/i18n": "shared-foundation",
    "@toonflow/model-icons": "shared-foundation", "@toonflow/assets": "shared-foundation",
    "@toonflow/ffmpeg": "media-toolkit", "@toonflow/asr": "media-toolkit",
    "@toonflow/providers": "ai-providers", "@toonflow/server": "server-api",
    "@toonflow/web": "web-console", "@toonflow/desktop": "desktop-shell",
    "@toonflow/mobile": "mobile-shell", "@toonflow/startup": "desktop-shell",
    "@toonflow/nodes-scaffold": "workflow-nodes", "@toonflow/node-shared": "workflow-nodes",
    "@toonflow/tools-scaffold": "agent-tools", "@toonflow/mcp": "agent-tools",
    "@toonflow/ext-scaffold": "canvas-extensions",
    "@toonflow/teams-scaffold": "agent-runtime",
}
for p in ["audio", "text", "video", "image", "director3d", "frameAnalysis", "audioGeneration", "imageGeneration", "videoGeneration"]:
    PKG_TO_MODULE[f"@toonflow/node-{p}"] = "workflow-nodes"
for p in ["askUser", "assetOperator", "asset-operator", "browser", "canvas", "ffmpeg", "mediaGeneration", "media-generation", "skillOperator", "skill-operator", "webFetch", "web-fetch", "webSearch", "web-search", "workspace"]:
    PKG_TO_MODULE[f"@toonflow/tool-{p}"] = "agent-tools"
for p in ["txt", "image", "md", "media", "canvasNode"]:
    PKG_TO_MODULE[f"@toonflow/ext-{p}"] = "canvas-extensions"


def module_of(path):
    if path == "postcss.config.ts":
        return "web-console"
    if path in ("electrobun.config.ts", "hutch.config.ts"):
        return "desktop-shell"
    for mid, prefixes in MODULES:
        for p in prefixes:
            if path.startswith(p):
                return mid
    return None


def walk():
    out = []
    for base, dirs, files in os.walk(ROOT):
        dirs[:] = [d for d in dirs if d not in SKIP]
        for name in files:
            if os.path.splitext(name)[1] in CODE_EXTS:
                out.append(os.path.relpath(os.path.join(base, name), ROOT).replace(os.sep, "/"))
    return sorted(out)


IMPORT_RE = re.compile(r"""(?:^|\n)\s*(?:import|export)\s[^;\n]*?from\s*["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)|require\(\s*["']([^"']+)["']\s*\)""")
TYPE_ONLY_RE = re.compile(r"""(?:^|\n)\s*import\s+type\s""")
REL_RE = re.compile(r"""^\.{1,2}/""")


def resolve(importer, spec):
    spec = spec.split("?")[0]
    if spec.startswith("@toonflow/"):
        name = spec
        parts = spec.split("/")
        for i in range(len(parts), 0, -1):
            cand = "/".join(parts[:i])
            if cand in PKG_TO_MODULE:
                return PKG_TO_MODULE[cand], cand
        return None, name
    if spec.startswith("@/"):
        if importer.startswith("apps/server/"):
            base = "apps/server/src/" + spec[2:]
        elif importer.startswith("apps/web/"):
            base = "apps/web/src/" + spec[2:]
        elif importer.startswith("apps/updateServer/"):
            base = "apps/updateServer/src/" + spec[2:]
        else:
            base = None
        if base:
            return module_of(os.path.normpath(base).replace(os.sep, "/")), base
        return None, spec
    if REL_RE.match(spec):
        base = os.path.normpath(os.path.join(os.path.dirname(importer), spec)).replace(os.sep, "/")
        return module_of(base), base
    return None, spec


def main():
    files = walk()
    per = defaultdict(lambda: {"files": 0, "loc": 0, "largest": [], "unmapped": []})
    unmapped = []
    for f in files:
        mid = module_of(f)
        if not mid:
            unmapped.append(f)
            continue
        d = per[mid]
        d["files"] += 1
        try:
            with open(os.path.join(ROOT, f), encoding="utf-8", errors="ignore") as fh:
                n = sum(1 for _ in fh)
        except Exception:
            n = 0
        d["loc"] += n
        d["largest"].append((n, f))
    for d in per.values():
        d["largest"] = [{"loc": n, "file": f} for n, f in sorted(d["largest"], reverse=True)[:5]]

    # edges
    edge_stats = defaultdict(lambda: {"count": 0, "files": set(), "targets": set(), "type_only": 0})
    for f in files:
        src = module_of(f)
        if not src:
            continue
        try:
            text = open(os.path.join(ROOT, f), encoding="utf-8", errors="ignore").read()
        except Exception:
            continue
        for m in IMPORT_RE.finditer(text):
            spec = m.group(1) or m.group(2) or m.group(3)
            if not spec:
                continue
            dst, _ = resolve(f, spec)
            if not dst or dst == src:
                continue
            line = text[m.start():m.end()]
            st = edge_stats[(src, dst)]
            st["count"] += 1
            st["files"].add(f)
            st["targets"].add(spec.split("?")[0])
            if "import type" in line or "import(\"type" in line:
                st["type_only"] += 1

    profile = {
        "generated_at": __import__("datetime").datetime.now().astimezone().isoformat(timespec="seconds"),
        "code_files_total": len(files),
        "modules": {k: {"files": v["files"], "loc": v["loc"], "largest": v["largest"]} for k, v in per.items()},
        "unmapped": unmapped,
        "pickle": None,
    }
    edges = []
    for (src, dst), v in sorted(edge_stats.items()):
        edges.append({"from": src, "to": dst, "imports": v["count"], "files": sorted(v["files"]),
                      "specs": sorted(v["targets"])[:8], "type_only_imports": v["type_only"]})
    out = os.path.join(ROOT, ".easyvibe", "map", "_analysis")
    os.makedirs(out, exist_ok=True)
    json.dump(profile, open(os.path.join(out, "repo_profile.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    json.dump(edges, open(os.path.join(out, "edges_raw.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    print(json.dumps({"files": len(files), "modules": {k: v["files"] for k, v in per.items()},
                      "unmapped": unmapped[:30], "edges": [f"{e['from']}->{e['to']}({e['imports']})" for e in edges]}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
