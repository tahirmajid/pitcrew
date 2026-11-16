import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEmbedder } from '../src/embeddings.js';
import { openDb } from '../src/db.js';
import { createIndexer } from '../src/indexer.js';
import { createVectorCache, createSearcher } from '../src/search.js';

export const MODEL = 'Xenova/bge-small-en-v1.5';
export const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'kb');
export const embedder = createEmbedder(MODEL);

/** Fresh temp dir. */
export const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'pitwall-test-'));

/** Temp base, optionally seeded with the fixture KB, plus an open db, indexer and searcher. */
export function setup({ fixture = false, files = {} } = {}) {
  const base = fs.realpathSync(tmp());
  if (fixture) fs.cpSync(FIXTURE, base, { recursive: true });
  for (const [p, c] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(base, p)), { recursive: true }); fs.writeFileSync(path.join(base, p), c); }
  const dbPath = path.join(tmp(), 'k.db');
  const db = openDb({ base, dbPath, embedModel: MODEL });
  const indexer = createIndexer({ db, base, embedDocs: embedder.embedDocs });
  const cache = createVectorCache(db);
  const searcher = createSearcher({ db, cache, embedQuery: embedder.embedQuery });
  return { base, dbPath, db, indexer, cache, searcher };
}
