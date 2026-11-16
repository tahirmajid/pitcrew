---
title: Project retro artifact — reusable prompt
type: prompt
tags: [retro, prompt, template, artifact, leadership]
description: Prompt for producing a one-page, leadership-readable project retro, published as an artifact. Size caps come from a real retro its audience judged correctly sized.
---

# Project Retro Artifact — reusable prompt

Turns a finished piece of work into a one-page, leadership-readable retro, published as an artifact.
Works for code projects, but not only — evidence can come from git, a tracker, dashboards or threads.
Save the finished retro's notes under `projects/<slug>/retros/`.

**How to use:** open a session where the model can reach your evidence (the repo, the issue tracker,
dashboards, chat), fill the `<< >>` blanks, paste the whole prompt. It will ask you one or two scoping
questions before it starts measuring. Follow-ups for common failure modes are at the bottom.

**About the caps:** the limits in the depth contract were measured from a real retro artifact whose
leadership audience called it "not too much, not too little" — 8 sections, about 1,000 words of body
prose, longest section under 300 words. They are not invented. Re-measure against your own best
example if you have one.

---

## THE PROMPT

```
Build a project retro artifact for << PROJECT / PROGRAMME NAME >>.

## Scope
- Window: << START DATE >> → << END DATE >>
- Where the evidence lives: << repo(s) + a baseline ref for each · tracker project/ticket IDs ·
  dashboards · incident docs · chat channels — list everything that applies, "n/a" for the rest >>
- What counts as in-scope: << an explicit inclusion rule — PR range, label, linked epic — plus an
  exclusion list >>. Do NOT scope by author alone; that silently drops teammates' work on the same effort.
- Read first for context: << existing notes, design docs, diagrams — or "none" >>

## Depth contract — read this before anything else
Readers are the PM and the engineering leads. NOT the developers who did the work. It has to be
understood at a glance:
- At most 8 numbered sections, ~1,000 words of body prose across the whole page, and no section over
  300 words. These numbers come from a retro this audience judged correctly sized — treat them as a
  ceiling, not a target.
- Chart captions, labels and table cells sit outside that count — but a caption is one clause and a
  cell holds a number or a short label, never a sentence. Anything over 12 words counts as prose.
  Do not move prose into the exempt zones to fit the cap.
- Every sentence must change what a lead would decide or believe. A sentence that only proves work
  happened is cut, however true it is.
- Summarise the architecture, do not teach it. No playbooks or file-by-file walkthroughs.
- False starts and dead ends get one sentence each. Do not hide them, do not give them a section.
- When unsure whether something belongs, leave it out and add it to a "cut" list. Keep that list as
  you go — do not reconstruct it at the end.

## Pass 0 — settle what this retro is about
Before measuring anything: list the distinct initiatives you can actually see in the window, and say
which ones my scope rule covers. If several substantial efforts overlap, or if no label, epic or range
cleanly separates them, stop and ask me rather than measuring across all of them as if they were one
project. If the only way to separate them is a keyword heuristic, say so — it is a guess, and
everything downstream inherits it.

## Pass 1 — gather evidence (no retro narrative yet)
Reconstruct what actually happened from the systems of record, not from anyone's memory. Where the
tracker and the underlying work disagree, report what the work shows and say the tracker lags.
Gather, from whichever sources apply:
- How the work progressed over the window: volume, when it happened, what unblocked what.
- The delivery funnel: started / abandoned or folded / landed / still open.
- The before/after that defines the project, measured at both ends of the window. Use whatever unit
  this team already tracks — if that is not obvious, propose two candidates and ask me before measuring.
- The decision rationale: why this approach over the alternatives. This lives in tickets, docs and
  threads, not in the history of the work — go and read them for it.
- Who owns each thing still open, and what the next action on it is.
- If a diagram of this system or process already exists in the context I gave you, use it as the
  structural source rather than inventing a new one.

Then show me a table of every figure BEFORE writing any narrative, in two clearly separated lanes:
- MEASURED — each number with the exact command or query that produced it. Verify each one a second
  way where it is cheap: the failure mode is not a command that errors, it is quoting, interpolation
  or a stale ref silently returning a confident, plausible, wrong answer.
- REPORTED — facts with no command behind them (hires, incidents, decisions). Cite the source
  document or thread. Never invent a command to make one of these look measured.
Tag every row with its source (`git:`, `tracker:`, `dashboard:`, `chat:`, …). I will correct them.

Counting traps — check each before trusting a number:
- Fetch first and confirm the ref you are measuring is current. A stale local branch gives a wrong
  count that looks exactly like a right one.
- Dedupe by a stable id before summing across groups that can share items (stacked PRs, branches with
  common history, re-run jobs). Look for stacking explicitly — shared ancestry, or a "stacked on #N"
  note. A batch of items closed within seconds of each other is usually one effort, not many.
- Treat any keyword or pattern based count as a floor, not a fact: it over-matches unrelated items and
  misses ones that never used your words. Run it again with different terms, read the hits, and tell
  me your confidence instead of presenting it as exact. Dedupe wherever duplicates are possible.
- Bound "open" and "in flight" counts to the window. A year-old open item is not part of this project.

## Pass 2 — structure it as a journey
Restructure into clearly separated compartments that read step-by-step, each leading into the next:
where we started → what we chose and why → how it went → what it cost → where it landed → what is
still open. Number the sections.
The closing beat is the one leads act on: name an owner and a next action for each open item, say
what you need from them, and give one sentence on what we would do differently next time.
If the window genuinely covers several independent threads, do not force them into one story — give
each its own compressed journey (start → why → outcome). If three threads at three sections each
would breach the cap, fold each thread's "why" into its "start". Past three threads, group the
smallest into a single "other work" section rather than raising the cap. The closing beat still
applies, as one shared section across all threads.
Each section has ONE job. Headings and body must be clearly distinct: the heading carries the meaning,
the body carries the detail.

## Pass 3 — presentation, then build
- Bold at most one phrase per section — the single fact a skimmer must not miss.
- Add a chart only where it makes a step easier to understand at a glance. A chart that restates a
  sentence is noise — delete it. Draw them as inline SVG from the Pass 1 numbers (external scripts
  and CDNs are blocked). State each chart's axis max and plotted values in a comment beside the SVG,
  so they can be checked without reverse-engineering path coordinates.
- Everything else about the look is yours to decide — palette included. I am not giving you colours.
  Keep figures in a monospaced face with tabular-nums. No gradient header banners, no emoji section
  icons, no card-with-shadow stat grids.
- Theme-aware: tokens on `:root`, redefined under `@media (prefers-color-scheme: dark)` AND under
  `:root[data-theme="dark"]` / `[data-theme="light"]`, so the viewer's toggle wins both ways. Style
  through tokens only. Self-contained: no external fonts, scripts or images.

Now consolidate the whole spec — numbers table, section list, palette decision, cut list, and the
depth contract and presentation rules above verbatim — into one execution prompt and hand it to a
subagent to build the page, so the build runs against a complete spec instead of a chat history. If
subagents are not available here, build it directly; do not narrate a handoff that did not happen.

## Pass 4 — review loop
Review the built page against this prompt, fix what fails, repeat. Stop when two consecutive passes
find nothing, or after three iterations. Report what each pass found, including "nothing". Check:
- word and section counts are inside the cap — state the method you counted with, not just the number
- every MEASURED number traces to its command; every REPORTED fact traces to its source
- nothing that only proves effort; each section has one job; headings distinct from body
- every open item has an owner and a next action
- each chart's plotted coordinates match its stated numbers
- both themes render: grep the stylesheet for any colour value that is not a `var(--token)` — every
  hit is a theme-toggle bug

## Output
Publish as an artifact and give me the link, plus the word count and the cut list.
```

---

## Follow-ups

- **Still bloated:** "You are over the cap. Cut to ~1,000 words, show me the count and what you removed."
- **Too thin somewhere:** "Section << N >> is the one leads will ask about. Spend words there and take
  them from elsewhere — the cap does not move."
- **Numbers look wrong:** "Re-measure << metric >> a second, different way and reconcile. If they
  disagree, tell me which is wrong and why."
- **Companion page for engineers:** "Now build a detail page for engineers: every item that moved,
  where it went, searchable. Regenerate the dataset from source rather than hand-writing it, and state
  the detection threshold as a floor — anything rewritten past it shows as a deletion, say so on the page."
- **Republishing later:** pass the existing artifact `url`, keep the same icon and description, and
  re-read the live page first — otherwise you mint a new URL and the shared link goes stale.
