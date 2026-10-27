import json,os
from datetime import datetime
raw=json.load(open(".easyvibe/map/_analysis/edges_raw2.json"))
order=json.load(open(".easyvibe/map/emit_order.json"))
layers={l["id"]:l["order"] for l in order["layers"]}
mod_layer={mid:json.load(open(f".easyvibe/map/parts/{mid}.json"))["layer"] for mid in order["modules"]}
parts={}
for mid in order["modules"]:
    ed=json.load(open(f".easyvibe/map/parts/{mid}.edges.json"))
    for e in ed["edges"]: parts[(e["from"],e["to"])]=e
rawpairs={tuple(k.split("->")):v for k,v in raw.items()}
build_time={
 ("mobile-shell","desktop-shell"):"构建脚本读取 electrobun.config（编译期配置清单）",
 ("web-console","desktop-shell"):"vite 配置读取 electrobun.config（构建期路径清单）",
 ("workflow-nodes","web-console"):"节点构建读取 postcss.config（构建期配置）",
 ("agent-tools","web-console"):"工具构建读取 postcss.config（构建期配置）",
}
missing=[p for p in rawpairs if p not in parts and p not in build_time]
extra=[p for p in parts if p not in rawpairs]
viol=[]
for p,e in parts.items():
    exp=layers[mod_layer[e["from"]]]>layers[mod_layer[e["to"]]]
    if bool(e.get("direction_violation",False))!=exp:
        viol.append({"edge":e["id"],"pair":p,"expected":exp,"actual":e.get("direction_violation",False)})
report={"checked_at":datetime.now().astimezone().isoformat(timespec="seconds"),
 "edges_in_map":len(parts),"raw_pairs":len(rawpairs),
 "dropped_build_time":[{"pair":"->".join(p),"reason":r,"evidence":rawpairs[p]["count"]} for p,r in build_time.items()],
 "unmapped_evidence":[{"pair":"->".join(p),"count":rawpairs[p]["count"]} for p in missing],
 "edges_without_evidence":["->".join(p) for p in extra],
 "direction_violation_check":viol}
json.dump(report,open(".easyvibe/map/_analysis/edges_verify.json","w"),ensure_ascii=False,indent=2)
print(json.dumps(report,ensure_ascii=False,indent=1))
# progress edging
prog={"phase":"edging","modules_total":len(order["modules"]),"modules_done":len(order["modules"]),
      "current_module":None,"percent":80,"updated_at":datetime.now().astimezone().isoformat(timespec="seconds")}
open(".easyvibe/map/progress.json.tmp","w",encoding="utf-8").write(json.dumps(prog,ensure_ascii=False,indent=2)+"\n")
os.replace(".easyvibe/map/progress.json.tmp",".easyvibe/map/progress.json")
