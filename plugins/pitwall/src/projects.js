import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import YAML from 'yaml';
import { guard } from './guard.js';

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
const real = p => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };

export const slugify = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'project';
const ymlPath = (base, slug) => path.join(base, 'projects', slug, 'project.yml');

/** Parses a YAML file into a Document (empty when the file is absent); throws on syntax errors. */
export function readDoc(file) {
  const doc = fs.existsSync(file) ? YAML.parseDocument(fs.readFileSync(file, 'utf8')) : new YAML.Document({});
  if (doc.errors.length) throw new Error(`${file}: ${doc.errors[0].message}`);
  if (!YAML.isMap(doc.contents)) doc.contents = doc.createNode({});
  return doc;
}

/** Applies fn to the file's Document and writes it back atomically (comments and unknown keys survive). */
export function editDoc(file, fn) {
  const doc = readDoc(file);
  const r = fn(doc);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${randomBytes(8).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, String(doc), { flag: 'wx' });
  fs.renameSync(tmp, file);
  return r;
}

/** Resolves a directory to its main repo root (git worktrees map to the main checkout) and its path inside the working tree. */
export function repoOf(dir) {
  const d = real(dir);
  try {
    const common = git(d, 'rev-parse', '--path-format=absolute', '--git-common-dir');
    const top = real(git(d, 'rev-parse', '--show-toplevel'));
    const root = path.basename(common) === '.git' ? path.dirname(common) : common;
    return { root: real(root), rel: path.relative(top, d).split(path.sep).join('/') };
  } catch {
    return { root: d, rel: '' };
  }
}

export const TIERS = ['adhoc', 'small', 'medium', 'large'];
export const STATUSES = ['active', 'paused', 'closed'];

/** Normalizes a tier name or 0-3 index to its name; throws listing the allowed values. */
export function parseTier(v) {
  const name = typeof v === 'number' || /^\d$/.test(String(v)) ? TIERS[Number(v)] : String(v).toLowerCase();
  if (!TIERS.includes(name)) throw new Error(`Unknown tier "${v}". Allowed: ${TIERS.join(', ')} (or 0-3).`);
  return name;
}

const normFolder = f => `${f.replace(/\\/g, '/').replace(/^\.?\/+/, '').replace(/\/+$/, '')}/`;
const arr = v => (v === undefined || v === null ? [] : Array.isArray(v) ? v.map(String) : [String(v)]);
const union = (a = [], b = []) => [...new Set([...a, ...b])];
const inside = (rel, prefix) => rel === prefix || rel.startsWith(`${prefix.replace(/\/$/, '')}/`);

/** Every project that has a `projects/<slug>/project.yml`, normalized; unreadable files are skipped. */
export function loadProjects(base) {
  const root = path.join(base, 'projects');
  let slugs = [];
  try { slugs = fs.readdirSync(root, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name).sort(); } catch { /* none */ }
  const out = [];
  for (const slug of slugs) {
    let y;
    try { y = YAML.parse(fs.readFileSync(guard(base, ymlPath(base, slug)), 'utf8')) ?? {}; } catch { continue; }
    if (typeof y !== 'object' || Array.isArray(y)) continue;
    let tier = 'small';
    try { tier = parseTier(y.tier ?? y.level ?? 'small'); } catch { /* default */ }
    out.push({
      slug, name: String(y.name ?? slug), tier,
      status: STATUSES.includes(y.status) ? y.status : 'active',
      repos: union(arr(y.repos), arr(y.repo)),
      subdirs: arr(y.subdirs),
      extraFolders: arr(y.folders).map(normFolder),
      folders: union([`projects/${slug}/`], arr(y.folders).map(normFolder)),
      resources: Array.isArray(y.resources) ? y.resources.filter(r => r && typeof r === 'object' && r.url) : [],
    });
  }
  return out;
}

/** Finds a project by name or slug. */
export const findProject = (base, name) => loadProjects(base).find(p => p.name === name || p.slug === name || p.slug === slugify(name)) ?? null;

/** Active/paused projects whose repos contain the session's main repo, narrowed by `subdirs` when the session dir sits in one. */
export function currentProjects(base, dir) {
  if (!dir) return [];
  const { root, rel } = repoOf(dir);
  const matches = loadProjects(base).filter(p => p.status !== 'closed' && p.repos.some(r => real(r) === root));
  const narrowed = matches.filter(m => m.subdirs.some(s => inside(rel, s)));
  return narrowed.length ? narrowed : matches;
}

/** Folders (with trailing slash) of the named project, or null when unknown. */
export const projectFolders = (base, name) => findProject(base, name)?.folders ?? null;

function setList(doc, key, list) {
  const cur = doc.get(key, true);
  if (YAML.isSeq(cur)) {
    const have = cur.items.map(i => String(i.value ?? i));
    cur.items = cur.items.filter(i => list.includes(String(i.value ?? i)));
    for (const v of list) if (!have.includes(v)) cur.add(v);
  } else doc.set(key, list);
}

/** Creates or merges `projects/<slug>/project.yml`; returns the normalized project. */
export function linkProject(base, { project, folders = [], repo, repos, subdirs = [], tier, level, status }) {
  const t = tier ?? level;
  const tierName = t === undefined || t === null ? null : parseTier(t);
  if (status !== undefined && !STATUSES.includes(status)) throw new Error(`Unknown status "${status}". Allowed: ${STATUSES.join(', ')}.`);
  const norm = folders.map(normFolder);
  const missing = norm.filter(f => {
    try { const full = guard(base, f); return !fs.existsSync(full) || !fs.statSync(full).isDirectory(); } catch { return true; }
  });
  if (missing.length) throw new Error(`Folders not found under the base directory: ${missing.join(', ')}`);
  const cur = findProject(base, project);
  const slug = cur?.slug ?? slugify(project);
  fs.mkdirSync(path.dirname(guard(base, ymlPath(base, slug))), { recursive: true });
  editDoc(ymlPath(base, slug), doc => {
    if (!doc.has('name') && slug !== project) doc.set('name', project);
    if (tierName || !doc.has('tier')) doc.set('tier', tierName ?? cur?.tier ?? 'small');
    doc.delete('level');
    if (status) doc.set('status', status);
    const newRepos = [...arr(repo), ...arr(repos)].map(r => repoOf(r).root);
    if (newRepos.length || doc.has('repo')) { setList(doc, 'repos', union(cur?.repos, newRepos)); doc.delete('repo'); }
    if (subdirs.length) setList(doc, 'subdirs', union(cur?.subdirs, subdirs.map(s => s.replace(/^\.?\/+|\/+$/g, ''))));
    if (norm.length) setList(doc, 'folders', union(cur?.extraFolders, norm));
  });
  return findProject(base, slug);
}

/** Removes the listed repo and/or extra folders from a project (never deletes a folder); returns false if unknown. */
export function unlinkProject(base, { project, repo, folders }) {
  const cur = findProject(base, project);
  if (!cur) return false;
  if (!repo && !folders?.length) throw new Error('Give a repo or folders to unlink.');
  guard(base, ymlPath(base, cur.slug));
  editDoc(ymlPath(base, cur.slug), doc => {
    if (repo) {
      const root = repoOf(repo).root;
      setList(doc, 'repos', cur.repos.filter(r => real(r) !== root));
      doc.delete('repo');
    }
    if (folders?.length) {
      const drop = new Set(folders.map(normFolder));
      setList(doc, 'folders', cur.extraFolders.filter(f => !drop.has(f)));
    }
  });
  return true;
}
