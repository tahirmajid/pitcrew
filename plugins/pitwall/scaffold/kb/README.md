---
title: Knowledge base
type: readme
---

# Knowledge base

This folder is the knowledge base root: the folder the pitwall `kb` MCP server is configured with.
Everything under it is indexed automatically, except paths matched by `.pitwall/ignore`. Canonical file
names and frontmatter are in `playbooks/CONVENTIONS.md` and `playbooks/schemas/frontmatter.md`.

```
projects/<slug>/   one folder per project (shape depends on tier)
reference/         stable facts: schemas, domain docs, gotchas
playbooks/         the reusable process layer
inbox/             quick notes and bookmarks
archive/           closed projects and phases
.pitwall/          index cache and config (ignore file)
```

## projects/

One folder per piece of work you are actively running, named by its kebab-case slug. Each holds a
`project.yml` (tier, repos, commands, linked resources) plus whatever its tier needs: a checklist
for small work, a tracker and status board for a feature, waves and a resume snapshot for a large
program. The project registry is these files: `projects/<slug>/project.yml` is the single source for which
repos a project covers, and its `resources:` list holds the linked tickets, threads, docs and PRs.
Create one with `/orchestrate init <slug> --tier <tier>` or the `link_project` tool.

## reference/

Facts that outlive any one project: data schemas, domain explanations, API notes, known gotchas.
Write here when something is true regardless of what you are currently working on, so the next
project finds it instead of rediscovering it.

## playbooks/

The process layer: the tier ladder, role playbooks, schemas, templates, the global anti-patterns
list and the adversarial review workflow. Projects reference it; they never copy it. Start with
`playbooks/README.md`.

## inbox/

The low-friction drop zone for quick notes, links and half-formed ideas. Triage it now and then:
move each note into a project, into `reference/`, or delete it.

## archive/

Closed projects and finished phases, moved here whole so they stay searchable without cluttering the
active list. Set `status: closed` in the project's `project.yml` before moving it.

## .pitwall/

Index configuration. `.pitwall/ignore` lists gitignore-style patterns the indexer skips; by default it
excludes generated output (`runs/`, `logs/`, `*.log`), caches and archives.
