import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { CHUNKER_VERSION } from './chunker.js';
import { guard } from './guard.js';

export const SCHEMA_VERSION = '6';
export const BM25_WEIGHTS = { title: 4, path: 2, heading: 3, body: 1 };

const REVIEW_SCHEMA = `
  CREATE TABLE IF NOT EXISTS reviews (
    id TEXT PRIMARY KEY, subject TEXT NOT NULL, focus TEXT,
    cap INTEGER NOT NULL DEFAULT 3, round INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'in_progress', exit_reason TEXT,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS review_findings (
    id TEXT PRIMARY KEY, review_id TEXT NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
    round INTEGER NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, severity TEXT NOT NULL,
    embedding BLOB, disposition TEXT, evidence TEXT, repeat_of TEXT REFERENCES review_findings(id),
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_review_findings_review_id ON review_findings(review_id);
`;

const INDEX_SCHEMA = `
  CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
  CREATE TABLE IF NOT EXISTS docs (
    id INTEGER PRIMARY KEY AUTOINCREMENT, path TEXT UNIQUE NOT NULL, title TEXT, tags TEXT NOT NULL DEFAULT '[]', type TEXT, project TEXT, status TEXT,
    hash TEXT, mtime INTEGER, size INTEGER, word_count INTEGER, updated_at INTEGER
  );
  CREATE TABLE IF NOT EXISTS chunks (
    id INTEGER PRIMARY KEY AUTOINCREMENT, doc_id INTEGER NOT NULL REFERENCES docs(id) ON DELETE CASCADE,
    idx INTEGER, heading TEXT, start_line INTEGER, end_line INTEGER, text TEXT NOT NULL, embedding BLOB NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_chunks_doc ON chunks(doc_id);
  CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(title, path, heading, body, tokenize = 'porter unicode61');
  CREATE TABLE IF NOT EXISTS links (
    src_doc INTEGER NOT NULL REFERENCES docs(id) ON DELETE CASCADE, dst_path TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_links_src ON links(src_doc);
  CREATE INDEX IF NOT EXISTS idx_links_dst ON links(dst_path);
  CREATE TABLE IF NOT EXISTS entities (id INTEGER PRIMARY KEY, kind TEXT NOT NULL, name TEXT NOT NULL, UNIQUE(kind, name));
  CREATE TABLE IF NOT EXISTS mentions (
    doc_id INTEGER NOT NULL REFERENCES docs(id) ON DELETE CASCADE, entity_id INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    count INTEGER NOT NULL DEFAULT 1, PRIMARY KEY (doc_id, entity_id)
  );
  CREATE INDEX IF NOT EXISTS idx_mentions_entity ON mentions(entity_id);
`;
const INDEX_TABLES = ['mentions', 'entities', 'links', 'chunks_fts', 'chunks', 'docs'];

/** Runs fn inside BEGIN IMMEDIATE / COMMIT, rolling back on throw. */
export function tx(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { try { db.exec('ROLLBACK'); } catch { /* already rolled back */ } throw e; }
}

const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'note';
const quote = s => JSON.stringify(s);

/** Builds a note/bookmark file path (relative) and its Markdown body; shared by the tools and the v3 migration. */
export function noteFile({ kind, title, url, tags = [], text, date, project }) {
  const rel = kind === 'url' ? `inbox/bookmarks/${slug(title)}.md`
    : project ? `projects/${slug(project)}/notes/${date}-${slug(title)}.md` : `inbox/${date}-${slug(title)}.md`;
  const fm = [`title: ${quote(title)}`, url ? `url: ${quote(url)}` : null, tags.length ? `tags: [${tags.map(quote).join(', ')}]` : null].filter(Boolean);
  return { rel, content: `---\n${fm.join('\n')}\n---\n\n${text}\n` };
}

function tableCols(db, name) {
  return db.prepare(`PRAGMA table_info(${name})`).all().map(r => r.name);
}

/** Writes a note without overwriting: takes the next free `-N` name; an identical existing file counts as already exported. */
function exportNote(base, rel, content) {
  const stem = rel.replace(/\.md$/, '');
  for (let n = 1; ; n++) {
    const full = guard(base, n === 1 ? rel : `${stem}-${n}.md`);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    try { fs.writeFileSync(full, content, { flag: 'wx' }); return; } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      if (fs.readFileSync(full, 'utf8') === content) return;
    }
  }
}

/** Exports DB-only v3 notes/bookmarks to files, then drops the v3 index tables; on any export failure it throws and keeps them. */
function migrateV3(db, base) {
  const has = n => db.prepare("SELECT 1 FROM sqlite_master WHERE name = ?").get(n);
  const v3 = has('entries') || (has('chunks') && tableCols(db, 'chunks').includes('entry_id'));
  if (!v3) return;
  if (has('entries')) {
    try {
      const entries = db.prepare("SELECT * FROM entries WHERE source_type IN ('note','url')").all();
      for (const e of entries) {
        const text = db.prepare('SELECT content FROM chunks WHERE entry_id = ? ORDER BY chunk_index').all(e.id).map(c => c.content).join('\n\n');
        const { rel, content } = noteFile({
          kind: e.source_type, title: e.title, url: e.source_url, tags: JSON.parse(e.tags || '[]'), text,
          date: new Date(e.created_at).toISOString().slice(0, 10),
        });
        exportNote(base, rel, content);
      }
    } catch (e) {
      const msg = `pitwall: v3 migration failed (${e.message}); the old tables were kept, fix the cause and restart`;
      console.error(msg);
      throw new Error(msg);
    }
  }
  for (const t of ['chunks_fts_ai', 'chunks_fts_ad', 'chunks_fts_au']) db.exec(`DROP TRIGGER IF EXISTS ${t}`);
  for (const t of ['chunks_fts', 'connections', 'chunks', 'entries']) db.exec(`DROP TABLE IF EXISTS ${t}`);
}

/** Opens (creating/migrating as needed) the shared index + review database. */
export function openDb({ base, dbPath, embedModel }) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.embedModel = embedModel;
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(REVIEW_SCHEMA);
  tx(db, () => {
    migrateV3(db, base);
    db.exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)');
    const stored = db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get()?.value;
    if (stored !== SCHEMA_VERSION) for (const t of INDEX_TABLES) db.exec(`DROP TABLE IF EXISTS ${t}`);
    db.exec(INDEX_SCHEMA);
    const get = k => db.prepare('SELECT value FROM meta WHERE key = ?').get(k)?.value;
    const set = (k, v) => db.prepare('INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(k, String(v));
    if (get('embed_model') !== embedModel || get('chunker_version') !== String(CHUNKER_VERSION)) {
      db.exec('DELETE FROM mentions; DELETE FROM entities; DELETE FROM chunks_fts; DELETE FROM links; DELETE FROM chunks; DELETE FROM docs;');
    }
    set('schema_version', SCHEMA_VERSION);
    set('embed_model', embedModel);
    set('chunker_version', CHUNKER_VERSION);
  });
  return db;
}

/** Packs a vector into the BLOB layout (little-endian float32). */
export const vecToBlob = v => new Uint8Array(v.buffer, v.byteOffset, v.byteLength);

/** Unpacks a BLOB into an owned Float32Array. */
export function blobToVec(blob) {
  return new Float32Array(blob.buffer.slice(blob.byteOffset, blob.byteOffset + blob.byteLength));
}

export function removeDoc(db, docId) {
  db.prepare('DELETE FROM chunks_fts WHERE rowid IN (SELECT id FROM chunks WHERE doc_id = ?)').run(docId);
  db.prepare('DELETE FROM docs WHERE id = ?').run(docId);
}

/** Drops entities no doc mentions any more. */
export const pruneEntities = db => db.exec('DELETE FROM entities WHERE id NOT IN (SELECT entity_id FROM mentions)');

export const metaGet = (db, k) => db.prepare('SELECT value FROM meta WHERE key = ?').get(k)?.value;

// ── Adversarial review loop ───────────────────────────────────────────────────

const SEVERITIES = ['critical', 'high', 'medium', 'low'];

export function createReview(db, { subject, focus = null, cap = 3 }) {
  const id = randomUUID();
  const now = Date.now();
  db.prepare(`INSERT INTO reviews(id, subject, focus, cap, round, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, 1, 'in_progress', ?, ?)`).run(id, subject, focus, cap, now, now);
  return { id, subject, focus, cap, round: 1, status: 'in_progress' };
}

export function getReview(db, id) {
  return db.prepare('SELECT * FROM reviews WHERE id = ?').get(id) || null;
}

export function listReviews(db, { status } = {}) {
  return status
    ? db.prepare('SELECT * FROM reviews WHERE status = ? ORDER BY updated_at DESC').all(status)
    : db.prepare('SELECT * FROM reviews ORDER BY updated_at DESC').all();
}

const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };

/**
 * Records a round's findings. Each is embedded and compared with prior fix/rebut
 * findings (same dims only) so likely repeats are flagged; the caller decides.
 */
export async function addFindings(db, embedDoc, reviewId, round, findings) {
  const prior = db.prepare(`SELECT id, embedding FROM review_findings
    WHERE review_id = ? AND disposition IN ('fix', 'rebut') AND embedding IS NOT NULL`).all(reviewId)
    .map(p => ({ id: p.id, vec: blobToVec(p.embedding) }));

  const rows = [];
  for (const f of findings) {
    if (!SEVERITIES.includes(f.severity)) {
      throw new Error(`Invalid severity "${f.severity}" — must be one of ${SEVERITIES.join(', ')}`);
    }
    const vec = await embedDoc(`${f.title}\n${f.body}`);
    let possibleRepeatOf = null, repeatScore = null;
    for (const p of prior) {
      if (p.vec.length !== vec.length) continue;
      const sim = dot(vec, p.vec);
      if (repeatScore === null || sim > repeatScore) { repeatScore = sim; possibleRepeatOf = p.id; }
    }
    const isLikelyRepeat = repeatScore !== null && repeatScore >= 0.85;
    rows.push({
      id: randomUUID(), title: f.title, body: f.body, severity: f.severity, vec,
      possible_repeat_of: isLikelyRepeat ? possibleRepeatOf : null,
      repeat_similarity: isLikelyRepeat ? Number(repeatScore.toFixed(3)) : undefined,
    });
  }

  tx(db, () => {
    const insert = db.prepare(`INSERT INTO review_findings(id, review_id, round, title, body, severity, embedding, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const r of rows) insert.run(r.id, reviewId, round, r.title, r.body, r.severity, vecToBlob(r.vec), Date.now());
    db.prepare('UPDATE reviews SET updated_at = ? WHERE id = ?').run(Date.now(), reviewId);
  });

  return rows.map(({ vec, body, ...rest }) => rest);
}

export function getFinding(db, id) {
  return db.prepare('SELECT * FROM review_findings WHERE id = ?').get(id) || null;
}

export function dispositionFinding(db, id, { disposition, evidence, repeatOf = null }) {
  if (!['fix', 'rebut', 'defer'].includes(disposition)) {
    throw new Error('disposition must be one of: fix, rebut, defer');
  }
  db.prepare('UPDATE review_findings SET disposition = ?, evidence = ?, repeat_of = ? WHERE id = ?')
    .run(disposition, evidence, repeatOf, id);
}

export function listFindings(db, reviewId, round = null) {
  return round === null
    ? db.prepare('SELECT * FROM review_findings WHERE review_id = ? ORDER BY round, created_at').all(reviewId)
    : db.prepare('SELECT * FROM review_findings WHERE review_id = ? AND round = ? ORDER BY created_at').all(reviewId, round);
}

/** Pure decision-table step for one review round; callers persist the result via setReviewState. */
export function computeDecision(db, reviewId, { changesApplied, lenient = false }) {
  const review = getReview(db, reviewId);
  if (!review) throw new Error(`Unknown review_id: ${reviewId}`);

  const round = listFindings(db, reviewId, review.round);
  const undisposed = round.filter(f => !f.disposition);
  if (undisposed.length > 0) return { error: 'undisposed', undisposed: undisposed.map(f => f.id) };

  const repeatOfFix = round.some(f => f.repeat_of && getFinding(db, f.repeat_of)?.disposition === 'fix');
  const anyDefer = round.some(f => f.disposition === 'defer');
  const anyRebutCritHigh = round.some(f => f.disposition === 'rebut' && (f.severity === 'critical' || f.severity === 'high'));

  let exit = null;
  if (repeatOfFix || anyDefer || anyRebutCritHigh) {
    exit = 'needs-arbitration';
  } else if (!changesApplied) {
    exit = 'findings-rebutted';
  } else {
    const critHighFixed = round.some(f => f.disposition === 'fix' && (f.severity === 'critical' || f.severity === 'high'));
    const roundsLeft = review.round < review.cap;
    if (!critHighFixed && lenient) exit = 'non-critical-handled';
    else if (!roundsLeft) exit = 'review-cap-reached';
  }

  return exit ? { exit, round: review.round } : { exit: null, nextRound: review.round + 1 };
}

export function deleteReview(db, id) {
  db.prepare('DELETE FROM reviews WHERE id = ?').run(id);
}

export function setReviewState(db, id, { round, status, exitReason }) {
  const updates = [];
  const params = [];
  if (round !== undefined)      { updates.push('round = ?');       params.push(round); }
  if (status !== undefined)     { updates.push('status = ?');      params.push(status); }
  if (exitReason !== undefined) { updates.push('exit_reason = ?'); params.push(exitReason); }
  updates.push('updated_at = ?'); params.push(Date.now());
  params.push(id);
  db.prepare(`UPDATE reviews SET ${updates.join(', ')} WHERE id = ?`).run(...params);
}
