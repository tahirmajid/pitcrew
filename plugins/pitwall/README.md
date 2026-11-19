# pitwall

A local, Markdown-first knowledge base for agents, served over MCP. The folder of notes is the source of truth; a SQLite index in `.pitwall/` is a rebuildable cache. Search is hybrid (BM25 + vectors), notes link to projects and to tickets, threads, docs and PRs, and a review ledger records code reviews.

The plugin bundles the `kb` MCP server, a `SessionStart` hook that tells the agent to recall before answering from memory, and two skills: `pitwall` (how to use the knowledge base) and `orchestrate` (tier-graded project driving on top of the starter playbooks).

## Install

```
claude plugin marketplace add tahirmajid/pitcrew
claude plugin install pitwall@pitcrew
```

Claude Code asks for the **Knowledge base folder**. Pick any folder, empty or not. For an empty one, ask the agent to run `init_kb` once to copy the starter layout.

**Requirements:** Node >= 22.13 (`node:sqlite`). The first start downloads a ~35 MB embedding model and builds the index in the background; later starts only re-read files that changed.

## Knowledge-base layout

```
projects/<slug>/   one folder per project, with project.yml (tier, repos, resources)
reference/         stable facts
playbooks/         the reusable process layer (tiers, roles, schemas, templates)
inbox/             quick notes and bookmarks
archive/           closed work
.pitwall/          index cache and the ignore file
```

`projects/<slug>/project.yml` is the project registry. Its keys: `name`, `tier` (`adhoc|small|medium|large`), `status` (`active|paused|closed`), `repos`, `subdirs`, `folders` (extra knowledge-base folders) and `resources` (`{url, kind, title, note, ticket}` items). Other keys and comments are kept when the server rewrites the file. Several projects can share one repo, and git worktrees resolve to the main repo.

`.pitwall/ignore` lists folders (`private/`) or extensions (`*.json`) to skip. Text files (`.md .txt .json .js .ts .py .yaml .yml .sql .kt .sh .toml`, up to 1 MB) are indexed.

## Tools

Tool names in Claude Code are `mcp__plugin_pitwall_kb__<tool>`.

- **Files:** `list_directory read_file read_multiple_files write_file append_file edit_file create_directory delete_file move_file file_info search_files search_in_files`. Writes re-index the touched file.
- **Search and knowledge:** `recall semantic_search related_knowledge add_note bookmark_url ingest_document list_knowledge forget_knowledge reindex init_kb`. Search takes `scope`, `project`, `type`, `path`, `tags`, `expand` and `explain`.
- **Projects:** `link_project unlink_project list_projects`.
- **Resources:** `link_resource unlink_resource list_resources`. These store links to tickets, threads, docs and PRs. The server never fetches a URL.
- **Review ledger:** `review_start review_submit_findings review_disposition review_decide review_status review_list review_delete review_codex_run`. `review_codex_run` shells out to the Codex CLI and is the only tool that leaves the machine.

## How search works

Files are split into Markdown-aware chunks: headings define the boundaries, code fences and tables stay whole, and each chunk carries a 1-based line range. A query runs BM25 and vector search over the chunks, and reciprocal-rank fusion (RRF) merges the lists. Notes in the current project's folders are boosted. Optional graph expansion adds notes that share rare entities (ticket ids, PR refs, identifiers, tags, links) with the top hits. Optional cross-encoder rerank reorders the top 15. Hits print as `path:start-end` followed by the best-matching lines, so an agent can read just that section.

To measure search quality on your own notes, see `scripts/eval.js`.

## Configuration

The plugin sets `PITWALL_BASE_DIR` and `PITWALL_PROJECT_DIR` itself. The `SessionStart` hook reads the folder from `CLAUDE_PLUGIN_OPTION_KB_DIR`, which Claude Code sets from the same setting.

| Variable | Meaning | Default |
|---|---|---|
| `PITWALL_BASE_DIR` | Knowledge-base folder (required) | none |
| `PITWALL_DB_PATH` | Index and review database | `<base>/.pitwall/index.db` |
| `PITWALL_EMBED_MODEL` | `Xenova/bge-small-en-v1.5`, `Xenova/all-MiniLM-L6-v2` or `Snowflake/snowflake-arctic-embed-s` | bge-small |
| `PITWALL_RERANK` | `1` enables cross-encoder rerank | `0` |
| `PITWALL_GRAPH` | `1` or `0`: graph expansion on by default | see `src/config.js` |
| `PITWALL_PROJECT_DIR` | Session working directory for project matching | `CLAUDE_PROJECT_DIR`, then the first MCP root, then cwd |

An unset, empty or unexpanded value for `PITWALL_BASE_DIR` makes the server print how to configure the folder and exit. If an older `<base>/knowledge.db` exists and `.pitwall/index.db` does not, it is opened in place so an existing review ledger keeps working. Changing the model or the chunker rebuilds the index.

## Shared server

By default every session starts its own pitwall process, which loads its own embedding model. To run one process for all sessions, start a daemon and point sessions at it.

| Variable | Meaning |
|---|---|
| `PITWALL_HTTP_PORT` | Serve MCP over HTTP on `127.0.0.1:<port>/mcp` instead of stdio. Loopback only; requests with a foreign `Host` or `Origin` are rejected. |
| `PITWALL_URL` | Run as a thin stdio proxy to that daemon URL (the plugin option `server_url`). Sends the session's project dir to it. If the daemon is unreachable, it prints a notice and runs in-process. |

```
PITWALL_BASE_DIR=/path/to/notes PITWALL_HTTP_PORT=8765 node /path/to/pitwall/src/index.js
```

The daemon exposes the file-write tools to anything that can reach the port, so keep it on loopback. A macOS launchd job at `~/Library/LaunchAgents/com.example.pitwall.plist` keeps it running:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.example.pitwall</string>
  <key>ProgramArguments</key><array>
    <string>/path/to/node</string><string>/path/to/pitwall/src/index.js</string>
  </array>
  <key>EnvironmentVariables</key><dict>
    <key>PITWALL_BASE_DIR</key><string>/path/to/notes</string>
    <key>PITWALL_HTTP_PORT</key><string>8765</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
</dict></plist>
```

Load it with `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.example.pitwall.plist`.

## Privacy

Everything runs on your machine: notes, index, embedding model and search. The model is downloaded once. The only tool that sends anything out is `review_codex_run`, through the Codex CLI you have installed. The index lives in `.pitwall/`; `init_kb` adds a `.gitignore` there so it is not committed if the folder is a git repo.

## Tests

```
npm ci --ignore-scripts
npm test
```

## Outside Claude Code

Any MCP client can run the server with plain env vars:

```json
{
  "mcpServers": {
    "pitwall": {
      "command": "node",
      "args": ["/path/to/pitwall/src/index.js"],
      "env": { "PITWALL_BASE_DIR": "/path/to/notes" }
    }
  }
}
```

Run `npm ci --ignore-scripts` in the plugin folder first. `node scripts/index.js [--rebuild]` indexes from the command line.
