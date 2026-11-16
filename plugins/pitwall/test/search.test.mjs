import test from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './helpers.mjs';
import { looksLikeIdentifier, makeSnippet } from '../src/search.js';

const env = setup({ fixture: true });
await env.indexer.reconcile();
const s = (q, o) => env.searcher.search(q, { limit: 10, ...o });

test('identifier query ranks its doc first', async () => {
  assert.equal((await s('RETRY_BACKOFF_MS'))[0].path, 'retry-policy.md');
});

test('natural query finds the right doc', async () => {
  assert.equal((await s('how long to steep cold brew'))[0].path, 'coffee-brewing.md');
});

test('duplicate file is deduped', async () => {
  const hits = await s('weekly sync decisions importer Thursday');
  assert.equal(hits.filter(h => h.path.includes('meeting-notes')).length, 1);
});

test('path prefix and tag filters', async () => {
  assert.ok((await s('architecture', { pathPrefix: 'projects/lumen' })).every(h => h.path.startsWith('projects/lumen/')));
  assert.ok((await s('feed', { tags: ['baking'] })).every(h => h.path === 'sourdough-starter.md'));
});

test('hits carry line ranges inside the file and a snippet', async () => {
  const h = (await s('RETRY_BACKOFF_MS'))[0];
  assert.ok(h.startLine >= 1 && h.endLine >= h.startLine && h.snippet.length > 0);
});

test('hostile query does not throw', async () => {
  await s('" AND ( * -');
});

test('identifier detection and snippet window', () => {
  assert.ok(looksLikeIdentifier('RETRY_BACKOFF_MS'));
  assert.ok(looksLikeIdentifier('getUserName'));
  assert.ok(!looksLikeIdentifier('how to brew coffee'));
  const text = Array.from({ length: 40 }, (_, i) => (i === 30 ? 'the needle line' : `filler line ${i}`)).join('\n');
  const sn = makeSnippet(text, 10, ['needle'], 120);
  assert.match(sn.snippet, /needle/);
  assert.ok(sn.startLine <= 40 && sn.endLine >= 40);
});

test('cache reloads after a write on another connection', async () => {
  const before = env.cache.get().n;
  env.db.exec("DELETE FROM chunks_fts WHERE rowid IN (SELECT id FROM chunks WHERE doc_id = (SELECT id FROM docs WHERE path = 'reading-list.md')); DELETE FROM docs WHERE path = 'reading-list.md'");
  assert.ok(env.cache.get().n < before);
});
