import { createHash } from 'node:crypto';
import { blobToVec, BM25_WEIGHTS } from './db.js';
import { loadGraph, graphRank, SEEDS } from './graph.js';

const TOP = 30;
const RRF_K = 60;
const RERANK_TOP = 15;
const FETCH = 45;
const BOOST = 1.25;
export const GRAPH_WEIGHT = 0.25;

/** Builds a safe FTS5 MATCH string: each term a quoted phrase, OR-joined; null when nothing usable. */
export function buildMatch(query) {
  const terms = String(query ?? '').split(/\s+/)
    .filter(t => /[\p{L}\p{N}]/u.test(t) && !/^(AND|OR|NOT|NEAR)$/.test(t))
    .map(t => `"${t.replace(/"/g, '""')}"`);
  return terms.length ? terms.join(' OR ') : null;
}

/** True when the query has a token that looks like an identifier (digits, snake/kebab/Camel/dotted names). */
export function looksLikeIdentifier(query) {
  return String(query ?? '').split(/\s+/).some(t =>
    /\d/.test(t) || t.includes('_') || /[A-Za-z0-9]-[A-Za-z0-9]/.test(t) || /[a-z][A-Z]/.test(t) || /[A-Za-z]\w*\.[A-Za-z]\w+/.test(t));
}

/** Loads every chunk vector into one contiguous array; reloads when the DB changed (other connections or own writes). */
export function createVectorCache(db) {
  let stamp = null;
  let data = null;
  const key = () => `${db.prepare('PRAGMA data_version').get().data_version}:${db.prepare('SELECT total_changes() AS n').get().n}`;
  return {
    /** Returns {n, dim, ids, docIds, vecs, docs: Map(id -> {path,title,tags}), docMeans()} for the current DB state. */
    get() {
      const k = key();
      if (data && k === stamp) return data;
      const all = db.prepare('SELECT id, doc_id, embedding FROM chunks ORDER BY id').all();
      const dim = all.length ? all[0].embedding.byteLength / 4 : 0;
      const rows = all.filter(r => r.embedding.byteLength === dim * 4);
      const ids = new Int32Array(rows.length), docIds = new Int32Array(rows.length), vecs = new Float32Array(rows.length * dim);
      rows.forEach((r, i) => { ids[i] = r.id; docIds[i] = r.doc_id; vecs.set(blobToVec(r.embedding), i * dim); });
      const docs = new Map(db.prepare('SELECT id, path, title, tags, type, project, status FROM docs').all()
        .map(d => [d.id, { path: d.path, title: d.title, tags: JSON.parse(d.tags || '[]'), type: d.type, project: d.project, status: d.status }]));
      let means = null, graph = null, chunksOf = null, chunkDoc = null;
      data = {
        docOf(id) { return (chunkDoc ??= new Map(Array.from(ids, (x, i) => [x, docIds[i]]))).get(id); },
        graph() { return (graph ??= loadGraph(db, docs)); },
        chunksOf() {
          if (!chunksOf) { chunksOf = new Map(); for (let i = 0; i < ids.length; i++) (chunksOf.get(docIds[i]) ?? chunksOf.set(docIds[i], []).get(docIds[i])).push(i); }
          return chunksOf;
        },
        n: rows.length, dim, ids, docIds, vecs, docs,
        docMeans() {
          if (means) return means;
          means = new Map();
          for (let i = 0; i < ids.length; i++) {
            let m = means.get(docIds[i]);
            if (!m) means.set(docIds[i], m = new Float32Array(dim));
            for (let j = 0; j < dim; j++) m[j] += vecs[i * dim + j];
          }
          for (const m of means.values()) { let n = 0; for (const x of m) n += x * x; n = Math.sqrt(n) || 1; for (let j = 0; j < dim; j++) m[j] /= n; }
          return means;
        },
      };
      stamp = k;
      return data;
    },
  };
}

/** Top-k (index, score) by dot product against `q`, optionally limited to docs in `allowed`. */
export function topVectors(c, q, k = TOP, allowed = null) {
  const top = [];
  if (!c.n || q.length !== c.dim) return top;
  let min = -Infinity;
  for (let i = 0; i < c.n; i++) {
    if (allowed && !allowed.has(c.docIds[i])) continue;
    let s = 0;
    const o = i * c.dim;
    for (let j = 0; j < c.dim; j++) s += q[j] * c.vecs[o + j];
    if (top.length < k || s > min) {
      top.push({ id: c.ids[i], score: s });
      top.sort((a, b) => b.score - a.score);
      if (top.length > k) top.pop();
      min = top[top.length - 1].score;
    }
  }
  return top;
}

/** Picks the line window (within `cap` chars) holding the most distinct query terms. */
export function makeSnippet(text, firstLine, terms, cap) {
  const lines = text.split('\n');
  const total = text.length;
  if (total <= cap) return { snippet: text, startLine: firstLine, endLine: firstLine + lines.length - 1 };
  const low = lines.map(l => l.toLowerCase());
  let best = { score: -1, s: 0, e: 0 };
  for (let s = 0; s < lines.length; s++) {
    let e = s, len = lines[s].length;
    while (e + 1 < lines.length && len + lines[e + 1].length + 1 <= cap) { e++; len += lines[e].length + 1; }
    const win = low.slice(s, e + 1).join('\n');
    const score = terms.reduce((n, t) => n + (win.includes(t) ? 1 : 0), 0);
    if (score > best.score) best = { score, s, e };
  }
  let snippet = lines.slice(best.s, best.e + 1).join('\n');
  if (snippet.length > cap) snippet = `${snippet.slice(0, cap)}…`;
  return { snippet, startLine: firstLine + best.s, endLine: firstLine + best.e };
}

const queryTerms = q => [...new Set((q.toLowerCase().match(/[\p{L}\p{N}_]{2,}/gu) || []))];

/** Creates the hybrid searcher; `embedQuery` and `rerankScore(query, passages)` are injected. */
export function createSearcher({ db, cache, embedQuery, rerankScore, graph = false, graphWeight = GRAPH_WEIGHT }) {
  function allowedDocs(c, { tags, pathPrefix, filterFolders, type }) {
    if (!tags?.length && !pathPrefix && !filterFolders && !type) return null;
    const prefixes = (pathPrefix ? [pathPrefix] : []).map(p => (p.endsWith('/') ? p : `${p}/`));
    const want = tags?.map(t => t.toLowerCase());
    const out = new Set();
    for (const [id, d] of c.docs) {
      if (prefixes.length && !prefixes.some(p => d.path.startsWith(p) || `${d.path}/` === p)) continue;
      if (filterFolders && !filterFolders.some(f => d.path.startsWith(f))) continue;
      if (type && d.type !== type) continue;
      if (want?.length && !d.tags.some(t => want.includes(t.toLowerCase()))) continue;
      out.add(id);
    }
    return out;
  }

  function bm25(c, query, allowed) {
    const match = buildMatch(query);
    if (!match) return [];
    const w = BM25_WEIGHTS;
    const filter = allowed ? `AND rowid IN (SELECT id FROM chunks WHERE doc_id IN (${[...allowed].join(',') || 'NULL'}))` : '';
    try {
      return db.prepare(`SELECT rowid AS id, bm25(chunks_fts, ${w.title}, ${w.path}, ${w.heading}, ${w.body}) AS s
        FROM chunks_fts WHERE chunks_fts MATCH ? ${filter} ORDER BY s LIMIT ${TOP}`).all(match).map(r => ({ id: r.id, score: -r.s }));
    } catch { return []; }
  }

  return {
    /** Returns [{path, startLine, endLine, heading, title, score, snippet}] for a query. */
    async search(query, { limit = 10, tags, pathPrefix, filterFolders, boostFolders, rerank = false, compact = false, type, expand = graph } = {}) {
      const c = cache.get();
      if (!c.n) return [];
      const allowed = allowedDocs(c, { tags, pathPrefix, filterFolders, type });
      let vec = [];
      try { vec = topVectors(c, await embedQuery(query), TOP, allowed); } catch { /* BM25 only */ }
      const kw = bm25(c, query, allowed);

      const fused = new Map();
      const add = (list, w) => list.forEach((r, i) => fused.set(r.id, (fused.get(r.id) || 0) + w / (RRF_K + i + 1)));
      add(vec, 1);
      add(kw, looksLikeIdentifier(query) ? 2 : 1);
      if (expand && fused.size) {
        const best = new Map();
        for (const [id, sc] of fused) { const d = c.docOf(id); if (d !== undefined && sc > (best.get(d) ?? 0)) best.set(d, sc); }
        const top = [...best].sort((a, b) => b[1] - a[1]).slice(0, SEEDS);
        const seeds = top.map(([docId, sc]) => ({ docId, weight: sc / top[0][1] }));
        const g = c.graph();
        const chunksOf = c.chunksOf();
        const q = await embedQuery(query).catch(() => null);
        const list = graphRank(g, seeds, query, allowed).map(({ docId }) => {
          const idxs = chunksOf.get(docId) || [];
          let bi = idxs[0], bs = -Infinity;
          if (q && q.length === c.dim) for (const i of idxs) { let s2 = 0; for (let j = 0; j < c.dim; j++) s2 += q[j] * c.vecs[i * c.dim + j]; if (s2 > bs) { bs = s2; bi = i; } }
          return bi === undefined ? null : { id: c.ids[bi] };
        }).filter(Boolean);
        add(list, graphWeight);
      }

      const ids = [...fused.keys()];
      if (!ids.length) return [];
      const rows = new Map(db.prepare(`SELECT c.id, c.doc_id, c.heading, c.start_line, c.end_line, c.text, d.path, d.title
        FROM chunks c JOIN docs d ON d.id = c.doc_id WHERE c.id IN (${ids.join(',')})`).all().map(r => [r.id, r]));
      let ranked = ids.filter(id => rows.has(id) && (!allowed || allowed.has(rows.get(id).doc_id))).map(id => {
        const r = rows.get(id);
        const boost = boostFolders?.some(f => r.path.startsWith(f)) ? BOOST : 1;
        return { r, score: fused.get(id) * boost };
      }).sort((a, b) => b.score - a.score).slice(0, FETCH);

      if (rerank && rerankScore && ranked.length > 1) {
        const head = ranked.slice(0, RERANK_TOP);
        const s = await rerankScore(query, head.map(h => `${h.r.heading}\n${h.r.text}`.slice(0, 1200)));
        const lo = Math.min(...s), hi = Math.max(...s);
        const blended = head.map((h, i) => ({ ...h, score: 0.7 * (hi > lo ? (s[i] - lo) / (hi - lo) : 0.5) + 0.3 * (1 - i / head.length) + 1 }));
        ranked = [...blended.sort((a, b) => b.score - a.score), ...ranked.slice(RERANK_TOP)];
      }

      const terms = queryTerms(query);
      const seen = new Set(), perDoc = new Map(), out = [];
      for (const { r, score } of ranked) {
        const h = createHash('sha1').update(r.text).digest('hex');
        if (seen.has(h) || (perDoc.get(r.doc_id) || 0) >= 2) continue;
        seen.add(h);
        perDoc.set(r.doc_id, (perDoc.get(r.doc_id) || 0) + 1);
        const sn = makeSnippet(r.text, r.start_line, terms, compact ? 240 : 600);
        out.push({ path: r.path, startLine: sn.startLine, endLine: sn.endLine, heading: r.heading, title: r.title, score, snippet: sn.snippet });
        if (out.length >= limit) break;
      }
      return out;
    },
  };
}
