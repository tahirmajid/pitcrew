import fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { chunkText, parseFrontmatter, extractTitle, extractLinks, embedText } from './chunker.js';
import { tx, vecToBlob, removeDoc, pruneEntities, metaGet } from './db.js';
import { extractEntities } from './graph.js';
import { listResources } from './resources.js';
import { guard } from './guard.js';

export const SKIP_DIRS = new Set(['node_modules', '.git', '.venv', '__pycache__', '.gradle', '.idea', 'build', 'dist', '.cache', '.claude', '.pitwall']);
export const BINARY_EXT = new Set([
  '.db', '.sqlite', '.wal', '.shm', '.zip', '.gz', '.tgz', '.tar', '.7z', '.jar', '.apk', '.aab', '.class', '.so',
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.heic', '.pdf', '.mp4', '.mov', '.mp3', '.wav',
  '.onnx', '.bin', '.woff', '.woff2', '.ttf', '.ds_store',
]);
const INDEX_EXT = new Set(['.md', '.txt', '.json', '.js', '.ts', '.py', '.yaml', '.yml', '.sql', '.kt', '.sh', '.toml']);
const MAX_BYTES = 1_000_000;
const BATCH = 32;
const FLUSH_CHUNKS = 64;

export const isBinaryName = name => BINARY_EXT.has(path.extname(name).toLowerCase()) || name.toLowerCase() === '.ds_store';

/** Parses `.pitwall/ignore` into a matcher: gitignore-style `dir/`, `name`, `/anchored`, `a/b` (anchored) and `*.ext`. */
function parseIgnore(text) {
  const exts = [], rules = [];
  for (let line of text.split('\n')) {
    line = line.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('*.')) { exts.push(line.slice(1).toLowerCase()); continue; }
    const dirOnly = line.endsWith('/');
    const p = line.replace(/\/$/, '').replace(/^\.?\//, '');
    rules.push({ p, dirOnly, anchored: p !== line.replace(/\/$/, '') || p.includes('/') });
  }
  return rel => {
    const isDir = rel.endsWith('/');
    const path = rel.replace(/\/$/, '');
    if (exts.some(e => path.toLowerCase().endsWith(e))) return true;
    const segs = path.split('/');
    return rules.some(({ p, dirOnly, anchored }) => anchored
      ? path.startsWith(`${p}/`) || (path === p && (!dirOnly || isDir))
      : segs.some((s, i) => s === p && (i < segs.length - 1 || !dirOnly || isDir)));
  };
}

const sha = s => createHash('sha256').update(s).digest('hex');
const words = s => (s.match(/\S+/g) || []).length;

/** Creates the folder indexer over one DB; `embedDocs(texts[])` returns Float32Array[]. */
export function createIndexer({ db, base, embedDocs, onProgress = () => {} }) {
  let lastReconcile = 0;
  let running = null;
  const get = db.prepare('SELECT id, hash, mtime, size FROM docs WHERE path = ?');

  async function ignoreFn() {
    try { return parseIgnore(await fs.readFile(guard(base, '.pitwall/ignore'), 'utf8')); } catch { return () => false; }
  }

  async function walk(ignored) {
    const files = [];
    const rec = async (dir, rel) => {
      for (const e of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
        const r = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) {
          if (SKIP_DIRS.has(e.name) || e.name.startsWith('.') || ignored(`${r}/`)) continue;
          await rec(path.join(dir, e.name), r);
        } else if (e.isFile() && INDEX_EXT.has(path.extname(e.name).toLowerCase()) && !e.name.startsWith('.') && !ignored(r)) {
          const st = await fs.stat(path.join(dir, e.name)).catch(() => null);
          if (st && st.size <= MAX_BYTES) files.push({ rel: r, size: st.size, mtime: Math.floor(st.mtimeMs) });
        }
      }
    };
    await rec(base, '');
    return files;
  }

  async function prepare(rel, st) {
    const buf = await fs.readFile(path.join(base, rel));
    if (buf.includes(0)) return null;
    const text = buf.toString('utf8');
    return { rel, text, hash: sha(text), size: st.size, mtime: st.mtime };
  }

  function chunkFile(f, urlTickets) {
    const markdown = /\.md$/i.test(f.rel);
    const title = extractTitle(f.text, f.rel);
    const fm = markdown ? parseFrontmatter(f.text) : { tags: [] };
    const chunks = chunkText(f.text, { markdown });
    const links = markdown ? extractLinks(f.text, f.rel) : [];
    const project = fm.project || f.rel.match(/^projects\/([^/]+)\//)?.[1] || null;
    return { ...f, title, tags: fm.tags, type: fm.type ?? null, project, status: fm.status ?? null, chunks, links, entities: extractEntities(f.text, { tags: fm.tags, links, urlTickets }) };
  }

  /** Embeds and stores prepared files; each file lands in its own transaction that re-checks the hash. */
  async function store(files, explicitTags) {
    let urlTickets = null;
    try { urlTickets = new Map(listResources(base).filter(r => r.ticket).map(r => [r.url, r.ticket])); } catch { /* no registry */ }
    const prepared = files.flatMap(f => {
      try { return [chunkFile(f, urlTickets)]; } catch (e) { console.error(`pitwall: skipped ${f.rel}: ${e.message}`); return []; }
    });
    const items = prepared.flatMap(f => f.chunks.map(c => ({ c, text: embedText(f.title, c) })));
    const order = items.map((_, i) => i).sort((a, b) => items[a].text.length - items[b].text.length);
    for (let i = 0; i < order.length; i += BATCH) {
      const idxs = order.slice(i, i + BATCH);
      const vecs = await embedDocs(idxs.map(k => items[k].text));
      idxs.forEach((k, j) => { items[k].c.vec = vecs[j]; });
    }
    for (const f of prepared) {
      tx(db, () => {
        const model = metaGet(db, 'embed_model');
        if (model !== db.embedModel) throw new Error(`The index now belongs to embedding model ${model}; restart this server to use ${db.embedModel}.`);
        const dims = db.prepare('SELECT length(embedding) / 4 AS d FROM chunks LIMIT 1').get()?.d;
        if (dims && f.chunks.some(c => c.vec.length !== dims)) throw new Error('Embedding size differs from the index; restart this server.');
        let now = null;
        try { now = sha(readFileSync(path.join(base, f.rel)).toString('utf8')); } catch { /* gone */ }
        if (now !== f.hash) return;
        const cur = get.get(f.rel);
        if (cur && cur.hash === f.hash) {
          db.prepare('UPDATE docs SET mtime = ?, size = ?, tags = ? WHERE id = ?').run(f.mtime, f.size, JSON.stringify(explicitTags ?? JSON.parse(db.prepare('SELECT tags FROM docs WHERE id = ?').get(cur.id).tags)), cur.id);
          return;
        }
        if (cur) removeDoc(db, cur.id);
        const tags = explicitTags ?? f.tags;
        const id = Number(db.prepare(`INSERT INTO docs(path, title, tags, type, project, status, hash, mtime, size, word_count, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(f.rel, f.title, JSON.stringify(tags), f.type, f.project, f.status, f.hash, f.mtime, f.size, words(f.text), Date.now()).lastInsertRowid);
        const ins = db.prepare('INSERT INTO chunks(doc_id, idx, heading, start_line, end_line, text, embedding) VALUES (?, ?, ?, ?, ?, ?, ?)');
        const fts = db.prepare('INSERT INTO chunks_fts(rowid, title, path, heading, body) VALUES (?, ?, ?, ?, ?)');
        f.chunks.forEach((c, idx) => {
          const cid = Number(ins.run(id, idx, c.heading, c.startLine, c.endLine, c.text, vecToBlob(c.vec)).lastInsertRowid);
          fts.run(cid, f.title, f.rel, c.heading, c.text);
        });
        const lk = db.prepare('INSERT INTO links(src_doc, dst_path) VALUES (?, ?)');
        for (const l of f.links) lk.run(id, l);
        const ent = db.prepare('INSERT INTO entities(kind, name) VALUES (?, ?) ON CONFLICT(kind, name) DO UPDATE SET kind = kind RETURNING id');
        const men = db.prepare('INSERT INTO mentions(doc_id, entity_id, count) VALUES (?, ?, ?)');
        for (const e of f.entities.values()) men.run(id, ent.get(e.kind, e.name).id, e.count);
      });
    }
  }

  async function reconcileInner() {
    const t0 = Date.now();
    const files = await walk(await ignoreFn());
    const known = new Map(db.prepare('SELECT id, path, hash, mtime, size FROM docs').all().map(r => [r.path, r]));
    const seen = new Set(files.map(f => f.rel));
    let indexed = 0, removed = 0, unchanged = 0, pending = [], pendingChunks = 0;
    const flush = async () => { if (pending.length) { const p = pending; pending = []; pendingChunks = 0; await store(p); indexed += p.length; } };
    for (const f of files) {
      const row = known.get(f.rel);
      if (row && row.mtime === f.mtime && row.size === f.size) { unchanged++; continue; }
      const p = await prepare(f.rel, f).catch(e => { console.error(`pitwall: could not read ${f.rel}: ${e.message}`); return undefined; });
      if (p === undefined) continue;
      if (!p) { if (row) { tx(db, () => removeDoc(db, row.id)); removed++; } continue; }
      if (row && row.hash === p.hash) {
        db.prepare('UPDATE docs SET mtime = ?, size = ? WHERE id = ?').run(f.mtime, f.size, row.id);
        unchanged++;
        continue;
      }
      pending.push(p);
      pendingChunks += Math.ceil(p.text.length / 1600);
      if (pendingChunks >= FLUSH_CHUNKS) { await flush(); onProgress({ indexed, total: files.length }); }
    }
    await flush();
    for (const [p, row] of known) if (!seen.has(p)) { tx(db, () => removeDoc(db, row.id)); removed++; }
    if (indexed || removed) pruneEntities(db);
    lastReconcile = Date.now();
    return { indexed, removed, unchanged, ms: Date.now() - t0 };
  }

  return {
    /** Brings the index in line with the folder (incremental; concurrent calls share one run). */
    reconcile() { return (running ??= reconcileInner().finally(() => { running = null; })); },
    /** Runs reconcile when the last one is older than `ms`. */
    async refreshIfStale(ms = 30_000) { if (Date.now() - lastReconcile > ms) await this.reconcile(); },
    lastReconcile: () => lastReconcile,
    /** Indexes one file by base-relative path; removes it from the index if it is no longer indexable. */
    async indexFile(rel, { tags } = {}) {
      rel = rel.split(path.sep).join('/');
      const row = get.get(rel);
      let st = null;
      try { st = await fs.stat(guard(base, rel)); } catch { /* missing or outside the base */ }
      const parts = rel.split('/');
      const ok = st?.isFile() && st.size <= MAX_BYTES && INDEX_EXT.has(path.extname(rel).toLowerCase())
        && !parts.slice(0, -1).some(d => SKIP_DIRS.has(d) || d.startsWith('.')) && !(await ignoreFn())(rel);
      if (!ok) { if (row) tx(db, () => removeDoc(db, row.id)); return { skipped: st ? 'not indexable' : 'missing' }; }
      let p;
      try { p = await prepare(rel, { size: st.size, mtime: Math.floor(st.mtimeMs) }); } catch (e) {
        console.error(`pitwall: could not read ${rel}: ${e.message}`);
        return { skipped: 'unreadable' };
      }
      if (!p) { if (row) tx(db, () => removeDoc(db, row.id)); return { skipped: 'binary' }; }
      if (row && row.hash === p.hash && !tags) { db.prepare('UPDATE docs SET mtime = ?, size = ? WHERE id = ?').run(p.mtime, p.size, row.id); return { indexed: true }; }
      await store([p], tags);
      return { indexed: true };
    },
    /** Drops one file (or every file under a folder) from the index. */
    removeFile(rel) {
      rel = rel.split(path.sep).join('/').replace(/\/$/, '');
      const rows = db.prepare("SELECT id FROM docs WHERE path = ? OR path LIKE ? ESCAPE '\\'").all(rel, `${rel.replace(/[\\%_]/g, '\\$&')}/%`);
      for (const r of rows) tx(db, () => removeDoc(db, r.id));
      return rows.length;
    },
    /** Wipes and rebuilds the whole index. */
    async rebuild() {
      while (running) await running.catch(() => {});
      tx(db, () => db.exec('DELETE FROM mentions; DELETE FROM entities; DELETE FROM chunks_fts; DELETE FROM links; DELETE FROM chunks; DELETE FROM docs;'));
      return this.reconcile();
    },
  };
}
