#!/usr/bin/env python3
import json, os, sys, time
from datetime import datetime, timezone
MAP_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
PROGRESS = os.path.join(MAP_DIR, "progress.json")

def now():
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")

phase, percent = sys.argv[1], float(sys.argv[2])
total = int(sys.argv[3]) if len(sys.argv) > 3 else 0
done = int(sys.argv[4]) if len(sys.argv) > 4 else 0
current = sys.argv[5] if len(sys.argv) > 5 and sys.argv[5] != "-" else None
data = {"phase": phase, "modules_total": total, "modules_done": done,
        "current_module": current, "percent": percent, "updated_at": now()}
if phase == "init" and os.path.exists(PROGRESS):
    try: data["decision_reason"] = json.load(open(PROGRESS)).get("decision_reason", "none")
    except Exception: pass
tmp = PROGRESS + ".tmp"
with open(tmp, "w", encoding="utf-8") as f:
    json.dump(data, f, ensure_ascii=False, indent=2); f.write("\n")
os.replace(tmp, PROGRESS)
print(json.dumps(data, ensure_ascii=False))
