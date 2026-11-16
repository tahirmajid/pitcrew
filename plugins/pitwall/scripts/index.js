#!/usr/bin/env node
// Indexes PITWALL_BASE_DIR into PITWALL_DB_PATH; pass --rebuild to wipe first.
import fs from 'node:fs';
import { loadConfig } from '../src/config.js';
import { openDb } from '../src/db.js';
import { createEmbedder } from '../src/embeddings.js';
import { createIndexer } from '../src/indexer.js';

const cfg = loadConfig();
const db = openDb({ base: cfg.base, dbPath: cfg.dbPath, embedModel: cfg.embedModel });
const embedder = createEmbedder(cfg.embedModel);
const t0 = Date.now();
const indexer = createIndexer({ db, base: cfg.base, embedDocs: embedder.embedDocs, onProgress: p => console.log(`  ${p.indexed}/${p.total} files`) });
const r = process.argv.includes('--rebuild') ? await indexer.rebuild() : await indexer.reconcile();
const n = db.prepare('SELECT COUNT(*) AS docs, (SELECT COUNT(*) FROM chunks) AS chunks, (SELECT COUNT(*) FROM entities) AS entities, (SELECT COUNT(*) FROM mentions) AS mentions FROM docs').get();
console.log(`indexed ${r.indexed}, removed ${r.removed}, unchanged ${r.unchanged}`);
console.log(`docs ${n.docs}, chunks ${n.chunks}, entities ${n.entities}, mentions ${n.mentions}, db ${(fs.statSync(cfg.dbPath).size / 1048576).toFixed(1)} MB, ${((Date.now() - t0) / 1000).toFixed(1)} s`);
