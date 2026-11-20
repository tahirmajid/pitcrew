"""Status line: shows Claude's rate-limit use and caches it in ~/.claude/claude-limits.json for the routing check."""
import json, os, sys, time

data = json.load(sys.stdin)
cache = os.path.expanduser("~/.claude/claude-limits.json")
limits = data.get("rate_limits")
if limits:
    # Every session writes this file with its own last-seen numbers, so keep the higher use within one window.
    try:
        old = json.load(open(cache))["rate_limits"]
    except (OSError, ValueError, KeyError):
        old = {}
    for name, new in limits.items():
        was = old.get(name) or {}
        if isinstance(new, dict) and was.get("resets_at") == new.get("resets_at") and was.get("used_percentage", 0) > new.get("used_percentage", 0):
            limits[name] = was
    with open(cache, "w") as f:
        json.dump({"saved_at": time.time(), "rate_limits": limits}, f)

def pct(name):
    w = (limits or {}).get(name) or {}
    v = w.get("used_percentage", w.get("utilization"))
    return "?" if v is None else f"{v:.0f}%"

model = (data.get("model") or {}).get("display_name", "")
print(f"{model} · Claude 5h {pct('five_hour')} · wk {pct('seven_day')}" if limits else model)
