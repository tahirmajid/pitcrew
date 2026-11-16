import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReviewPrompt, resolveTarget, CODEX_FINDINGS_SCHEMA } from '../src/codex.js';

test('prompt carries focus verbatim', () => {
  const prompt = buildReviewPrompt({ subject: 'auth refactor', focus: 'only check the token expiry path', target: 'diff --git a/x' });
  assert.match(prompt, /only check the token expiry path/);
  assert.match(prompt, /auth refactor/);
  assert.match(prompt, /diff --git a\/x/);
});

test('prompt omits focus when absent', () => {
  assert.doesNotMatch(buildReviewPrompt({ subject: 'x', target: 'y' }), /Focus/);
});

test('resolveTarget priority: content, then diffBase, then uncommitted, else null', async () => {
  const never = async () => { throw new Error('fetchDiff should not be called'); };
  assert.equal(await resolveTarget({ content: 'raw text', diffBase: 'develop', uncommitted: true }, never), 'raw text');
  let range;
  assert.equal(await resolveTarget({ diffBase: 'develop', uncommitted: true }, async r => { range = r; return 'diff text'; }), 'diff text');
  assert.equal(range, 'develop...HEAD');
  assert.equal(await resolveTarget({ uncommitted: true }, async r => { range = r; return 'wip'; }), 'wip');
  assert.equal(range, 'HEAD');
  assert.equal(await resolveTarget({}, never), null);
});

test('findings schema is strict-mode valid', () => {
  assert.equal(CODEX_FINDINGS_SCHEMA.additionalProperties, false);
  const item = CODEX_FINDINGS_SCHEMA.properties.findings.items;
  assert.equal(item.additionalProperties, false);
  const required = new Set(item.required);
  for (const key of Object.keys(item.properties)) assert.ok(required.has(key), `${key} must be required`);
});
