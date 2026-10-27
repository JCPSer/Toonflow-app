import os,re,json
from collections import defaultdict
ROOT=os.getcwd()
CODE={".ts",".tsx",".js",".jsx",".mjs",".cjs",".mts",".cts",".vue",".sql",".ets",".java",".kt",".kts",".cs",".cpp",".h",".hpp",".m",".mm"}
SKIP={"node_modules","dist","build",".git",".easyvibe",".hutch","__pycache__",".cottontail-tmp"}
files=[]
for base,dirs,fs in os.walk(ROOT):
    dirs[:]=[d for d in dirs if d not in SKIP and not d.startswith(".git")]
    for n in fs:
        if os.path.splitext(n)[1] in CODE:
            files.append(os.path.relpath(os.path.join(base,n),ROOT).replace(os.sep,"/"))
files.sort()
MODULES={
 "shared-foundation":["packages/file/**","packages/i18n/**","packages/modelIcons/**","packages/assets/**"],
 "media-toolkit":["packages/ffmpeg/**","packages/asr/**"],
 "ai-providers":["packages/providers/**"],
 "agent-tools":["packages/tools/**","packages/toolScaffold/**","packages/mcp/**"],
 "agent-runtime":["apps/server/src/agent/**","packages/teamScaffold/**","packages/teams/**","packages/skills/**"],
 "server-api":["apps/server/src/app.ts","apps/server/src/index.ts","apps/server/src/core.ts","apps/server/src/router.ts","apps/server/src/utils.ts","apps/server/src/remoteConnection.ts","apps/server/src/lib/**","apps/server/src/routes/**","apps/server/src/types/**","apps/server/src/utils/**","apps/server/scripts/**"],
 "workflow-nodes":["packages/nodes/**","packages/nodeShared/**","packages/nodeScaffold/**"],
 "canvas-extensions":["packages/ext/**","packages/extScaffold/**"],
 "web-console":["apps/web/**","postcss.config.ts"],
 "desktop-shell":["apps/desktop/**","apps/updateServer/**","packages/startup/**","compat/macIntel/**","electrobun.config.ts","hutch.config.ts"],
 "mobile-shell":["apps/mobile/**","compat/ohos/**"],
}
def glob_re(p):
    i,n,res=0,len(p),""
    while i<n:
        c=p[i]
        if c=="*":
            if p[i:i+3]=="**/": res+="(?:.*/)?"; i+=3; continue
            if p[i:i+2]=="**": res+=".*"; i+=2; continue
            res+="[^/]*"
        elif c=="?": res+="[^/]"
        else: res+=re.escape(c)
        i+=1
    return re.compile("^"+res+"$")
pats=[(m,glob_re(g)) for m,gs in MODULES.items() for g in gs]
def mod_of(f):
    for m,rx in pats:
        if rx.match(f): return m
assign={f:mod_of(f) for f in files}
PKGS=[("@toonflow/file","shared-foundation"),("@toonflow/i18n","shared-foundation"),("@toonflow/model-icons","shared-foundation"),("@toonflow/assets","shared-foundation"),
("@toonflow/ffmpeg","media-toolkit"),("@toonflow/asr","media-toolkit"),
("@toonflow/providers","ai-providers"),
("@toonflow/tools-scaffold","agent-tools"),("@toonflow/mcp","agent-tools"),
("@toonflow/nodes-scaffold","workflow-nodes"),("@toonflow/node-shared","workflow-nodes"),
("@toonflow/ext-scaffold","canvas-extensions"),
("@toonflow/startup","desktop-shell"),
("@toonflow/team-scaffold","agent-runtime"),
("@toonflow/server","server-api"),("@toonflow/web","web-console"),("@toonflow/desktop","desktop-shell")]
def resolve_pkg(spec):
    if spec.startswith("@toonflow/tool-"): return "agent-tools"
    if spec.startswith("@toonflow/node-"): return "workflow-nodes"
    if spec.startswith("@toonflow/ext-"): return "canvas-extensions"
    if spec.startswith("@toonflow/team-"): return "agent-runtime"
    for p,m in PKGS:
        if spec==p or spec.startswith(p+"/"): return m
    return None
SERVER_EXPORTS={"./agent/types":"apps/server/src/agent/runtime/types.ts","./agent/mentionSources":"apps/server/src/agent/mentionSources.ts",
"./app":"apps/server/src/app.ts","./desktop":"apps/server/src/types/desktop.ts","./platform":"apps/server/src/lib/platform.ts",
"./nodeMenu":"apps/server/src/lib/nodeMenu.ts","./modelReasoning":"apps/server/src/lib/modelReasoning.ts","./documentFormats":"apps/server/src/lib/documentFormats.ts",
"./mcp":"apps/server/src/utils/mcp/runtime.ts","./mobileLink":"apps/server/src/utils/mobileLink/index.ts","./browser":"apps/server/src/utils/browser/index.ts",
"./singleAgent/types":"apps/server/src/utils/singleAgent/types.ts","./i18n":"apps/server/src/lib/i18n.ts","./remoteConnection":"apps/server/src/remoteConnection.ts"}
import_re=re.compile(r'''(?:from\s+|require\(\s*|import\(\s*)["']([^"']+)["']''')
edge=defaultdict(lambda: {"count":0,"examples":[],"files":set()})
for f in files:
    src=assign[f]
    if not src: continue
    text=open(f,encoding="utf-8",errors="ignore").read()
    for spec in import_re.findall(text):
        tgt=None
        if spec.startswith("."):
            p=os.path.normpath(os.path.join(os.path.dirname(f),spec))
            rel=os.path.relpath(p,ROOT).replace(os.sep,"/")
            tgt=assign.get(rel)
            if tgt is None:
                for cand in (rel+".ts",rel+".tsx",rel+".vue",rel+".js",rel+"/index.ts",rel+"/index.vue"):
                    if assign.get(cand): tgt=assign[cand]; break
            if tgt is None:
                pre=rel.rstrip("/")+"/"
                for ff in files:
                    if ff.startswith(pre): tgt=assign[ff]; break
        elif spec.startswith("@/"):
            if f.startswith("apps/server/"):
                rel=os.path.normpath("apps/server/src/"+spec[2:]).replace(os.sep,"/")
                tgt=assign.get(rel)
                if tgt is None:
                    for cand in (rel+".ts",rel+".tsx",rel+".vue",rel+"/index.ts",rel+"/index.vue"):
                        if assign.get(cand): tgt=assign[cand]; break
                if tgt is None:
                    pre=rel.rstrip("/")+"/"
                    for ff in files:
                        if ff.startswith(pre): tgt=assign[ff]; break
            elif f.startswith("apps/web/"):
                rel=os.path.normpath("apps/web/src/"+spec[2:]).replace(os.sep,"/")
                tgt=assign.get(rel)
                if tgt is None:
                    for cand in (rel+".ts",rel+".tsx",rel+".vue",rel+"/index.ts",rel+"/index.vue"):
                        if assign.get(cand): tgt=assign[cand]; break
        elif spec.startswith("@toonflow/server/"):
            sub="./"+spec[len("@toonflow/server/"):]
            target=SERVER_EXPORTS.get(sub)
            if target:
                tgt=assign.get(target)
            else:
                tgt="server-api"
        else:
            tgt=resolve_pkg(spec)
        if tgt and tgt!=src:
            e=edge[(src,tgt)]; e["count"]+=1; e["files"].add(f)
            if len(e["examples"])<8 and spec not in e["examples"]: e["examples"].append(spec)
print("=== EDGES (count, files) ===")
for (s,t),e in sorted(edge.items(), key=lambda x:-x[1]["count"]):
    print(f"{s} -> {t}: {e['count']} in {len(e['files'])} files | {e['examples'][:6]}")
json.dump({f"{s}->{t}":{"count":e["count"],"files":sorted(e["files"]),"examples":e["examples"]} for (s,t),e in edge.items()},open(".easyvibe/map/_analysis/edges_raw2.json","w"),ensure_ascii=False,indent=1)
