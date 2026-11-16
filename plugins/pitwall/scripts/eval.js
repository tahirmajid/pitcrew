#!/usr/bin/env node
// Usage: PITWALL_BASE_DIR=... [PITWALL_DB_PATH=...] node scripts/eval.js --gold gold.json [--rerank 0|1] [--graph 0|1] [--gw <weight>] [--json]
// Gold entries: {id, query, style, expects_source_paths[]}. Index first with scripts/index.js.
import fs from 'node:fs';
import { loadConfig } from '../src/config.js';
import { openDb } from '../src/db.js';
import { createEmbedder, createReranker } from '../src/embeddings.js';
import { createVectorCache, createSearcher } from '../src/search.js';

const arg = n => { const i = process.argv.indexOf(`--${n}`); return i < 0 ? undefined : process.argv[i + 1]; };
const goldFile = arg('gold');
if (!goldFile) { console.error('usage: node scripts/eval.js --gold <file> [--rerank 0|1] [--graph 0|1] [--gw <weight>] [--json]'); process.exit(1); }
const cfg = loadConfig();
const rerank = (arg('rerank') ?? (cfg.rerank ? '1' : '0')) === '1';
const graph = (arg('graph') ?? (cfg.graph ? '1' : '0')) === '1';
const gold = JSON.parse(fs.readFileSync(goldFile, 'utf8')).filter(g => g.expects_source_paths?.length);

const db = openDb({ base: cfg.base, dbPath: cfg.dbPath, embedModel: cfg.embedModel });
const embedder = createEmbedder(cfg.embedModel);
const reranker = createReranker();
const searcher = createSearcher({ db, cache: createVectorCache(db), embedQuery: embedder.embedQuery, rerankScore: reranker.score, graph, ...(arg('gw') ? { graphWeight: Number(arg('gw')) } : {}) });

const t0 = performance.now();
const lat = [];
const rows = [];
let coldMs = 0;
for (const g of gold) {
  const s = performance.now();
  const hits = await searcher.search(g.query, { limit: 10, rerank, expand: graph });
  const ms = performance.now() - s;
  if (!rows.length) coldMs = performance.now() - t0; else lat.push(ms);
  const docs = [...new Set(hits.map(h => h.path))];
  const rank = docs.findIndex(p => g.expects_source_paths.includes(p)) + 1;
  rows.push({ style: g.style || 'all', rank });
}
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : 0; };
const at = (rs, k) => rs.filter(r => r.rank > 0 && r.rank <= k).length / (rs.length || 1);
const styles = {};
for (const r of rows) (styles[r.style] ??= []).push(r);
const out = {
  queries: rows.length, rerank, graph, model: cfg.embedModel,
  recall1: at(rows, 1), recall3: at(rows, 3), recall5: at(rows, 5), recall10: at(rows, 10),
  mrr: rows.reduce((s, r) => s + (r.rank ? 1 / r.rank : 0), 0) / rows.length,
  p50_ms: Math.round(pct(lat, 0.5)), p95_ms: Math.round(pct(lat, 0.95)), cold_start_ms: Math.round(coldMs),
  recall5_by_style: Object.fromEntries(Object.entries(styles).map(([k, v]) => [k, Number(at(v, 5).toFixed(3))])),
};
if (process.argv.includes('--json')) console.log(JSON.stringify(out));
else {
  const f = x => `${(x * 100).toFixed(1)}%`;
  console.log(`${out.model} rerank=${rerank ? 1 : 0} graph=${graph ? 1 : 0} n=${out.queries}`);
  console.log(`recall@1 ${f(out.recall1)}  @3 ${f(out.recall3)}  @5 ${f(out.recall5)}  @10 ${f(out.recall10)}  MRR ${out.mrr.toFixed(3)}`);
  console.log(`latency p50 ${out.p50_ms} ms  p95 ${out.p95_ms} ms  cold start ${out.cold_start_ms} ms`);
  console.log(`recall@5 by style: ${Object.entries(out.recall5_by_style).map(([k, v]) => `${k} ${f(v)}`).join(', ')}`);
}
