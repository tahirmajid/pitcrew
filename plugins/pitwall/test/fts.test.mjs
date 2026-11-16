import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { buildMatch } from '../src/search.js';

const db = new DatabaseSync(':memory:');
db.exec("CREATE VIRTUAL TABLE t USING fts5(body, tokenize = 'porter unicode61'); INSERT INTO t VALUES ('alpha beta gamma'), ('foo-bar baz');");

test('hostile input never throws and yields a valid MATCH or null', () => {
  for (const q of ['"', 'a AND', 'AND OR NOT', '*', '(', ')', 'foo-bar', '"quoted phrase"', "it's", 'a"b', 'NEAR(a b)', '', '   ', '---', '^x', 'col:val', '\\']) {
    const m = buildMatch(q);
    if (m !== null) db.prepare('SELECT rowid FROM t WHERE t MATCH ?').all(m);
  }
});

test('empty and symbol-only queries give null', () => {
  assert.equal(buildMatch(''), null);
  assert.equal(buildMatch('--- ***'), null);
  assert.equal(buildMatch(undefined), null);
});

test('terms are OR-joined quoted phrases and hyphenated terms still match', () => {
  assert.equal(buildMatch('alpha gamma'), '"alpha" OR "gamma"');
  assert.equal(db.prepare('SELECT rowid FROM t WHERE t MATCH ?').all(buildMatch('foo-bar')).length, 1);
});
