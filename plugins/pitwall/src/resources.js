import path from 'node:path';
import YAML from 'yaml';
import { guard } from './guard.js';
import { editDoc, loadProjects, findProject, readDoc } from './projects.js';

const FIELDS = ['url', 'kind', 'title', 'note', 'ticket', 'added'];
const sharedFile = base => path.join(base, '.pitwall', 'resources.yml');

/** Guesses a resource kind from its URL: ticket, pr, thread, doc, else link. */
export function inferKind(url) {
  if (/linear\.app|atlassian\.net\/browse|\/jira\.|github\.com\/[^/]+\/[^/]+\/issues/i.test(url)) return 'ticket';
  if (/github\.com\/[^/]+\/[^/]+\/pull|merge_requests/i.test(url)) return 'pr';
  if (/slack\.com|teams\.microsoft\.com|teams\.live\.com/i.test(url)) return 'thread';
  if (/docs\.google\.com|notion\.(so|site)|confluence|atlassian\.net\/wiki/i.test(url)) return 'doc';
  return 'link';
}

const key = r => `${r.url}\0${r.ticket ?? ''}`;

function mutate(doc, fn) {
  let seq = doc.get('resources', true);
  if (!YAML.isSeq(seq)) { doc.set('resources', doc.createNode([])); seq = doc.get('resources', true); }
  return fn(seq, doc);
}

/** Adds a resource, or updates the one with the same url and ticket; stored in the project's project.yml, else in .pitwall/resources.yml. */
export function linkResource(base, { url, project, ticket, title, note, kind }) {
  if (!project && !ticket) throw new Error('Give a project or a ticket (or both).');
  let file = sharedFile(base);
  if (project) {
    const p = findProject(base, project);
    if (!p) throw new Error(`Unknown project "${project}"; create it with link_project first.`);
    file = path.join(base, 'projects', p.slug, 'project.yml');
  }
  guard(base, file);
  const item = { url, kind: kind || inferKind(url), title, note, ticket };
  return editDoc(file, doc => mutate(doc, seq => {
    const hit = seq.items.find(i => YAML.isMap(i) && i.get('url') === url && (i.get('ticket') ?? '') === (ticket ?? ''));
    if (hit) {
      for (const f of FIELDS) if (item[f] !== undefined && (f !== 'kind' || kind)) hit.set(f, item[f]);
      return { updated: true };
    }
    const node = {};
    for (const f of FIELDS) if (item[f] !== undefined) node[f] = item[f];
    node.added = new Date().toISOString().slice(0, 10);
    seq.add(doc.createNode(node));
    return { updated: false };
  }));
}

/** Removes matching resources (by url, narrowed by project/ticket); returns how many went. */
export function unlinkResource(base, { url, project, ticket }) {
  let files = [];
  if (project) {
    const p = findProject(base, project);
    if (p) files = [path.join(base, 'projects', p.slug, 'project.yml')];
  } else files = [sharedFile(base), ...loadProjects(base).map(p => path.join(base, 'projects', p.slug, 'project.yml'))];
  let n = 0;
  for (const f of files) {
    guard(base, f);
    const doc = readDoc(f);
    const seq = doc.get('resources', true);
    if (!YAML.isSeq(seq) || !seq.items.some(i => YAML.isMap(i) && i.get('url') === url)) continue;
    editDoc(f, d => mutate(d, s => {
      const keep = s.items.filter(i => !(YAML.isMap(i) && i.get('url') === url && (!ticket || i.get('ticket') === ticket)));
      n += s.items.length - keep.length;
      s.items = keep;
    }));
  }
  return n;
}

/** Every resource as {url, kind, title, note, ticket, added, project}, optionally filtered. */
export function listResources(base, { project, ticket, kind } = {}) {
  const out = [];
  const take = (items, proj) => { for (const r of items) out.push({ ...r, kind: r.kind || inferKind(r.url), ticket: r.ticket ? String(r.ticket) : undefined, project: proj }); };
  const projects = loadProjects(base);
  for (const p of projects) take(p.resources, p.name);
  try { take(YAML.parse(String(readDoc(guard(base, sharedFile(base))))).resources?.filter(r => r?.url) ?? [], undefined); } catch { /* none */ }
  const want = project ? findProject(base, project)?.name : null;
  return out.filter(r => (!project || r.project === want) && (!ticket || r.ticket === ticket) && (!kind || r.kind === kind));
}

const STOP = new Set('the and for with that this from what how why when where which about into your you are was were has have not but can does did use using used via per its our out any all new old get set'.split(' '));
const terms = s => (String(s ?? '').toLowerCase().match(/[\p{L}\p{N}_-]{3,}/gu) || []).filter(t => !STOP.has(t));

/** The "Linked resources:" block for a query (max 5 lines), or '' when nothing applies. */
export function resourcesBlock(base, { query, project, current = [] }) {
  const all = listResources(base);
  if (!all.length) return '';
  const tickets = new Set(query.match(/\b[A-Z][A-Z0-9]{1,9}-\d+\b/g) || []);
  const picked = new Map();
  const take = r => picked.set(`${r.url}\0${r.project ?? ''}\0${r.ticket ?? ''}`, r);
  all.filter(r => r.ticket && tickets.has(r.ticket)).forEach(take);
  if (project) { const n = findProject(base, project)?.name; all.filter(r => r.project === n).forEach(take); }
  const q = new Set(terms(query));
  const names = new Set(current.map(p => p.name));
  for (const r of all) if (names.has(r.project) && terms(`${r.title ?? ''} ${r.note ?? ''} ${r.ticket ?? ''}`).some(t => q.has(t))) take(r);
  return [...picked.values()].slice(0, 5)
    .map(r => `${r.kind} · ${r.title || r.url} — ${r.url} (${[r.project, r.ticket].filter(Boolean).join('/')})`).join('\n');
}
