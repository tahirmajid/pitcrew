import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { linkProject } from '../src/projects.js';
import { linkResource, unlinkResource, listResources, inferKind, resourcesBlock } from '../src/resources.js';
import { tmp } from './helpers.mjs';

const world = () => { const base = fs.realpathSync(tmp()); linkProject(base, { project: 'alpha' }); return base; };

test('kind is inferred from the URL', () => {
  const k = {
    'https://linear.app/t/issue/ABC-1': 'ticket', 'https://github.com/o/r/issues/4': 'ticket', 'https://github.com/o/r/pull/9': 'pr',
    'https://x.slack.com/archives/C1/p1': 'thread', 'https://docs.google.com/document/d/1': 'doc', 'https://example.com/a': 'link',
  };
  for (const [u, kind] of Object.entries(k)) assert.equal(inferKind(u), kind, u);
});

test('project resources live in project.yml, ticket-only ones in .pitwall/resources.yml, repeats update', () => {
  const base = world();
  assert.throws(() => linkResource(base, { url: 'https://example.com' }), /project or a ticket/);
  assert.throws(() => linkResource(base, { url: 'https://example.com', project: 'nope' }), /Unknown project/);
  assert.equal(linkResource(base, { url: 'https://example.com/a', project: 'alpha', title: 'First' }).updated, false);
  assert.equal(linkResource(base, { url: 'https://example.com/a', project: 'alpha', title: 'Renamed', note: 'n' }).updated, true);
  linkResource(base, { url: 'https://linear.app/t/issue/ABC-7', ticket: 'ABC-7', title: 'Seven' });
  const all = listResources(base);
  assert.equal(all.length, 2);
  assert.deepEqual(listResources(base, { project: 'alpha' }).map(r => [r.title, r.note, r.kind]), [['Renamed', 'n', 'link']]);
  assert.deepEqual(listResources(base, { ticket: 'ABC-7' }).map(r => r.title), ['Seven']);
  assert.equal(listResources(base, { kind: 'ticket' }).length, 1);
  assert.ok(fs.existsSync(path.join(base, '.pitwall/resources.yml')));
  assert.equal(unlinkResource(base, { url: 'https://example.com/a' }), 1);
  assert.equal(unlinkResource(base, { url: 'https://linear.app/t/issue/ABC-7', ticket: 'ABC-7' }), 1);
  assert.equal(listResources(base).length, 0);
});

test('the Linked resources block shows for ticket ids, project and shared terms, and is omitted otherwise', () => {
  const base = world();
  linkResource(base, { url: 'https://linear.app/t/issue/ABC-7', ticket: 'ABC-7', title: 'Seven' });
  linkResource(base, { url: 'https://example.com/d', project: 'alpha', title: 'Deployment checklist', note: 'rollout steps' });
  const cur = [{ name: 'alpha' }];
  assert.match(resourcesBlock(base, { query: 'what is ABC-7 about' }), /^ticket · Seven — https:\/\/linear\.app\/t\/issue\/ABC-7 \(ABC-7\)$/);
  assert.match(resourcesBlock(base, { query: 'anything', project: 'alpha' }), /link · Deployment checklist — https:\/\/example\.com\/d \(alpha\)/);
  assert.match(resourcesBlock(base, { query: 'the rollout plan', current: cur }), /Deployment checklist/);
  assert.equal(resourcesBlock(base, { query: 'the plan for it', current: cur }), '');
  assert.equal(resourcesBlock(base, { query: 'ABC-99' }), '');
});
