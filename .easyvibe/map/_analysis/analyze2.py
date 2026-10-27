import os,re,json,subprocess
from collections import defaultdict, Counter

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
pats=[(m,g,glob_re(g)) for m,gs in MODULES.items() for g in gs]
def mod_of(f):
    for m,g,rx in pats:
        if rx.match(f): return m
    return None
assign={f:mod_of(f) for f in files}
uncovered=[f for f in files if not assign[f]]
print("files",len(files),"uncovered",len(uncovered))
for f in uncovered[:50]: print("  MISS",f)

# stats
stats={}
for m in MODULES:
    fs=[f for f in files if assign[f]==m]
    loc=0; sizes=[]
    for f in fs:
        try: l=sum(1 for _ in open(f,encoding="utf-8",errors="ignore"))
        except: l=0
        loc+=l; sizes.append((l,f))
    stats[m]={"files":len(fs),"loc":loc,"largest":sorted(sizes,reverse=True)[:5]}
print(json.dumps(stats,ensure_ascii=False,indent=1))

# churn since 3 months
out=subprocess.run(["git","log","--since=2026-07-25","--name-only","--pretty=format:__C__"],capture_output=True,text=True).stdout
commits=[c for c in out.split("__C__") if c.strip()]
churn_commits=Counter(); churn_touches=Counter()
for c in commits:
    touched=set()
    for line in c.strip().splitlines():
        line=line.strip()
        if not line: continue
        m=assign.get(line)
        if m: touched.add(m)
    for m in touched: churn_commits[m]+=1
    for line in c.strip().splitlines():
        line=line.strip(); m=assign.get(line)
        if m: churn_touches[m]+=1
print("total commits",len(commits))
print("churn:",{m:(churn_commits[m],churn_touches[m]) for m in MODULES})

# import extraction
import_re=re.compile(r'''(?:from\s+|require\(\s*|import\(\s*)["']([^"']+)["']''')
alias_server=os.path.join(ROOT,"apps/server/src")
alias_web=os.path.join(ROOT,"apps/web/src")
PKG={"@toonflow/file":"shared-foundation","@toonflow/i18n":"shared-foundation","@toonflow/model-icons":"shared-foundation","@toonflow/assets":"shared-foundation",
"@toonflow/ffmpeg":"media-toolkit","@toonflow/asr":"media-toolkit",
"@toonflow/providers":"ai-providers",
"@toonflow/tools-scaffold":"agent-tools","@toonflow/mcp":"agent-tools",
"@toonflow/nodes-scaffold":"workflow-nodes","@toonflow/node-shared":"workflow-nodes",
"@toonflow/ext-scaffold":"canvas-extensions",
"@toonflow/startup":"desktop-shell",
"@toonflow/team-scaffold":"agent-runtime",
"@toonflow/server":"server-api","@toonflow/web":"web-console","@toonflow/desktop":"desktop-shell"}
def resolve_pkg(spec):
    if spec.startswith("@toonflow/tool-"): return "agent-tools"
    if spec.startswith("@toonflow/node-"): return "workflow-nodes"
    if spec.startswith("@toonflow/ext-"): return "canvas-extensions"
    if spec.startswith("@toonflow/team-"): return "agent-runtime"
    return PKG.get(spec)
edge=defaultdict(lambda: {"count":0,"examples":[]})
for f in files:
    src=assign[f]
    if not src: continue
    try: text=open(f,encoding="utf-8",errors="ignore").read()
    except: continue
    specs=import_re.findall(text)
    for spec in specs:
        tgt=None
        if spec.startswith("."):
            base=os.path.dirname(f)
            p=os.path.normpath(os.path.join(base,spec))
            rel=os.path.relpath(p,ROOT).replace(os.sep,"/")
            tgt=assign.get(rel)
            if tgt is None:
                # try index file / extension
                for cand in (rel+".ts",rel+".tsx",rel+".vue",rel+"/index.ts",rel+"/index.vue"):
                    if assign.get(cand): tgt=assign[cand]; break
            if tgt is None:
                # directory prefix match
                for ff in files:
                    if ff.startswith(rel.rstrip("/")+"/"):
                        tgt=assign[ff]
                        if tgt: break
        elif spec.startswith("@/"):
            relsrc="apps/server/src/"+spec[2:] if f.startswith("apps/server/") else ("apps/web/src/"+spec[2:] if f.startswith("apps/web/") else None)
            if relsrc:
                rel=os.path.normpath(relsrc).replace(os.sep,"/")
                tgt=assign.get(rel)
                if tgt is None:
                    for cand in (rel+".ts",rel+".tsx",rel+".vue",rel+"/index.ts",rel+"/index.vue"):
                        if assign.get(cand): tgt=assign[cand]; break
                if tgt is None:
                    pre=rel.rstrip("/")+"/"
                    for ff in files:
                        if ff.startswith(pre): tgt=assign[ff]; break
        else:
            tgt=resolve_pkg(spec)
        if tgt and tgt!=src:
            key=(src,tgt)
            e=edge[key]; e["count"]+=1
            if len(e["examples"])<12 and spec not in e["examples"]: e["examples"].append(spec)
print("=== EDGE COUNTS ===")
for (s,t),e in sorted(edge.items(), key=lambda x:-x[1]["count"]):
    print(f"{s} -> {t}: {e['count']}  {e['examples'][:5]}")
