---
name: pitwall
description: How to use the pitwall knowledge base MCP server (tools mcp__plugin_pitwall_kb__*). Use before answering from memory about a project, ticket, decision or past work; when saving notes, bookmarks or links to tickets, threads, docs and PRs; when linking a repo to a project; or when setting up a new knowledge-base folder.
---

# pitwall

The `kb` MCP server serves a folder of Markdown notes (the knowledge base). The folder is the source
of truth; the index in `.pitwall/` is a rebuildable cache. All tools are `mcp__plugin_pitwall_kb__<tool>`.

## Recall first

Before answering from memory about a project, ticket, decision or earlier session, search:

- `recall` for questions and topics; `semantic_search` for a specific phrase or concept.
- Narrow with `scope` (`auto` boosts the current project's folders, `project` keeps only them, `all`
  searches everything), `project` (a named project), `type` (note frontmatter `type`), `path`
  (folder prefix) and `tags`.
- `expand: true` adds graph neighbours: notes that share a rare ticket id, identifier or link with
  the top hits. Use it when plain search misses the thread.
- Hits print as `path:start-end`. Read just that section with `read_file` using `offset` and `limit`
  instead of the whole file.
- A `Linked resources:` block after the hits lists tickets, threads, docs and PRs tied to the query.

`related_knowledge` takes a `topic`, `path` or `entity` (for example a ticket id) and returns
neighbours with the reason: shared entities, links either way, or similarity.

## Capture

- `add_note` for a durable fact, decision or lesson: it lands in `inbox/`, or in the project's
  `notes/` when `project` is given.
- `bookmark_url` for a page worth keeping.
- `write_file`, `append_file`, `edit_file`, `move_file` and `delete_file` edit the folder directly.
  Indexing is automatic; there is nothing to refresh. `reindex` only rebuilds on demand.
- `forget_knowledge` removes a note from the index and adds it to `.pitwall/ignore`; the file stays.

Put stable facts in `reference/`, process in `playbooks/`, quick captures in `inbox/`, finished work
in `archive/`. File names and frontmatter follow `playbooks/CONVENTIONS.md` and
`playbooks/schemas/frontmatter.md`.

## Projects

A project is `projects/<slug>/project.yml`. It records `tier` (`adhoc`, `small`, `medium`, `large`),
`status` (`active`, `paused`, `closed`), `repos`, `subdirs` and extra `folders`.

- `link_project` creates or merges a project: tie a repo (and optional subdirs) to it so sessions
  in that repo get its notes boosted. Several projects can share one repo; subdirs tell them apart.
- `unlink_project` removes links only; it never deletes a folder.
- `list_projects` shows each project, its tier, status, repos and resource count, and marks the
  ones matching the current session.

Closed projects are not auto-boosted but can still be named with `project:`.

## Resources

`link_resource` records a URL for a ticket, thread, doc or PR: `url` plus a `project` or a `ticket`
(at least one), and optional `title`, `note` and `kind`. The kind is inferred from the URL when
omitted. With a project the link goes in that project's `project.yml` under `resources:`; with only a
ticket it goes in `.pitwall/resources.yml`. Linking the same URL again updates it.

The server stores links and never fetches them. Open a link with the matching tool for that system.
`list_resources` and `unlink_resource` read and remove them.

## New folder

`init_kb` copies the starter layout (`projects/`, `reference/`, `playbooks/`, `inbox/`, `archive/`)
into an empty knowledge-base folder without overwriting existing files, and reports created and
skipped counts. Run it once, then start a project with `link_project` or `/pitwall:orchestrate init`.

## Review ledger

`review_start`, `review_submit_findings`, `review_disposition`, `review_decide`, `review_status`,
`review_list` and `review_delete` keep a record of a code review and what was done with each finding.
`review_codex_run` runs the Codex CLI on a diff; it is the only tool that sends anything off the
machine, so call it only when asked.
