"""Status line: shows Claude's rate-limit use and caches it in ~/.claude/claude-limits.json for the routing check."""
import json, os, sys, time

data = json.load(sys.stdin)
cache = os.path.expanduser("~/.claude/claude-limits.json")
limits = data.get("rate_limits")
if limits:
    with open(cache, "w") as f:
        json.dump({"saved_at": time.time(), "rate_limits": limits}, f)

def pct(name):
    w = (limits or {}).get(name) or {}
    v = w.get("used_percentage", w.get("utilization"))
    return "?" if v is None else f"{v:.0f}%"

model = (data.get("model") or {}).get("display_name", "")
print(f"{model} · Claude 5h {pct('five_hour')} · wk {pct('seven_day')}" if limits else model)
