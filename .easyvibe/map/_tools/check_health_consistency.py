#!/usr/bin/env python3
"""地图 health ↔ edges 一致性守卫（只读）。

用途：地图的 health 是「架构问题是否复现」的复检读数来源，必须与 edges 自洽。
本脚本用确定性规则核对四件事，任何一条不成立即 exit 1：
  1. 含 agent-runtime 的模块级有向环（Tarjan）必须为 0，且 health 不得再留 circular_dep
     （宿主壳 server-api↔desktop-shell 的 e13/e26 回边属既有 layer_violation，单独列出、不通过本项判定）；
  2. health 文本不得继续断言「双向 import / 构成环 / 环落在…」这类存在性结论；
  3. critical concern 不得指向已不存在的环；
  4. decay_flags 与边证据自洽：layer_violation 必须有 direction_violation 边支撑，
     模块 dependencies 必须等于其出边目标集合，且 agent-runtime 不得再有指向 server-api 的边。
输出一行 JSON 摘要，供测试报告逐字引用。
"""
import json
import os
import re
import sys

MAP = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "map.json")
CYCLE_TEXT = [
    re.compile(p) for p in (
        r"双向\s*import", r"双向引用", r"构成环", r"形成环", r"形成模块环",
        r"环仍", r"环落在", r"形成.{0,6}环", r"未端口化",
    )
]


def strongly_connected(nodes, graph):
    index, stack, on_stack, result = {}, [], set(), []
    counter = [0]

    def strong(v):
        index[v] = low[v] = counter[0]
        counter[0] += 1
        stack.append(v)
        on_stack.add(v)
        for w in graph.get(v, ()):
            if w not in index:
                strong(w)
                low[v] = min(low[v], low[w])
            elif w in on_stack:
                low[v] = min(low[v], index[w])
        if low[v] == index[v]:
            comp = []
            while True:
                w = stack.pop()
                on_stack.discard(w)
                comp.append(w)
                if w == v:
                    break
            result.append(comp)

    low = {}
    for v in nodes:
        if v not in index:
            strong(v)
    return result


def health_surfaces(map_data):
    out = [("health", "architecture", map_data["health"])]
    for mod in map_data["modules"]:
        out.append(("health", mod["id"], mod["health"]))
        if "parent" in map_data:  # submap
            continue
    return out


def scan_text(where, health, hits):
    for field in ("review_note",):
        text = health.get(field, "")
        for pattern in CYCLE_TEXT:
            if pattern.search(text):
                hits.append({"where": where, "field": field, "pattern": pattern.pattern})
    for i, concern in enumerate(health.get("concerns", [])):
        for field in ("finding", "suggestion"):
            text = concern.get(field, "")
            for pattern in CYCLE_TEXT:
                if pattern.search(text):
                    hits.append({"where": where, "field": f"concerns[{i}].{field}",
                                 "severity": concern.get("severity"), "pattern": pattern.pattern})


def main():
    with open(os.path.normpath(MAP), encoding="utf-8") as f:
        map_data = json.load(f)
    modules = map_data["modules"]
    edges = map_data["edges"]
    ids = {m["id"] for m in modules}
    graph = {m["id"]: [] for m in modules}
    for edge in edges:
        if edge["from"] in ids and edge["to"] in ids:
            graph[edge["from"]].append(edge["to"])

    scc = [c for c in strongly_connected(sorted(ids), graph) if len(c) > 1]
    self_loops = [e["id"] for e in edges if e["from"] == e["to"]]
    agent_scc = [c for c in scc if "agent-runtime" in c]
    other_scc = [c for c in scc if "agent-runtime" not in c]

    cycle_claim_hits, circular_flags = [], []
    for kind, where, health in health_surfaces(map_data):
        scan_text(where, health, cycle_claim_hits)
        if "circular_dep" in health.get("decay_flags", []):
            circular_flags.append(where)

    critical_cycle = [h for h in cycle_claim_hits if h.get("severity") == "critical"]
    violation_edges = [e["id"] for e in edges if e.get("direction_violation")]
    layer_flag = "layer_violation" in map_data["health"].get("decay_flags", [])
    deps_mismatch = []
    for mod in modules:
        expected = sorted({e["to"] for e in edges if e["from"] == mod["id"]})
        if mod.get("dependencies") != expected:
            deps_mismatch.append(mod["id"])
    agent_to_server = [e["id"] for e in edges if e["from"] == "agent-runtime" and e["to"] == "server-api"]

    summary = {
        "modules": len(modules),
        "edges": len(edges),
        "module_scc_total": len(scc),
        "agent_scc": len(agent_scc),
        "pre_existing_scc": other_scc,
        "self_loops": len(self_loops),
        "circular_dep_flags": len(circular_flags),
        "cycle_claim_hits": len(cycle_claim_hits),
        "critical_cycle_concerns": len(critical_cycle),
        "direction_violation_edges": len(violation_edges),
        "layer_violation_flag": layer_flag,
        "deps_mismatch": len(deps_mismatch),
        "agent_to_server_edges": len(agent_to_server),
        "ok": not (agent_scc or self_loops or circular_flags or cycle_claim_hits or deps_mismatch
                   or agent_to_server or (layer_flag != bool(violation_edges))),
    }
    print(json.dumps(summary, ensure_ascii=False, sort_keys=True))
    if not summary["ok"]:
        for item in ({"agent_scc": agent_scc}, {"circular_flags": circular_flags},
                     {"claims": cycle_claim_hits},
                     {"deps_mismatch": deps_mismatch}, {"agent_to_server": agent_to_server}):
            print(json.dumps(item, ensure_ascii=False), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
