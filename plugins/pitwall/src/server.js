import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.js';
import { openDb } from './db.js';
import { createEmbedder, createReranker } from './embeddings.js';
import { createIndexer } from './indexer.js';
import { createVectorCache, createSearcher } from './search.js';
import { SCAFFOLD_DIR } from './scaffold.js';
import { registerFileTools } from './tools-files.js';
import { registerKnowledgeTools } from './tools-knowledge.js';
import { registerReviewTools } from './tools-review.js';

const INSTRUCTIONS = 'Pitwall: knowledge base over a folder of notes, indexed automatically. '
  + 'recall (compact=true for one line per hit) or semantic_search first; hits give path:lines, then read_file with offset/limit. '
  + 'related_knowledge follows tickets, identifiers and links. search_in_files is exact text. add_note and bookmark_url save Markdown. '
  + 'Projects live in projects/<slug>/project.yml (link_project); link_resource attaches URLs to a project or ticket. review_* tools keep a review ledger.';

/** The state every session shares: config, db, indexer, models. Exits with a message on bad config. */
export function buildShared() {
  let cfg;
  try { cfg = loadConfig(); if (cfg.notice) console.error(`pitwall: ${cfg.notice}`); } catch (e) { console.error(`pitwall: ${e.message}`); process.exit(1); }
  const embedder = createEmbedder(cfg.embedModel);
  const reranker = createReranker();
  const db = openDb({ base: cfg.base, dbPath: cfg.dbPath, embedModel: cfg.embedModel });
  const indexer = createIndexer({ db, base: cfg.base, embedDocs: embedder.embedDocs });
  const cache = createVectorCache(db);
  const searcher = createSearcher({ db, cache, embedQuery: embedder.embedQuery, rerankScore: reranker.score, graph: cfg.graph });
  return { scaffoldDir: SCAFFOLD_DIR, base: cfg.base, cfg, db, indexer, searcher, cache, embedder };
}

/** A new MCP server over the shared state. `projectDir` is the session's explicit working dir, if any. */
export function createSessionServer(shared, { projectDir: explicit } = {}) {
  const server = new McpServer({ name: 'pitwall', version: '5.0.0' }, { instructions: INSTRUCTIONS });
  let projectDir = explicit;
  const ctx = {
    ...shared,
    /** Session working dir: the explicit value, the first MCP root, then cwd. */
    async projectDir() {
      if (projectDir) return projectDir;
      if (server.server.getClientCapabilities()?.roots) {
        try {
          const { roots } = await server.server.listRoots();
          if (roots[0]?.uri.startsWith('file:')) projectDir = fileURLToPath(roots[0].uri);
        } catch { /* client refused */ }
      }
      return (projectDir ||= process.cwd());
    },
  };
  registerFileTools(server, ctx);
  registerKnowledgeTools(server, ctx);
  registerReviewTools(server, ctx);
  return server;
}
