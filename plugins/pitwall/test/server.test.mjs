import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { FIXTURE, tmp } from './helpers.mjs';

const base = fs.realpathSync(tmp());
fs.cpSync(FIXTURE, base, { recursive: true });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'index.js')],
  env: { ...process.env, PITWALL_BASE_DIR: base, PITWALL_DB_PATH: path.join(tmp(), 's.db'), PITWALL_PROJECT_DIR: base },
  stderr: 'ignore',
});
const client = new Client({ name: 'test', version: '1' });
await client.connect(transport);
const call = async (name, args = {}) => (await client.callTool({ name, arguments: args })).content[0].text;

test('initialize exposes short instructions and all tools', async () => {
  assert.ok(client.getInstructions().length <= 600);
  const names = (await client.listTools()).tools.map(t => t.name);
  for (const n of ['read_file', 'write_file', 'recall', 'semantic_search', 'reindex', 'link_project', 'unlink_project', 'list_projects', 'review_codex_run', 'forget_knowledge']) assert.ok(names.includes(n), n);
});

test('reindex then recall returns path:lines hits, compact and explained', async () => {
  await call('reindex');
  const out = await call('recall', { query: 'RETRY_BACKOFF_MS', limit: 2 });
  assert.match(out, /^1\. .* — retry-policy\.md:\d+-\d+/);
  assert.match(await call('recall', { query: 'RETRY_BACKOFF_MS', compact: true }), /^• retry-policy\.md:\d+-\d+ — /);
  assert.match(await call('semantic_search', { query: 'RETRY_BACKOFF_MS', explain: true }), /score/);
});

test('write_file indexes, add_note returns a path, unknown project errors', async () => {
  await call('write_file', { path: 'zeta.md', content: '# Zeta\n\nunique platypus marker\n' });
  assert.match(await call('recall', { query: 'platypus marker', compact: true }), /zeta\.md/);
  assert.match(await call('add_note', { content: 'remember the walrus', title: 'Walrus' }), /inbox\/\d{4}-\d\d-\d\d-walrus\.md/);
  assert.match(await call('recall', { query: 'walrus', project: 'nope' }), /Unknown project "nope"/);
  assert.match(await call('read_file', { path: 'zeta.md', offset: 3, limit: 1 }), /unique platypus/);
  assert.match(await call('read_file', { path: '../x' }).catch(e => e.message), /Access denied|error/i);
});

test('projects: link, scope project, list', async () => {
  await call('link_project', { project: 'orbit', repo: base, tier: 'medium' });
  assert.match(await call('list_projects'), /\* orbit \[medium, active\]/);
  const out = await call('recall', { query: 'architecture', scope: 'project', compact: true });
  assert.ok(out.split('\n').every(l => l.includes('projects/orbit/')));
  assert.match(await call('forget_knowledge', { entry_id: 'reading-list.md' }), /Removed/);
});

test.after(() => client.close());
