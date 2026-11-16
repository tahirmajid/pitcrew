import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { currentProjects, linkProject, unlinkProject, loadProjects, projectFolders, parseTier } from '../src/projects.js';
import { tmp } from './helpers.mjs';

const git = (cwd, ...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...a], { cwd, stdio: 'ignore' });
const real = p => fs.realpathSync(p);

function world() {
  const base = real(tmp());
  for (const d of ['extra/one', 'extra/two']) fs.mkdirSync(path.join(base, d), { recursive: true });
  const repo = real(tmp());
  git(repo, 'init', '-q');
  fs.mkdirSync(path.join(repo, 'app'));
  fs.mkdirSync(path.join(repo, 'web'));
  fs.writeFileSync(path.join(repo, 'app/x.txt'), 'x');
  git(repo, 'add', '.');
  git(repo, 'commit', '-qm', 'init');
  return { base, repo };
}
const names = ps => ps.map(p => p.name).sort();
const yml = (base, slug) => path.join(base, 'projects', slug, 'project.yml');

test('link_project creates the folder and project.yml, then merges', () => {
  const { base, repo } = world();
  const p = linkProject(base, { project: 'alpha', repo });
  assert.ok(fs.existsSync(yml(base, 'alpha')));
  assert.deepEqual([p.tier, p.status, p.folders], ['small', 'active', ['projects/alpha/']]);
  linkProject(base, { project: 'alpha', folders: ['extra/one'], tier: 'medium' });
  const q = linkProject(base, { project: 'alpha', folders: ['extra/one', 'extra/two'] });
  assert.deepEqual(q.folders, ['projects/alpha/', 'extra/one/', 'extra/two/']);
  assert.equal(q.tier, 'medium');
  assert.equal(q.repos.length, 1);
  assert.deepEqual(projectFolders(base, 'alpha'), q.folders);
  assert.equal(projectFolders(base, 'nope'), null);
  assert.throws(() => linkProject(base, { project: 'a', folders: ['missing'] }), /not found/);
});

test('rewrites keep comments and unknown keys; tier/level/repo aliases are read', () => {
  const { base, repo } = world();
  fs.mkdirSync(path.join(base, 'projects/beta'), { recursive: true });
  fs.writeFileSync(yml(base, 'beta'), `# keep this header\nname: beta\nlevel: 2   # old key\nrepo: ${repo}\nowner: someone\nthreads:\n  x: 1\n`);
  const before = loadProjects(base)[0];
  assert.deepEqual([before.tier, before.repos], ['medium', [repo]]);
  linkProject(base, { project: 'beta', folders: ['extra/one'], status: 'paused' });
  const text = fs.readFileSync(yml(base, 'beta'), 'utf8');
  assert.match(text, /# keep this header/);
  assert.match(text, /owner: someone/);
  assert.match(text, /threads:\n {2}x: 1/);
  assert.match(text, /^tier: medium/m);
  assert.doesNotMatch(text, /^level:/m);
  assert.doesNotMatch(text, /^repo:/m);
  assert.match(text, /^repos:/m);
  const after = loadProjects(base)[0];
  assert.deepEqual([after.tier, after.status, after.repos], ['medium', 'paused', [repo]]);
  assert.equal(parseTier(0), 'adhoc');
  assert.equal(parseTier('Large'), 'large');
  assert.throws(() => parseTier('huge'), /adhoc, small, medium, large/);
});

test('two projects on one repo are both current; subdirs narrow', () => {
  const { base, repo } = world();
  linkProject(base, { project: 'alpha', repo });
  linkProject(base, { project: 'beta', repo, subdirs: ['app'] });
  assert.deepEqual(names(currentProjects(base, repo)), ['alpha', 'beta']);
  assert.deepEqual(names(currentProjects(base, path.join(repo, 'app'))), ['beta']);
  assert.deepEqual(names(currentProjects(base, path.join(repo, 'web'))), ['alpha', 'beta']);
});

test('closed projects are not current but resolve by name; a worktree maps to the main repo', () => {
  const { base, repo } = world();
  linkProject(base, { project: 'alpha', repo });
  linkProject(base, { project: 'old', repo, status: 'closed' });
  assert.deepEqual(names(currentProjects(base, repo)), ['alpha']);
  assert.deepEqual(projectFolders(base, 'old'), ['projects/old/']);
  const wt = path.join(real(tmp()), 'wt');
  git(repo, 'worktree', 'add', '-q', wt, '-b', 'side');
  assert.deepEqual(names(currentProjects(base, wt)), ['alpha']);
  assert.deepEqual(currentProjects(base, real(tmp())), []);
});

test('unlink removes the repo or folders only and never deletes a folder', () => {
  const { base, repo } = world();
  linkProject(base, { project: 'a', repo, folders: ['extra/one', 'extra/two'] });
  unlinkProject(base, { project: 'a', folders: ['extra/one'] });
  assert.deepEqual(loadProjects(base)[0].extraFolders, ['extra/two/']);
  unlinkProject(base, { project: 'a', repo });
  assert.deepEqual(loadProjects(base)[0].repos, []);
  assert.ok(fs.existsSync(path.join(base, 'extra/one')) && fs.existsSync(yml(base, 'a')));
  assert.equal(unlinkProject(base, { project: 'zzz', folders: ['x'] }), false);
  assert.throws(() => unlinkProject(base, { project: 'a' }), /repo or folders/);
});
