#!/usr/bin/env python3
"""EasyVibe map CLI: init / emit-module / append-log / finalize.

Single source of truth for validation, coverage and atomic assembly.
No file locks: every shared write is tmp + os.replace.
"""
import argparse
import fnmatch
import json
import os
import re
import sys
import time
from datetime import datetime, timezone

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
MAP_DIR = os.path.join(ROOT, ".easyvibe", "map")
PARTS_DIR = os.path.join(MAP_DIR, "parts")
PROGRESS = os.path.join(MAP_DIR, "progress.json")
GROWTH = os.path.join(MAP_DIR, "growth.log")
EMIT_ORDER = os.path.join(MAP_DIR, "emit_order.json")
SCHEMA = os.environ.get("EASYVIBE_SCHEMA_PATH")
CODE_EXTS = {".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts", ".vue",
             ".sql", ".ets", ".java", ".kt", ".kts", ".cs", ".cpp", ".h", ".hpp", ".m", ".mm"}
SKIP_DIRS = {"node_modules", "dist", "build", ".git", ".easyvibe", ".hutch", "__pycache__"}


def now():
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


def read_json(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def write_json(path, data):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")
    os.replace(tmp, path)


def append_jsonl(path, obj):
    with open(path, "a", encoding="utf-8") as f:
        f.write(json.dumps(obj, ensure_ascii=False) + "\n")
        f.flush()


def progress(phase, total=0, done=0, current=None, percent=0, error=None, **extra):
    data = {"phase": phase, "modules_total": total, "modules_done": done,
            "current_module": current, "percent": percent, "updated_at": now()}
    data.update(extra)
    if error:
        data["error"] = error
    write_json(PROGRESS, data)


# ---------------- schema validation ----------------

def resolve_ref(root, ref):
    assert ref.startswith("#/")
    node = root
    for part in ref[2:].split("/"):
        node = node[part.replace("~1", "/").replace("~0", "~")]
    return node


def validate(inst, schema, root, path="$"):
    errors = []
    if "$ref" in schema:
        return validate(inst, resolve_ref(root, schema["$ref"]), root, path)
    t = schema.get("type")
    ok = True
    if t == "object":
        ok = isinstance(inst, dict)
    elif t == "array":
        ok = isinstance(inst, list)
    elif t == "string":
        ok = isinstance(inst, str)
    elif t == "integer":
        ok = isinstance(inst, int) and not isinstance(inst, bool)
    elif t == "number":
        ok = isinstance(inst, (int, float)) and not isinstance(inst, bool)
    elif t == "boolean":
        ok = isinstance(inst, bool)
    if t and not ok:
        return [f"{path}: expected {t}, got {type(inst).__name__}"]
    if "const" in schema and inst != schema["const"]:
        errors.append(f"{path}: must equal {schema['const']!r}")
    if "enum" in schema and inst not in schema["enum"]:
        errors.append(f"{path}: {inst!r} not in {schema['enum']}")
    if isinstance(inst, str):
        if "minLength" in schema and len(inst) < schema["minLength"]:
            errors.append(f"{path}: shorter than minLength {schema['minLength']}")
        if "pattern" in schema and not re.search(schema["pattern"], inst):
            errors.append(f"{path}: does not match {schema['pattern']}")
    if isinstance(inst, (int, float)) and not isinstance(inst, bool):
        if "minimum" in schema and inst < schema["minimum"]:
            errors.append(f"{path}: below minimum {schema['minimum']}")
        if "maximum" in schema and inst > schema["maximum"]:
            errors.append(f"{path}: above maximum {schema['maximum']}")
    if isinstance(inst, list):
        if "minItems" in schema and len(inst) < schema["minItems"]:
            errors.append(f"{path}: fewer than minItems {schema['minItems']}")
        if "maxItems" in schema and len(inst) > schema["maxItems"]:
            errors.append(f"{path}: more than maxItems {schema['maxItems']}")
        if "items" in schema:
            for i, item in enumerate(inst):
                errors += validate(item, schema["items"], root, f"{path}[{i}]")
    if isinstance(inst, dict):
        for key in schema.get("required", []):
            if key not in inst:
                errors.append(f"{path}: missing required {key}")
        props = schema.get("properties", {})
        if schema.get("additionalProperties") is False:
            for key in inst:
                if key not in props:
                    errors.append(f"{path}: additional property {key} not allowed")
        for key, subschema in props.items():
            if key in inst:
                errors += validate(inst[key], subschema, root, f"{path}.{key}")
    return errors


def load_schema():
    if not SCHEMA or not os.path.exists(SCHEMA):
        sys.exit("EASYVIBE_SCHEMA_PATH missing/unreadable")
    return read_json(SCHEMA)


def schema_errors(data):
    root = load_schema()
    return validate(data, root, root)


# ---------------- coverage ----------------

def product_files():
    out = []
    for base, dirs, files in os.walk(ROOT):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS and not d.startswith(".git")]
        for name in files:
            if os.path.splitext(name)[1] in CODE_EXTS:
                out.append(os.path.relpath(os.path.join(base, name), ROOT).replace(os.sep, "/"))
    return sorted(out)


def glob_re(pattern):
    i, n, res = 0, len(pattern), ""
    while i < n:
        c = pattern[i]
        if c == "*":
            if pattern[i:i + 3] == "**/":
                res += "(?:.*/)?"
                i += 3
                continue
            if pattern[i:i + 2] == "**":
                res += ".*"
                i += 2
                continue
            res += "[^/]*"
        elif c == "?":
            res += "[^/]"
        else:
            res += re.escape(c)
        i += 1
    return re.compile("^" + res + "$")


def covered_files(modules):
    patterns = []
    for m in modules:
        for g in m["files"]:
            patterns.append((m["id"], g, glob_re(g)))
    hits = {}
    for f in product_files():
        for mid, raw, rx in patterns:
            if rx.match(f):
                hits.setdefault(f, set()).add(mid)
    return hits


# ---------------- commands ----------------

def cmd_init(_args):
    os.makedirs(PARTS_DIR, exist_ok=True)
    os.makedirs(os.path.join(MAP_DIR, "_tools"), exist_ok=True)
    decision = "none"
    old = os.path.join(MAP_DIR, "map.json")
    if os.path.exists(old):
        try:
            old_map = read_json(old)
        except Exception:
            decision = "unparseable"
            old_map = None
        if isinstance(old_map, dict):
            allowed = {"version", "meta", "layers", "modules", "edges", "health"}
            extra = set(old_map) - allowed
            decision = "compliant_generated" if not extra else "non_compliant_generated"
        if decision != "compliant_generated":
            stamp = time.strftime("%Y%m%d-%H%M%S")
            os.replace(old, f"{old}.{stamp}.bak")
    if os.path.exists(GROWTH) and os.path.getsize(GROWTH) > 0:
        stamp = time.strftime("%Y%m%d-%H%M%S")
        os.replace(GROWTH, f"{GROWTH}.{stamp}.bak")
    open(GROWTH, "w", encoding="utf-8").close()
    progress("init", decision_reason=decision)
    print(json.dumps({"decision_reason": decision}))


def cmd_emit_module(_args):
    data = json.load(sys.stdin)
    root = load_schema()
    errors = validate(data, root["$defs"]["health"], root, "$.health") if "health" in data else []
    mod_schema = root["properties"]["modules"]["items"]
    errors = validate(data, mod_schema, root, "$")
    if errors:
        print("\n".join(errors), file=sys.stderr)
        sys.exit(2)
    if not re.match(r"^[a-z][a-z0-9_-]*$", data["id"]):
        sys.exit("bad module id")
    write_json(os.path.join(PARTS_DIR, data["id"] + ".json"), data)
    print(data["id"])


def cmd_write_edges(_args):
    data = json.load(sys.stdin)
    mid = data["module"]
    if not re.match(r"^[a-z][a-z0-9_-]*$", mid):
        sys.exit("bad module id")
    root = load_schema()
    edge_schema = root["properties"]["edges"]["items"]
    for edge in data.get("edges", []):
        errs = validate(edge, edge_schema, root, "$.edges")
        if errs:
            print("\n".join(errs), file=sys.stderr)
            sys.exit(2)
        if edge["from"] != mid:
            sys.exit(f"edge {edge['id']} from must be {mid}")
    write_json(os.path.join(PARTS_DIR, mid + ".edges.json"), data)
    print(mid)


def load_parts(order):
    modules, edges = [], []
    for mid in order["modules"]:
        mpath = os.path.join(PARTS_DIR, mid + ".json")
        epath = os.path.join(PARTS_DIR, mid + ".edges.json")
        if not os.path.exists(mpath):
            sys.exit(f"missing part: {mid}")
        mod = read_json(mpath)
        mod["dependencies"] = sorted({e["to"] for e in (read_json(epath)["edges"] if os.path.exists(epath) else [])})
        modules.append(mod)
        if os.path.exists(epath):
            edges.extend(read_json(epath)["edges"])
    return modules, edges


def cmd_append_log(args):
    order = read_json(EMIT_ORDER)
    modules, edges = load_parts(order)
    seen_layers, seen_modules, seen_archive = set(), set(), False
    if os.path.exists(GROWTH):
        with open(GROWTH, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                ev = json.loads(line)
                if ev["type"] == "layer":
                    seen_layers.add(ev["layer"]["id"])
                elif ev["type"] == "module":
                    seen_modules.add(ev["module"]["id"])
                elif ev["type"] == "arch_health":
                    seen_archive = True
    added_layers, added_modules = 0, 0
    for layer in order["layers"]:
        if layer["id"] not in seen_layers:
            append_jsonl(GROWTH, {"type": "layer", "layer": layer})
            added_layers += 1
    by_id = {m["id"]: m for m in modules}
    for mid in order["modules"]:
        if mid in seen_modules:
            continue
        mod = by_id[mid]
        out = [e for e in edges if e["from"] == mid]
        append_jsonl(GROWTH, {"type": "module", "module": mod, "out_edges": out})
        added_modules += 1
    arch_path = os.path.join(PARTS_DIR, "_arch_health.json")
    if os.path.exists(arch_path) and not seen_archive:
        append_jsonl(GROWTH, {"type": "arch_health", "health": read_json(arch_path)})
    print(f"appended layers={added_layers} modules={added_modules} edges={len(edges)}")


def cmd_finalize(args):
    order = read_json(EMIT_ORDER)
    layers = sorted(order["layers"], key=lambda x: x["order"])
    modules, edges = load_parts(order)
    modules.sort(key=lambda m: next(l["order"] for l in layers if l["id"] == m["layer"]) * 1000 + list(order["modules"]).index(m["id"]))
    arch_path = os.path.join(PARTS_DIR, "_arch_health.json")
    if not os.path.exists(arch_path):
        sys.exit("missing parts/_arch_health.json")
    arch = read_json(arch_path)

    files = product_files()
    hits = covered_files(modules)
    covered = len(hits)
    total = len(files)
    ratio = (covered / total) if total else 1.0
    missing = [f for f in files if f not in hits]
    if ratio < 0.9:
        progress("failed", len(modules), len(modules), None, 99,
                 error=f"coverage {covered}/{total}={ratio:.2%} < 90%; missing={missing[:20]}")
        sys.exit(f"coverage too low: {covered}/{total}; missing {missing[:20]}")

    for m in modules:
        m["dependencies"] = sorted({e["to"] for e in edges if e["from"] == m["id"]})
        m["last_analyzed_at"] = m.get("last_analyzed_at") or args.generated_at
    for e in edges:
        if e["from"] == e["to"]:
            sys.exit(f"self edge {e['id']}")

    map_data = {
        "version": "1.0",
        "meta": {
            "repo": "Toonflow-app",
            "generated_at": args.generated_at,
            "generator": "easyvibe-architect/claude-opus-4-6",
            "description": "Toonflow AI 短剧漫剧创作平台：Vue 工作区 + Express 服务 + Agent 运行时，插件化节点/工具/扩展，桌面与移动端原生壳分发。",
            "languages": ["TypeScript", "Vue", "JavaScript"],
            "loc": sum(1 for _ in []) or args.loc,
            "map_freshness": "fresh",
            "stats": {
                "files_total": total,
                "files_covered": covered,
                "coverage_ratio": round(ratio, 4),
                "edges_derived": len(edges),
                "edges_inferred": 0,
                "retried_modules": 0,
            },
        },
        "layers": layers,
        "modules": modules,
        "edges": edges,
        "health": arch,
    }
    errors = schema_errors(map_data)
    if errors:
        print("\n".join(errors[:40]), file=sys.stderr)
        progress("failed", len(modules), len(modules), None, 99, error="schema validation failed")
        sys.exit("schema validation failed")

    # replay growth.log and compare
    replay_layers, replay_modules, replay_edges, replay_health = [], {}, [], None
    with open(GROWTH, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            ev = json.loads(line)
            if ev["type"] == "layer":
                replay_layers.append(ev["layer"])
            elif ev["type"] == "module":
                replay_modules[ev["module"]["id"]] = ev["module"]
                replay_edges.extend(ev.get("out_edges", []))
            elif ev["type"] == "arch_health":
                replay_health = ev["health"]
    problems = []
    if sorted(replay_layers, key=lambda x: x["order"]) != layers:
        problems.append("layers differ from growth.log")
    if set(replay_modules) != {m["id"] for m in modules}:
        problems.append("module set differs from growth.log")
    if {e["id"]: e for e in replay_edges} != {e["id"]: e for e in edges}:
        problems.append("edges differ from growth.log")
    if replay_health != arch:
        problems.append("arch health differs from growth.log")
    for m in modules:
        if replay_modules.get(m["id"]) != m:
            problems.append(f"module {m['id']} differs from growth.log")
            break
    if problems:
        progress("failed", len(modules), len(modules), None, 99, error="; ".join(problems))
        sys.exit("; ".join(problems))

    write_json(os.path.join(MAP_DIR, "map.json"), map_data)
    progress("done", len(modules), len(modules), None, 100)
    append_jsonl(GROWTH, {"type": "done"})
    print(f"map.json written: modules={len(modules)} edges={len(edges)} coverage={ratio:.2%} ({covered}/{total})")


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("init").set_defaults(fn=cmd_init)
    sub.add_parser("emit-module").set_defaults(fn=cmd_emit_module)
    sub.add_parser("write-edges").set_defaults(fn=cmd_write_edges)
    sub.add_parser("append-log").set_defaults(fn=cmd_append_log)
    fin = sub.add_parser("finalize")
    fin.add_argument("--generated-at", default=now())
    fin.add_argument("--loc", type=int, default=0)
    fin.set_defaults(fn=cmd_finalize)
    args = ap.parse_args()
    args.fn(args)


if __name__ == "__main__":
    main()
