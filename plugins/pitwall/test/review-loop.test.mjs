import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, createReview, addFindings, dispositionFinding, computeDecision, setReviewState } from '../src/db.js';
import { tmp, embedder, MODEL } from './helpers.mjs';
import path from 'node:path';

const db = openDb({ base: tmp(), dbPath: path.join(tmp(), 'r.db'), embedModel: MODEL });
const embedDoc = async t => (await embedder.embedDocs([t]))[0];
const add = (id, round, f) => addFindings(db, embedDoc, id, round, f);

test('defer forces arbitration', async () => {
  const r = createReview(db, { subject: 'defer', cap: 3 });
  const [f] = await add(r.id, 1, [{ title: 'unbounded query', body: 'no LIMIT clause', severity: 'high' }]);
  dispositionFinding(db, f.id, { disposition: 'defer', evidence: 'touches >5 files' });
  assert.equal(computeDecision(db, r.id, { changesApplied: false }).exit, 'needs-arbitration');
});

test('no findings: findings-rebutted', () => {
  const r = createReview(db, { subject: 'clean', cap: 3 });
  const d = computeDecision(db, r.id, { changesApplied: false });
  assert.equal(d.error, undefined);
  assert.equal(d.exit, 'findings-rebutted');
});

test('cap reached', async () => {
  const r = createReview(db, { subject: 'cap', cap: 1 });
  const [f] = await add(r.id, 1, [{ title: 'missing null check', body: 'crashes on empty input', severity: 'critical' }]);
  dispositionFinding(db, f.id, { disposition: 'fix', evidence: 'file.js:12 added guard' });
  assert.equal(computeDecision(db, r.id, { changesApplied: true }).exit, 'review-cap-reached');
});

test('continues under cap', async () => {
  const r = createReview(db, { subject: 'continue', cap: 3 });
  const [f] = await add(r.id, 1, [{ title: 'missing null check', body: 'crashes on empty input', severity: 'critical' }]);
  dispositionFinding(db, f.id, { disposition: 'fix', evidence: 'file.js:12 added guard' });
  const d = computeDecision(db, r.id, { changesApplied: true });
  assert.equal(d.exit, null);
  assert.equal(d.nextRound, 2);
});

test('undisposed blocks the decision', async () => {
  const r = createReview(db, { subject: 'undisposed', cap: 3 });
  await add(r.id, 1, [{ title: 'unused import', body: 'dead code', severity: 'low' }]);
  assert.equal(computeDecision(db, r.id, { changesApplied: false }).error, 'undisposed');
});

test('repeat of a fix forces arbitration', async () => {
  const r = createReview(db, { subject: 'repeat', cap: 3 });
  const [f1] = await add(r.id, 1, [{ title: 'race condition on write', body: 'concurrent writes clobber state', severity: 'high' }]);
  dispositionFinding(db, f1.id, { disposition: 'fix', evidence: 'file.js:40 added lock' });
  setReviewState(db, r.id, { round: 2 });
  const [f2] = await add(r.id, 2, [{ title: 'still racy under load', body: 'the lock does not cover the read path', severity: 'high' }]);
  dispositionFinding(db, f2.id, { disposition: 'fix', evidence: 'file.js:44 widened lock', repeatOf: f1.id });
  assert.equal(computeDecision(db, r.id, { changesApplied: true }).exit, 'needs-arbitration');
});
