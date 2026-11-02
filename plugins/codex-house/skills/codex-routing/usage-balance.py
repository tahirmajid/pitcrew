"""Prints Claude and Codex weekly use, then the routing verdict for the codex-routing skill."""
import glob, json, os, re, time

WEEK_MIN = 10080


def pace(used, resets_at):
    """Returns (used, elapsed%) for a weekly window."""
    elapsed = max(0, min(100, 100 * (1 - (resets_at - time.time()) / 60 / WEEK_MIN)))
    return used, elapsed


def codex():
    """Reads Codex's weekly window from the newest rollout log."""
    logs = sorted(glob.glob(os.path.expanduser("~/.codex/sessions/*/*/*/*.jsonl")), key=os.path.getmtime)
    snap = None
    for line in open(logs[-1]) if logs else []:
        m = re.search(r'"rate_limits":(\{.*?"rate_limit_reached_type":[^,}]*\})', line) if '"rate_limits"' in line else None
        if m:
            snap = json.loads(m.group(1))
    windows = (snap.get("primary"), snap.get("secondary")) if snap else ()
    week = next((w for w in windows if w and w.get("window_minutes") == WEEK_MIN), None)
    if not week:
        return None
    return (*pace(week["used_percent"], week["resets_at"]), week["resets_at"], snap.get("rate_limit_reached_type"))


def claude():
    """Reads Claude's limits that the status line caches on every refresh."""
    try:
        d = json.load(open(os.path.expanduser("~/.claude/claude-limits.json")))
    except (OSError, ValueError):
        return None
    wk, five = d["rate_limits"].get("seven_day"), d["rate_limits"].get("five_hour") or {}
    if not wk:
        return None
    return (*pace(wk["used_percentage"], wk["resets_at"]), wk["resets_at"], five.get("used_percentage", 0), (time.time() - d["saved_at"]) / 60)


def when(ts):
    return time.strftime("%a %d %b %H:%M", time.localtime(ts))


cx, cl = codex(), claude()
codex_off = bool(cx and (cx[3] or cx[0] >= 85))
claude_used = max(cl[0], 75 if cl[3] >= 80 else 0) if cl else None

if cx:
    print(f"codex  weekly {cx[0]:.0f}% used, week {cx[1]:.0f}% gone, resets {when(cx[2])}, reached={cx[3]}")
else:
    print("codex  unknown (no rate_limits logged; run one small Codex runner job)")
if cl:
    print(f"claude weekly {cl[0]:.0f}% used, week {cl[1]:.0f}% gone, 5h {cl[3]:.0f}%, resets {when(cl[2])}, snapshot {cl[4]:.0f} min old")
else:
    print("claude unknown (status line hasn't cached ~/.claude/claude-limits.json yet)")

if codex_off:
    verdict = "codex-off: no Codex until it resets; everything on Claude agents" + ("; Claude is tight too, must-finish work only, tell the user" if claude_used is not None and claude_used >= 75 else "")
elif claude_used is None:
    verdict = "normal (Claude unknown): Codex for review, second diagnosis and legwork; implementation and analysis on Claude"
elif claude_used >= 75:
    verdict = "orchestrate: most work to Codex; Claude only orchestrates, verifies, and does what Codex can't"
elif claude_used >= 60:
    verdict = "implement: Codex also takes implementation, on top of review, second diagnosis and legwork"
else:
    verdict = "normal: Codex for review, second diagnosis and legwork; implementation and analysis on Claude"
print("verdict", verdict)
