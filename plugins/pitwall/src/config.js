import fs from 'node:fs';
import path from 'node:path';

export const DEFAULT_GRAPH = false;

const NOT_CONFIGURED = 'knowledge base folder is not configured: set the plugin option kb_dir (or the PITWALL_BASE_DIR environment variable) to the folder that holds your notes';

/** Reads and validates the PITWALL_* environment; throws a readable Error on bad input. */
export function loadConfig(env = process.env) {
  const val = k => { const v = env[k] ?? ''; return v.trim() && !/^\$\{.*\}$/.test(v.trim()) ? v : undefined; };
  if (!val('PITWALL_BASE_DIR')) throw new Error(NOT_CONFIGURED);
  const base = path.resolve(val('PITWALL_BASE_DIR'));
  if (!fs.existsSync(base) || !fs.statSync(base).isDirectory()) throw new Error(`PITWALL_BASE_DIR does not exist or is not a directory: ${base}`);
  let dbPath = val('PITWALL_DB_PATH'), notice = null;
  if (!dbPath) {
    dbPath = path.join(base, '.pitwall', 'index.db');
    const legacy = path.join(base, 'knowledge.db');
    if (!fs.existsSync(dbPath) && fs.existsSync(legacy)) { dbPath = legacy; notice = `using existing ${legacy} in place (its review ledger is kept)`; }
  }
  return {
    base, dbPath, notice,
    embedModel: val('PITWALL_EMBED_MODEL') || 'Xenova/bge-small-en-v1.5',
    rerank: (val('PITWALL_RERANK') ?? '0') === '1',
    graph: val('PITWALL_GRAPH') === undefined ? DEFAULT_GRAPH : val('PITWALL_GRAPH') === '1',
    projectDir: val('PITWALL_PROJECT_DIR') || null,
  };
}
