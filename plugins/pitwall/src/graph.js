const TICKET = /\b[A-Z][A-Z0-9]{1,9}-\d+\b/g;
const CAMEL = /\b[A-Za-z][a-z0-9]*(?:[A-Z][a-z0-9]+){1,}\b/g;
const SNAKE = /\b[A-Za-z][A-Za-z0-9]*(?:_[A-Za-z0-9]+)+\b/g;
const DOTTED = /\b[A-Za-z_]\w+(?:\.[A-Za-z_]\w+)+\b/g;
const FILE = /\b[\w-]+\.(?:md|kt|kts|js|mjs|ts|py|json|ya?ml|sql|sh|toml|txt|gradle|java|xml)\b/g;
const FILE_ONE = /^[\w-]+\.(?:md|kt|kts|js|mjs|ts|py|json|ya?ml|sql|sh|toml|txt|gradle|java|xml)$/;
const URL_RE = /https?:\/\/[^\s)>\]"']+/g;
const PR_URL = /(?:github\.com\/[^/\s]+\/[^/\s]+\/pull|gitlab\.[^/\s]+\/.+?\/-\/merge_requests)\/(\d+)/;
const TLD = /^(com|org|net|io|co|dev|app|ai)$/;
export const MAX_ENTITIES = 200;

/**
 * Extracts graph entities from a doc as Map("kind\0name" -> {kind, name, count}), capped at MAX_ENTITIES
 * (tickets, PRs, tags and links first, then code identifiers by frequency).
 * `urlTickets` maps a linked-resource URL to its ticket id.
 */
export function extractEntities(text, { tags = [], links = [], urlTickets = null } = {}) {
  const out = new Map();
  const add = (kind, name, n = 1) => {
    const k = `${kind}\0${name}`;
    const e = out.get(k);
    if (e) e.count += n; else out.set(k, { kind, name, count: n });
  };
  const urls = text.match(URL_RE) || [];
  for (const u of urls) {
    const pr = u.match(PR_URL);
    if (pr) add('pr', `#${pr[1]}`);
    const t = urlTickets?.get(u.replace(/[.,;]+$/, ''));
    if (t) add('ticket', t);
  }
  const prose = text.replace(URL_RE, ' ');
  for (const m of prose.matchAll(TICKET)) add('ticket', m[0]);
  for (const m of prose.matchAll(/(?<![\w&/])#(\d{2,})\b/g)) add('pr', `#${m[1]}`);
  for (const t of tags) add('tag', t);
  for (const l of links) add('link', l);
  const rest = [...out.values()];
  const code = new Map();
  const bump = n => code.set(n, (code.get(n) || 0) + 1);
  for (const m of prose.matchAll(CAMEL)) if (m[0].split(/(?=[A-Z])/).length >= 2 && /[a-z]/.test(m[0]) && !/^[A-Z]{2,}$/.test(m[0])) bump(m[0]);
  for (const m of prose.matchAll(SNAKE)) bump(m[0]);
  for (const m of prose.matchAll(FILE)) bump(m[0]);
  for (const m of prose.matchAll(DOTTED)) {
    const last = m[0].split('.').pop();
    if (!TLD.test(last) && !FILE_ONE.test(m[0])) bump(m[0]);
  }
  const codeSorted = [...code].sort((a, b) => b[1] - a[1]).slice(0, Math.max(0, MAX_ENTITIES - rest.length));
  const res = new Map();
  for (const e of rest.slice(0, MAX_ENTITIES)) res.set(`${e.kind}\0${e.name}`, e);
  for (const [name, count] of codeSorted) res.set(`code\0${name}`, { kind: 'code', name, count });
  return res;
}

const COMMON_FLOOR = 5;
const LINK_BONUS = 1;
const DIRECT = 2;
export const SEEDS = 10;
export const CANDIDATES = 30;

/** Builds the in-memory entity graph (names, per-doc and per-entity lists, link adjacency) from the DB. */
export function loadGraph(db, docs) {
  const names = new Map(), entDocs = new Map(), docEnts = new Map(), nameIdx = new Map();
  for (const e of db.prepare('SELECT id, kind, name FROM entities').all()) {
    names.set(e.id, e);
    (nameIdx.get(e.name) ?? nameIdx.set(e.name, []).get(e.name)).push(e.id);
  }
  for (const m of db.prepare('SELECT doc_id, entity_id, count FROM mentions').all()) {
    (entDocs.get(m.entity_id) ?? entDocs.set(m.entity_id, []).get(m.entity_id)).push([m.doc_id, m.count]);
    (docEnts.get(m.doc_id) ?? docEnts.set(m.doc_id, []).get(m.doc_id)).push(m.entity_id);
  }
  const byPath = new Map(), byBase = new Map();
  for (const [id, d] of docs) {
    byPath.set(d.path, id);
    const b = d.path.split('/').pop().replace(/\.[^.]+$/, '').toLowerCase();
    if (!byBase.has(b)) byBase.set(b, id);
  }
  const resolve = dst => byPath.get(dst) ?? byPath.get(`${dst}.md`) ?? byBase.get(dst.split('/').pop().replace(/\.[^.]+$/, '').toLowerCase());
  const out = new Map(), inn = new Map();
  const put = (m, a, b) => (m.get(a) ?? m.set(a, new Set()).get(a)).add(b);
  for (const l of db.prepare('SELECT src_doc, dst_path FROM links').all()) {
    const d = resolve(l.dst_path);
    if (d && d !== l.src_doc) { put(out, l.src_doc, d); put(inn, d, l.src_doc); }
  }
  const limit = Math.max(COMMON_FLOOR, 0.05 * docs.size);
  const n = docs.size;
  const usable = id => (entDocs.get(id)?.length ?? 0) <= limit;
  const idf = id => Math.log(1 + n / (entDocs.get(id)?.length || 1));
  return { names, entDocs, docEnts, nameIdx, out, inn, usable, idf, byPath };
}

/** Query entity ids: entity names that occur verbatim in the query. */
export function queryEntities(g, query) {
  const toks = new Set(query.split(/[\s,;:()"'`]+/).map(t => t.replace(/[.?!]+$/, '')).filter(Boolean));
  for (const e of extractEntities(query).values()) toks.add(e.name);
  return [...toks].flatMap(t => g.nameIdx.get(t) || []).filter(g.usable);
}

/** Ranked docs [{docId, score}] reachable from seed docs (weighted) through shared rare entities and links, plus verbatim query matches. */
export function graphRank(g, seeds, query, allowed) {
  const score = new Map();
  const bump = (d, v) => { if ((!allowed || allowed.has(d))) score.set(d, (score.get(d) || 0) + v); };
  for (const { docId, weight } of seeds) {
    for (const e of g.docEnts.get(docId) || []) {
      if (!g.usable(e)) continue;
      const w = g.idf(e) * weight;
      for (const [d] of g.entDocs.get(e)) if (d !== docId) bump(d, w);
    }
    for (const d of g.out.get(docId) || []) bump(d, LINK_BONUS * weight);
    for (const d of g.inn.get(docId) || []) bump(d, LINK_BONUS * weight);
  }
  for (const e of queryEntities(g, query)) for (const [d] of g.entDocs.get(e)) bump(d, DIRECT * g.idf(e));
  return [...score].map(([docId, s]) => ({ docId, score: s })).sort((a, b) => b.score - a.score).slice(0, CANDIDATES);
}

/** Why-related reasons between docs: shared rare entities (top 3 names) for each other doc, ranked. */
export function sharedWith(g, docId) {
  const shared = new Map();
  for (const e of g.docEnts.get(docId) || []) {
    if (!g.usable(e)) continue;
    for (const [d] of g.entDocs.get(e)) if (d !== docId) {
      const cur = shared.get(d) || { score: 0, names: [] };
      cur.score += g.idf(e); cur.names.push(g.names.get(e).name); shared.set(d, cur);
    }
  }
  return [...shared].map(([d, v]) => ({ docId: d, score: v.score, names: v.names })).sort((a, b) => b.score - a.score);
}
