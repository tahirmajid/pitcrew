import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openDb } from '../src/db.js';
import { guard } from '../src/guard.js';
import { extractLinks } from '../src/chunker.js';
import { createIndexer } from '../src/indexer.js';
import { editDoc, loadProjects } from '../src/projects.js';
import { listResources } from '../src/resources.js';
import { registerFileTools } from '../src/tools-files.js';
import { registerKnowledgeTools, blockedAddr, fetchPage } from '../src/tools-knowledge.js';
import { setup, tmp, embedder, MODEL } from './helpers.mjs';

const write = (base, p, c) => { fs.mkdirSync(path.dirname(path.join(base, p)), { recursive: true }); fs.writeFileSync(path.join(base, p), c); };
const paths = db => db.prepare('SELECT path FROM docs ORDER BY path').all().map(r => r.path);

function tools(env, { knowledge = true } = {}) {
  const t = {};
  const server = { tool: (name, _d, _s, h) => { t[name] = h; } };
  registerFileTools(server, env);
  if (knowledge) registerKnowledgeTools(server, { ...env, embedder, cfg: {}, projectDir: async () => env.base });
  return (name, args = {}) => t[name](args).then(r => r.content[0].text);
}

test('symlinks that leave the base are refused by the guard and every writer', async () => {
  const env = setup({});
  const outside = fs.realpathSync(tmp());
  fs.symlinkSync(outside, path.join(env.base, 'link'));
  fs.symlinkSync(path.join(outside, 'nope'), path.join(env.base, 'dangling'));
  assert.throws(() => guard(env.base, 'link/x.md'), /Access denied/);
  assert.throws(() => guard(env.base, 'dangling'), /Access denied/);
  assert.doesNotThrow(() => guard(env.base, 'new/dir/x.md'));
  const call = tools(env);
  await assert.rejects(call('write_file', { path: 'link/x.md', content: 'x' }), /Access denied/);
  await assert.rejects(call('move_file', { source: 'link', destination: 'moved' }), /Access denied/);
  fs.rmSync(path.join(env.base, 'link'));
  fs.symlinkSync(outside, path.join(env.base, 'inbox'));
  await assert.rejects(call('add_note', { content: 'note body' }), /Access denied/);
  fs.rmSync(path.join(env.base, 'inbox'));
  fs.symlinkSync(outside, path.join(env.base, 'projects'));
  assert.match(await call('link_project', { project: 'x' }), /Access denied/);
  assert.deepEqual(fs.readdirSync(outside), []);
});

function v3Db(entries) {
  const dbPath = path.join(tmp(), 'v3.db');
  const v3 = new DatabaseSync(dbPath);
  v3.exec(`CREATE TABLE entries (id TEXT PRIMARY KEY, title TEXT, source_type TEXT, source_path TEXT, source_url TEXT, tags TEXT, created_at INTEGER);
    CREATE TABLE chunks (id INTEGER PRIMARY KEY, entry_id TEXT, content TEXT, chunk_index INTEGER, embedding BLOB);`);
  for (const [id, tags] of entries) {
    v3.prepare('INSERT INTO entries VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, 'Idea', 'note', null, null, tags, Date.UTC(2026, 0, 5));
    v3.prepare('INSERT INTO chunks(entry_id, content, chunk_index, embedding) VALUES (?, ?, 0, NULL)').run(id, `body ${id}`);
  }
  v3.close();
  return dbPath;
}

test('v3 migration keeps colliding entries under a free name and keeps the tables on failure', () => {
  const base = tmp();
  write(base, 'inbox/2026-01-05-idea.md', 'mine');
  openDb({ base, dbPath: v3Db([['1', '[]'], ['2', '[]']]), embedModel: MODEL });
  assert.equal(fs.readFileSync(path.join(base, 'inbox/2026-01-05-idea.md'), 'utf8'), 'mine');
  assert.match(fs.readFileSync(path.join(base, 'inbox/2026-01-05-idea-2.md'), 'utf8'), /body 1/);
  assert.match(fs.readFileSync(path.join(base, 'inbox/2026-01-05-idea-3.md'), 'utf8'), /body 2/);

  const bad = v3Db([['1', '[]'], ['2', '{not json']]);
  assert.throws(() => openDb({ base: tmp(), dbPath: bad, embedModel: MODEL }), /v3 migration failed/);
  const raw = new DatabaseSync(bad);
  assert.equal(raw.prepare('SELECT COUNT(*) AS n FROM entries').get().n, 2);
  assert.equal(raw.prepare('SELECT COUNT(*) AS n FROM chunks').get().n, 2);
});

test('concurrent captures of the same title never overwrite each other', async () => {
  const env = setup({});
  const call = tools(env);
  const out = await Promise.all([call('add_note', { content: 'first one', title: 'Same' }), call('add_note', { content: 'second one', title: 'Same' })]);
  assert.notEqual(out[0], out[1]);
  const all = fs.readdirSync(path.join(env.base, 'inbox')).map(f => fs.readFileSync(path.join(env.base, 'inbox', f), 'utf8'));
  assert.equal(all.length, 2);
  assert.ok(all.some(c => c.includes('first one')) && all.some(c => c.includes('second one')));
});

test('a server on another embedding model cannot write into the index', async () => {
  const base = fs.realpathSync(tmp()), dbPath = path.join(tmp(), 'k.db');
  write(base, 'a.md', '# A\n\nbody\n');
  const old = openDb({ base, dbPath, embedModel: MODEL });
  const oldIndexer = createIndexer({ db: old, base, embedDocs: embedder.embedDocs });
  openDb({ base, dbPath, embedModel: 'other/model' });
  await assert.rejects(oldIndexer.indexFile('a.md'), /restart this server/);
  assert.equal(old.prepare('SELECT COUNT(*) AS n FROM docs').get().n, 0);
});

test('doc and chunk ids are never reused, the index rebuild keeps reviews, and search drops docs removed mid-query', async () => {
  const env = setup({ files: { 'a/x.md': '# X\n\nalpha body\n', 'b/y.md': '# Y\n\nalpha other\n' } });
  await env.indexer.reconcile();
  const maxChunk = () => env.db.prepare('SELECT MAX(id) AS m FROM chunks').get().m;
  const before = maxChunk();
  env.indexer.removeFile('b/y.md');
  write(env.base, 'b/z.md', '# Z\n\nalpha third\n');
  await env.indexer.indexFile('b/z.md');
  assert.ok(maxChunk() > before);

  const searcher = (await import('../src/search.js')).createSearcher({
    db: env.db, cache: env.cache,
    embedQuery: async q => { env.indexer.removeFile('a/x.md'); write(env.base, 'a/w.md', '# W\n\nalpha new\n'); await env.indexer.indexFile('a/w.md'); return embedder.embedQuery(q); },
  });
  const hits = await searcher.search('alpha', { pathPrefix: 'a' });
  assert.ok(!hits.some(h => h.path === 'a/x.md'));

  const dbPath = path.join(tmp(), 'v5.db');
  const db = openDb({ base: env.base, dbPath, embedModel: MODEL });
  db.exec("INSERT INTO reviews(id, subject, created_at, updated_at) VALUES ('r', 's', 1, 1); UPDATE meta SET value = '5' WHERE key = 'schema_version'");
  db.close();
  const db2 = openDb({ base: env.base, dbPath, embedModel: MODEL });
  assert.equal(db2.prepare('SELECT COUNT(*) AS n FROM reviews').get().n, 1);
  assert.match(db2.prepare("SELECT sql FROM sqlite_master WHERE name = 'chunks'").get().sql, /AUTOINCREMENT/);
});

test('a file edited while it was being embedded is not stored stale', async () => {
  const base = fs.realpathSync(tmp()), dbPath = path.join(tmp(), 'k.db');
  write(base, 'a.md', '# A\n\nold text\n');
  const db = openDb({ base, dbPath, embedModel: MODEL });
  const embedDocs = async t => { write(base, 'a.md', '# A\n\nnew text\n'); return embedder.embedDocs(t); };
  const indexer = createIndexer({ db, base, embedDocs });
  await indexer.indexFile('a.md');
  assert.deepEqual(paths(db), []);
  const fresh = createIndexer({ db, base, embedDocs: embedder.embedDocs });
  await fresh.reconcile();
  assert.match(db.prepare('SELECT text FROM chunks').get().text, /new text/);
});

test('a malformed percent link does not throw and one bad file does not stop reconcile', async () => {
  assert.deepEqual(extractLinks('[x](100%.md)', 'a.md'), ['100%.md']);
  const { db, indexer } = setup({ files: { 'bad.md': '[x](100%.md)\n', 'ok.md': '# Ok\n\nfine\n' } });
  await indexer.reconcile();
  assert.deepEqual(paths(db), ['bad.md', 'ok.md']);
});

test('ignore patterns without a leading slash match at any depth and a leading slash anchors', async () => {
  const { db, indexer } = setup({ files: {
    'keep.md': '# K\n\nk\n', 'runs/a.md': '# A\n\na\n', 'proj/runs/b.md': '# B\n\nb\n', 'logs/c.md': '# C\n\nc\n', 'proj/logs/d.md': '# D\n\nd\n',
    'top/e.md': '# E\n\ne\n', 'x/top/f.md': '# F\n\nf\n', '.pitwall/ignore': 'runs/\nlogs/\n/top/\n',
  } });
  await indexer.reconcile();
  assert.deepEqual(paths(db), ['keep.md', 'x/top/f.md']);
});

test('forget_knowledge starts on a new line when the ignore file lacks a trailing newline', async () => {
  const env = setup({ files: { 'a.md': '# A\n\nbody\n', '.pitwall/ignore': 'old.md' } });
  await env.indexer.reconcile();
  const call = tools(env);
  await call('forget_knowledge', { entry_id: 'a.md' });
  assert.equal(fs.readFileSync(path.join(env.base, '.pitwall/ignore'), 'utf8'), 'old.md\n/a.md\n');
});

test('blocked addresses cover private, loopback, mapped and v6 ranges', () => {
  for (const a of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', '::', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', '::ffff:7f00:1']) assert.ok(blockedAddr(a), a);
  for (const a of ['8.8.8.8', '93.184.216.34', '172.32.0.1', '2606:4700::1111']) assert.ok(!blockedAddr(a), a);
});

const hosts = { 'pub.test': '127.0.0.1', 'bad.test': '10.0.0.1' };
const pub = { lookup: async h => [{ address: hosts[h] }], blocked: a => a.startsWith('10.') };
const serve = handler => new Promise(r => { const s = http.createServer(handler).listen(0, '127.0.0.1', () => r(s)); });

test('fetchPage refuses non-public hosts, non-http schemes and redirects into private space', async () => {
  const s = await serve((req, res) => { if (req.url === '/r') { res.writeHead(302, { location: `http://bad.test:${s.address().port}/ok` }); res.end(); } else res.end('ok'); });
  const port = s.address().port;
  try {
    await assert.rejects(fetchPage(`http://127.0.0.1:${port}/ok`), /non-public/);
    await assert.rejects(fetchPage('file:///etc/passwd', pub), /only http/);
    await assert.rejects(fetchPage(`http://bad.test:${port}/ok`, pub), /non-public/);
    await assert.rejects(fetchPage(`http://pub.test:${port}/r`, pub), /non-public/);
    assert.equal(await fetchPage(`http://pub.test:${port}/ok`, pub), 'ok');
  } finally { s.close(); }
});

test('fetchPage connects to the address it checked: one lookup per hop, any private answer refuses', async () => {
  const s = await serve((req, res) => res.end('ok'));
  const port = s.address().port;
  try {
    let n = 0;
    const flip = { blocked: pub.blocked, lookup: async () => [{ address: n++ ? '10.0.0.1' : '127.0.0.1' }] };
    assert.equal(await fetchPage(`http://flip.test:${port}/`, flip), 'ok');
    assert.equal(n, 1);
    const mixed = { blocked: pub.blocked, lookup: async () => [{ address: '127.0.0.1' }, { address: '10.0.0.1' }] };
    await assert.rejects(fetchPage(`http://mixed.test:${port}/`, mixed), /non-public/);
  } finally { s.close(); }
});

test('fetchPage aborts bodies over 2 MB', async () => {
  const s = await serve((req, res) => { res.write(Buffer.alloc(1_000_000, 97)); res.write(Buffer.alloc(1_000_000, 97)); res.end(Buffer.alloc(1_000_000, 97)); });
  try { await assert.rejects(fetchPage(`http://pub.test:${s.address().port}/`, pub), /2 MB/); } finally { s.closeAllConnections(); s.close(); }
});

test('ingest_document indexes absolute-inside-base and ./ paths under the relative path', async () => {
  const env = setup({ files: { 'a.md': '# A\n\nbody\n' } });
  const call = tools(env);
  assert.match(await call('ingest_document', { path: path.join(env.base, 'a.md') }), /Indexed a\.md/);
  assert.match(await call('ingest_document', { path: './a.md' }), /Indexed a\.md/);
  assert.deepEqual(paths(env.db), ['a.md']);
});

const outsideFile = (name, content) => { const p = path.join(fs.realpathSync(tmp()), name); fs.writeFileSync(p, content); return p; };

test('forget_knowledge refuses when .pitwall/ignore is a symlink out of the base', async () => {
  const env = setup({ files: { 'a.md': '# A\n\nbody\n' } });
  await env.indexer.reconcile();
  const out = outsideFile('ignore', 'keep\n');
  fs.mkdirSync(path.join(env.base, '.pitwall'));
  fs.symlinkSync(out, path.join(env.base, '.pitwall/ignore'));
  await assert.rejects(tools(env)('forget_knowledge', { entry_id: 'a.md' }), /Access denied/);
  assert.equal(fs.readFileSync(out, 'utf8'), 'keep\n');
});

test('v3 migration does not export through an inbox symlink out of the base', () => {
  const base = fs.realpathSync(tmp()), outside = fs.realpathSync(tmp());
  fs.symlinkSync(outside, path.join(base, 'inbox'));
  assert.throws(() => openDb({ base, dbPath: v3Db([['1', '[]']]), embedModel: MODEL }), /v3 migration failed/);
  assert.deepEqual(fs.readdirSync(outside), []);
});

test('a file symlinked out of the base is neither searched nor indexed', async () => {
  const env = setup({ files: { 'a.md': '# A\n\nbody\n' } });
  fs.symlinkSync(outsideFile('secret.md', '# S\n\nzebrasecret\n'), path.join(env.base, 'leak.md'));
  assert.match(await tools(env)('search_in_files', { query: 'zebrasecret' }), /^No matches/);
  await env.indexer.reconcile();
  assert.deepEqual(paths(env.db), ['a.md']);
  assert.deepEqual(await env.indexer.indexFile('leak.md'), { skipped: 'missing' });
  assert.deepEqual(paths(env.db), ['a.md']);
});

test('editDoc does not write through a pre-placed .tmp symlink', () => {
  const dir = fs.realpathSync(tmp()), file = path.join(dir, 'project.yml');
  const out = outsideFile('victim', 'untouched');
  fs.symlinkSync(out, `${file}.${process.pid}.tmp`);
  editDoc(file, doc => doc.set('name', 'x'));
  assert.equal(fs.readFileSync(out, 'utf8'), 'untouched');
  assert.match(fs.readFileSync(file, 'utf8'), /name: x/);
});

test('forgetting root README.md leaves projects/a/README.md indexed', async () => {
  const env = setup({ files: { 'README.md': '# Root\n\nroot\n', 'projects/a/README.md': '# A\n\nproject a\n' } });
  await env.indexer.reconcile();
  await tools(env)('forget_knowledge', { entry_id: 'README.md' });
  await env.indexer.reconcile();
  assert.deepEqual(paths(env.db), ['projects/a/README.md']);
});

test('rebuild during a running reconcile ends with every file indexed', async () => {
  const env = setup({ files: { 'a.md': '# A\n\na\n', 'b.md': '# B\n\nb\n', 'c.md': '# C\n\nc\n' } });
  await Promise.all([env.indexer.reconcile(), env.indexer.rebuild()]);
  assert.deepEqual(paths(env.db), ['a.md', 'b.md', 'c.md']);
});

test('a text file rewritten with NUL bytes leaves the index on the next reconcile', async () => {
  const env = setup({ files: { 'a.md': '# A\n\nbody\n', 'b.md': '# B\n\nb\n' } });
  await env.indexer.reconcile();
  fs.writeFileSync(path.join(env.base, 'a.md'), Buffer.from('binary\0blob data here'));
  await env.indexer.reconcile();
  assert.deepEqual(paths(env.db), ['b.md']);
});

test('project.yml and resources.yml symlinked out of the base are treated as absent', () => {
  const base = fs.realpathSync(tmp());
  fs.mkdirSync(path.join(base, 'projects/a'), { recursive: true });
  fs.mkdirSync(path.join(base, '.pitwall'));
  const yml = 'name: Evil\nresources:\n  - url: https://example.com/x\n';
  fs.symlinkSync(outsideFile('p.yml', yml), path.join(base, 'projects/a/project.yml'));
  fs.symlinkSync(outsideFile('r.yml', yml), path.join(base, '.pitwall/resources.yml'));
  assert.deepEqual(loadProjects(base), []);
  assert.deepEqual(listResources(base), []);
});

test('a doc whose read throws keeps its row and tags instead of being dropped as binary', async () => {
  const env = setup({ files: { 'a.md': '# A\n\nold\n' } });
  await env.indexer.indexFile('a.md', { tags: ['keep'] });
  const file = path.join(env.base, 'a.md');
  fs.writeFileSync(file, '# A\n\nnew and longer text\n');
  fs.chmodSync(file, 0);
  try {
    await env.indexer.reconcile();
    assert.deepEqual(await env.indexer.indexFile('a.md'), { skipped: 'unreadable' });
    assert.deepEqual(env.db.prepare('SELECT path, tags FROM docs').all().map(r => [r.path, r.tags]), [['a.md', '["keep"]']]);
  } finally { fs.chmodSync(file, 0o644); }
});
