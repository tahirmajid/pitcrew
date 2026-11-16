import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../src/config.js';
import { initKb } from '../src/scaffold.js';
import { sessionContext } from '../scripts/session-context.js';
import { linkProject } from '../src/projects.js';
import { linkResource } from '../src/resources.js';
import { openDb } from '../src/db.js';
import { tmp, MODEL } from './helpers.mjs';

test('config reads PITWALL_*; empty or unexpanded values count as unset', () => {
  const base = fs.realpathSync(tmp());
  const c = loadConfig({ PITWALL_BASE_DIR: base, PITWALL_RERANK: '1', PITWALL_GRAPH: '0', PITWALL_EMBED_MODEL: 'm' });
  assert.deepEqual([c.dbPath, c.rerank, c.graph, c.embedModel], [path.join(base, '.pitwall', 'index.db'), true, false, 'm']);
  for (const v of ['', '  ', '${user_config.kb_dir}', undefined]) assert.throws(() => loadConfig({ PITWALL_BASE_DIR: v }), /not configured.*kb_dir/);
  assert.equal(loadConfig({ PITWALL_BASE_DIR: base, PITWALL_DB_PATH: '${user_config.x}' }).dbPath, path.join(base, '.pitwall', 'index.db'));
  assert.throws(() => loadConfig({ LK_BASE_DIR: base }), /not configured/);
});

test('an existing knowledge.db is opened in place; the new default wins once it exists', () => {
  const base = fs.realpathSync(tmp());
  fs.writeFileSync(path.join(base, 'knowledge.db'), '');
  const c = loadConfig({ PITWALL_BASE_DIR: base });
  assert.equal(c.dbPath, path.join(base, 'knowledge.db'));
  assert.match(c.notice, /in place/);
  fs.mkdirSync(path.join(base, '.pitwall'));
  fs.writeFileSync(path.join(base, '.pitwall', 'index.db'), '');
  assert.equal(loadConfig({ PITWALL_BASE_DIR: base }).notice, null);
  assert.equal(loadConfig({ PITWALL_BASE_DIR: base, PITWALL_DB_PATH: '/x/y.db' }).dbPath, '/x/y.db');
});

test('a v4 index rebuilds on open and keeps reviews', () => {
  const base = fs.realpathSync(tmp()), dbPath = path.join(tmp(), 'v4.db');
  const db = openDb({ base, dbPath, embedModel: MODEL });
  db.exec("INSERT INTO reviews(id, subject, created_at, updated_at) VALUES ('r', 's', 1, 1); UPDATE meta SET value = '4' WHERE key = 'schema_version'");
  db.exec("INSERT INTO docs(path, title) VALUES ('a.md', 'A')");
  db.close();
  const db2 = openDb({ base, dbPath, embedModel: MODEL });
  assert.equal(db2.prepare('SELECT COUNT(*) AS n FROM docs').get().n, 0);
  assert.equal(db2.prepare('SELECT COUNT(*) AS n FROM reviews').get().n, 1);
  assert.ok(db2.prepare('PRAGMA table_info(docs)').all().some(c => c.name === 'type'));
});

test('init_kb copies the scaffold and never overwrites', () => {
  const from = tmp(), base = tmp();
  fs.mkdirSync(path.join(from, 'projects'), { recursive: true });
  fs.writeFileSync(path.join(from, 'README.md'), 'scaffold');
  fs.writeFileSync(path.join(from, 'projects', 'p.md'), 'p');
  fs.writeFileSync(path.join(base, 'README.md'), 'mine');
  assert.deepEqual(initKb(base, from), { created: 1, skipped: 1 });
  assert.equal(fs.readFileSync(path.join(base, 'README.md'), 'utf8'), 'mine');
  assert.deepEqual(initKb(base, from), { created: 0, skipped: 2 });
  assert.throws(() => initKb(base, path.join(from, 'none')), /scaffold not found/);
});

test('session-context stays under 600 chars, resolves the plugin option, and handles unconfigured', () => {
  const base = fs.realpathSync(tmp());
  const repo = fs.realpathSync(tmp());
  for (let i = 0; i < 30; i++) linkProject(base, { project: `project-with-a-long-name-${i}`, repo });
  linkResource(base, { url: 'https://example.com', project: 'project-with-a-long-name-0' });
  const out = sessionContext({ CLAUDE_PLUGIN_OPTION_KB_DIR: base, CLAUDE_PROJECT_DIR: repo });
  assert.ok(out.length <= 600 && out.includes(base) && /project-with-a-long-name/.test(out) && /recall/.test(out), out);
  assert.match(sessionContext({ PITWALL_BASE_DIR: base }, JSON.stringify({ cwd: repo })), /project-with-a-long-name-0 \[small, active, 1 resources\]/);
  const other = fs.realpathSync(tmp());
  assert.ok(sessionContext({ PITWALL_BASE_DIR: other, CLAUDE_PLUGIN_OPTION_KB_DIR: base }).includes(other));
  for (const v of [undefined, '', '${user_config.kb_dir}']) {
    const u = sessionContext({ PITWALL_BASE_DIR: v, CLAUDE_PLUGIN_OPTION_KB_DIR: v });
    assert.match(u, /not configured/);
    assert.ok(u.length <= 600);
  }
  assert.doesNotThrow(() => sessionContext({ PITWALL_BASE_DIR: '/definitely/missing' }, 'not json'));
});

test('a base dir with a trailing space is kept as given', () => {
  const base = fs.realpathSync(tmp()) + ' ';
  fs.mkdirSync(base);
  assert.equal(loadConfig({ PITWALL_BASE_DIR: base }).base, base);
});
