import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { guard } from '../src/tools-files.js';

const base = path.resolve('/tmp/lk-guard/base');

test('paths inside the base resolve', () => {
  assert.equal(guard(base, 'a/b.md'), path.join(base, 'a/b.md'));
  assert.equal(guard(base, '.'), base);
});

test('escapes are rejected', () => {
  assert.throws(() => guard(base, '../other'), /Access denied/);
  assert.throws(() => guard(base, '/etc/passwd'), /Access denied/);
});

test('sibling directory sharing the base prefix is rejected', () => {
  assert.throws(() => guard(base, '../base-evil/secret.md'), /Access denied/);
});
