import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { openDb } from '../src/db.js';
import { createIndexer } from '../src/indexer.js';
import { setup, embedder, MODEL } from './helpers.mjs';

const paths = db => db.prepare('SELECT path FROM docs ORDER BY path').all().map(r => r.path);
const count = (db, t) => db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n;
const write = (base, p, c) => { fs.mkdirSync(path.dirname(path.join(base, p)), { recursive: true }); fs.writeFileSync(path.join(base, p), c); };

test('add, change, delete, rename are all reflected', async () => {
  const { base, db, indexer } = setup({ files: { 'a.md': '# A\n\nfirst body about apples\n', 'sub/b.md': '# B\n\nbody about bananas\n' } });
  assert.equal((await indexer.reconcile()).indexed, 2);
  assert.deepEqual(paths(db), ['a.md', 'sub/b.md']);

  write(base, 'a.md', '# A\n\nchanged body about cherries\n');
  fs.utimesSync(path.join(base, 'a.md'), new Date(), new Date(Date.now() + 5000));
  const r2 = await indexer.reconcile();
  assert.equal(r2.indexed, 1);
  assert.match(db.prepare("SELECT text FROM chunks WHERE doc_id = (SELECT id FROM docs WHERE path = 'a.md')").get().text, /cherries/);

  fs.renameSync(path.join(base, 'sub/b.md'), path.join(base, 'sub/c.md'));
  const r3 = await indexer.reconcile();
  assert.deepEqual([r3.indexed, r3.removed], [1, 1]);
  assert.deepEqual(paths(db), ['a.md', 'sub/c.md']);

  fs.unlinkSync(path.join(base, 'a.md'));
  assert.equal((await indexer.reconcile()).removed, 1);
  assert.equal(count(db, 'chunks_fts'), count(db, 'chunks'));
});

test('reconcile is idempotent', async () => {
  const { db, indexer } = setup({ fixture: true });
  await indexer.reconcile();
  const before = [count(db, 'docs'), count(db, 'chunks'), count(db, 'links')];
  const r = await indexer.reconcile();
  assert.deepEqual([r.indexed, r.removed], [0, 0]);
  assert.deepEqual([count(db, 'docs'), count(db, 'chunks'), count(db, 'links')], before);
});

test('.pitwall/ignore excludes folders and extensions', async () => {
  const { db, indexer } = setup({ files: { 'keep.md': '# K\n\nkeep\n', 'private/x.md': '# X\n\nsecret\n', 'data.json': '{"a":1}', '.pitwall/ignore': 'private/\n*.json\n' } });
  await indexer.reconcile();
  assert.deepEqual(paths(db), ['keep.md']);
});

test('indexFile and removeFile handle single files', async () => {
  const { base, db, indexer } = setup({});
  write(base, 'notes/n.md', '# N\n\nnote body\n');
  assert.ok((await indexer.indexFile('notes/n.md')).indexed);
  assert.deepEqual(paths(db), ['notes/n.md']);
  assert.equal(indexer.removeFile('notes'), 1);
  assert.deepEqual(paths(db), []);
});

test('two connections reconciling at once do not duplicate or fail', async () => {
  const { base, dbPath, db, indexer } = setup({ fixture: true });
  const db2 = openDb({ base, dbPath, embedModel: MODEL });
  const indexer2 = createIndexer({ db: db2, base, embedDocs: embedder.embedDocs });
  const res = await Promise.allSettled([indexer.reconcile(), indexer2.reconcile()]);
  assert.ok(res.every(r => r.status === 'fulfilled'), JSON.stringify(res.map(r => r.reason?.message)));
  const files = fs.readdirSync(base, { recursive: true }).filter(f => f.endsWith('.md')).length;
  assert.equal(count(db, 'docs'), files);
  assert.equal(count(db, 'chunks_fts'), count(db, 'chunks'));
});
