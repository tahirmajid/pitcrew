import test from 'node:test';
import assert from 'node:assert/strict';
import { extractEntities } from '../src/graph.js';
import { setup } from './helpers.mjs';
import { linkProject } from '../src/projects.js';
import { linkResource } from '../src/resources.js';

const names = (text, o) => Object.fromEntries([...extractEntities(text, o).values()].map(e => [`${e.kind}:${e.name}`, e.count]));

test('entity extraction: tickets, PRs, identifiers, files, tags, links', () => {
  const e = names('See ABC-123 twice ABC-123, PR #4512 and #7 (skip). `FooRepository` calls get_user_name and foo.bar.baz in build.gradle.kts. '
    + 'https://github.com/o/r/pull/88 and https://example.com/x/y.html are urls. HTTP and iOS stay out.', { tags: ['t1'], links: ['other.md'] });
  assert.equal(e['ticket:ABC-123'], 2);
  assert.ok(e['pr:#4512'] && e['pr:#88'] && !e['pr:#7']);
  for (const k of ['code:FooRepository', 'code:get_user_name', 'code:foo.bar.baz', 'code:build.gradle.kts', 'tag:t1', 'link:other.md']) assert.ok(k in e, k);
  assert.ok(!('code:HTTP' in e) && !('code:y.html' in e));
});

test('entity extraction caps at 200 and attaches resource URL tickets', () => {
  const many = Array.from({ length: 400 }, (_, i) => `widget_part${i}`).join(' ');
  assert.equal(extractEntities(`ABC-1 ${many}`).size, 200);
  assert.ok(extractEntities('read https://linear.app/t/issue/ABC-5 now', { urlTickets: new Map([['https://linear.app/t/issue/ABC-5', 'ABC-5']]) }).has('ticket\0ABC-5'));
});

const files = {
  'a.md': '# Cache design\n\nThe cache eviction policy is described here for ABC-4242 and `EvictionPlanner`.\n',
  'b.md': '# Quarterly planning\n\nOrthogonal paragraph about budgets and hiring. Tracked in ABC-4242.\n',
  'c.md': '# Unrelated gardening\n\nTomatoes need sun.\n',
  'd.md': '# Links back\n\nSee [the cache design](a.md) for context on zebras.\n',
  'e.md': '# Filler one\n\nAlpha.\n', 'f.md': '# Filler two\n\nBeta.\n', 'g.md': '# Filler three\n\nGamma.\n',
};
const env = setup({ files });
await env.indexer.reconcile();
const paths = hits => hits.map(h => h.path);

test('entities and mentions are indexed and pruned with their docs', async () => {
  const n = t => env.db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n;
  assert.ok(n('entities') > 0 && n('mentions') >= n('entities'));
  assert.equal(env.db.prepare("SELECT COUNT(*) AS n FROM entities WHERE name = 'ABC-4242'").get().n, 1);
});

test('expand surfaces a doc sharing a ticket with the top hit but none of the query words', async () => {
  const q = 'cache eviction policy';
  const off = paths(await env.searcher.search(q, { limit: 10, expand: false }));
  const hits = await env.searcher.search(q, { limit: 10, expand: true });
  assert.equal(hits[0].path, 'a.md');
  assert.ok(paths(hits).indexOf('b.md') >= 0 && paths(hits).indexOf('b.md') < off.indexOf('b.md'));
  assert.ok(paths(hits).includes('d.md'));
});

test('a ticket id in the query matches its docs directly', async () => {
  const p = paths(await env.searcher.search('ABC-4242', { limit: 5, expand: true }));
  assert.ok(p.includes('a.md') && p.includes('b.md'));
});

test('resource URLs in a doc attach to their ticket', async () => {
  const e2 = setup({ files: { 'x.md': '# X\n\nsee https://linear.app/t/issue/ABC-9 for it\n' } });
  linkProject(e2.base, { project: 'p' });
  linkResource(e2.base, { url: 'https://linear.app/t/issue/ABC-9', ticket: 'ABC-9' });
  await e2.indexer.reconcile();
  assert.equal(e2.db.prepare("SELECT COUNT(*) AS n FROM entities WHERE name = 'ABC-9'").get().n, 1);
});
