import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openDb } from '../src/db.js';
import { tmp, MODEL } from './helpers.mjs';

test('v3 DB-only notes and bookmarks are exported to files and v3 tables dropped', () => {
  const base = tmp(), dbPath = path.join(tmp(), 'v3.db');
  const v3 = new DatabaseSync(dbPath);
  v3.exec(`CREATE TABLE entries (id TEXT PRIMARY KEY, title TEXT, source_type TEXT, source_path TEXT, source_url TEXT, tags TEXT, created_at INTEGER);
    CREATE TABLE chunks (id INTEGER PRIMARY KEY, entry_id TEXT, content TEXT, chunk_index INTEGER, embedding BLOB);
    CREATE TABLE connections (entry_a TEXT, entry_b TEXT, similarity REAL);`);
  const e = v3.prepare('INSERT INTO entries VALUES (?, ?, ?, ?, ?, ?, ?)');
  e.run('1', 'Idea One', 'note', null, null, '["x"]', Date.UTC(2026, 0, 5));
  e.run('2', 'A Page', 'url', null, 'https://example.com/a', '[]', Date.UTC(2026, 0, 6));
  e.run('3', 'From File', 'file', 'docs/f.md', null, '[]', Date.UTC(2026, 0, 7));
  const c = v3.prepare('INSERT INTO chunks(entry_id, content, chunk_index, embedding) VALUES (?, ?, ?, ?)');
  c.run('1', 'first part', 0, null); c.run('1', 'second part', 1, null); c.run('2', 'page text', 0, null); c.run('3', 'file text', 0, null);
  v3.close();

  const db = openDb({ base, dbPath, embedModel: MODEL });
  const note = fs.readFileSync(path.join(base, 'inbox/2026-01-05-idea-one.md'), 'utf8');
  assert.match(note, /first part\n\nsecond part/);
  assert.match(note, /tags: \["x"\]/);
  assert.match(fs.readFileSync(path.join(base, 'inbox/bookmarks/a-page.md'), 'utf8'), /url: "https:\/\/example\.com\/a"/);
  assert.ok(!fs.existsSync(path.join(base, 'docs')));
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(r => r.name);
  assert.ok(!tables.includes('entries') && !tables.includes('connections'));
  assert.ok(tables.includes('docs') && tables.includes('chunks') && tables.includes('reviews'));
  assert.ok(!db.prepare('PRAGMA table_info(chunks)').all().some(r => r.name === 'entry_id'));
});

test('existing note file is not overwritten', () => {
  const base = tmp(), dbPath = path.join(tmp(), 'v3.db');
  fs.mkdirSync(path.join(base, 'inbox'));
  fs.writeFileSync(path.join(base, 'inbox/2026-01-05-idea-one.md'), 'mine');
  const v3 = new DatabaseSync(dbPath);
  v3.exec(`CREATE TABLE entries (id TEXT PRIMARY KEY, title TEXT, source_type TEXT, source_path TEXT, source_url TEXT, tags TEXT, created_at INTEGER);
    CREATE TABLE chunks (id INTEGER PRIMARY KEY, entry_id TEXT, content TEXT, chunk_index INTEGER, embedding BLOB);`);
  v3.prepare('INSERT INTO entries VALUES (?, ?, ?, ?, ?, ?, ?)').run('1', 'Idea One', 'note', null, null, '[]', Date.UTC(2026, 0, 5));
  v3.close();
  openDb({ base, dbPath, embedModel: MODEL });
  assert.equal(fs.readFileSync(path.join(base, 'inbox/2026-01-05-idea-one.md'), 'utf8'), 'mine');
});
