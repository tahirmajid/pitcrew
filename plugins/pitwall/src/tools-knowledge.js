import fs from 'node:fs/promises';
import path from 'node:path';
import dns from 'node:dns/promises';
import net from 'node:net';
import http from 'node:http';
import https from 'node:https';
import { z } from 'zod';
import { noteFile } from './db.js';
import { htmlToText } from './chunker.js';
import { currentProjects, projectFolders, loadProjects, findProject, linkProject, unlinkProject } from './projects.js';
import { linkResource, unlinkResource, listResources, resourcesBlock } from './resources.js';
import { queryEntities, sharedWith } from './graph.js';
import { initKb } from './scaffold.js';
import { guard, text } from './tools-files.js';
import { isBinaryName } from './indexer.js';

const MAX_BODY = 2_000_000;
const MAX_HOPS = 5;

/** True for loopback, private, link-local, CGNAT, unique-local, multicast and unspecified addresses (v4 and v6, incl. v4-mapped). */
export function blockedAddr(a) {
  if (net.isIPv4(a)) {
    const [x, y] = a.split('.').map(Number);
    return x === 0 || x === 10 || x === 127 || x >= 224 || (x === 100 && y >= 64 && y < 128) || (x === 169 && y === 254) || (x === 172 && y >= 16 && y < 32) || (x === 192 && y === 168);
  }
  const v = a.toLowerCase().split('%')[0];
  const dotted = v.match(/^::(?:ffff:)?(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) return blockedAddr(dotted[1]);
  const hex = v.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hex) { const hi = parseInt(hex[1], 16), lo = parseInt(hex[2], 16); return blockedAddr(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`); }
  return v === '::' || v === '::1' || /^f[cd]/.test(v) || /^fe[89ab]/.test(v) || v.startsWith('ff');
}

/** Resolves once and refuses when any address is non-public, so the checked address is the one connected to. */
const safeLookup = (lookup, blocked) => (host, opts, cb) => {
  lookup(host, { all: true }).then(addrs => {
    if (!addrs.length || addrs.some(a => blocked(a.address))) return cb(new Error('URL resolves to a non-public address'));
    const a = { address: addrs[0].address, family: net.isIP(addrs[0].address) };
    return opts?.all ? cb(null, [a]) : cb(null, a.address, a.family);
  }, cb);
};

/** One request without following redirects; resolves {status, location, body}. */
function getOnce(u, lookup, blocked, signal) {
  return new Promise((resolve, reject) => {
    const mod = u.protocol === 'https:' ? https : http;
    const req = mod.request(u, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; pitwall)' }, lookup: safeLookup(lookup, blocked), signal }, res => {
      const status = res.statusCode, location = res.headers.location;
      if (status >= 300 && status < 400 && location) { res.resume(); return resolve({ status, location }); }
      if (status < 200 || status >= 300) { res.resume(); return reject(new Error(`HTTP ${status}`)); }
      const chunks = [];
      let n = 0;
      res.on('data', c => {
        n += c.length;
        if (n > MAX_BODY) { req.destroy(); return reject(new Error('response larger than 2 MB')); }
        chunks.push(c);
      });
      res.on('end', () => resolve({ status, body: Buffer.concat(chunks).toString('utf8') }));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end();
  });
}

/** Fetches an http(s) page, refusing non-public hosts at every redirect hop (connecting to the address it checked) and bodies over 2 MB; returns the text. */
export async function fetchPage(url, { lookup = dns.lookup, blocked = blockedAddr } = {}) {
  const signal = AbortSignal.timeout(15_000);
  for (let hop = 0; hop <= MAX_HOPS; hop++) {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('only http and https URLs are allowed');
    const host = u.hostname.replace(/^\[|\]$/g, '');
    if (net.isIP(host) && blocked(host)) throw new Error('URL resolves to a non-public address');
    const r = await getOnce(u, lookup, blocked, signal);
    if (r.location) { url = new URL(r.location, u).href; continue; }
    return r.body;
  }
  throw new Error('too many redirects');
}

const tagsArg = z.array(z.string()).optional().describe('Optional tags');

/** Registers ingest, capture, search, listing and project tools. */
export function registerKnowledgeTools(server, ctx) {
  const { base, db, indexer, searcher, cache, embedder, cfg } = ctx;
  const scaffoldDir = ctx.scaffoldDir;
  const rel = p => p.split(path.sep).join('/');

  async function capture(r, content) {
    let full = guard(base, r), n = 1;
    const stem = full.replace(/\.md$/, '');
    await fs.mkdir(path.dirname(full), { recursive: true });
    for (;;) {
      try { await fs.writeFile(full, content, { encoding: 'utf8', flag: 'wx' }); break; } catch (e) {
        if (e.code !== 'EEXIST') throw e;
        full = guard(base, `${stem}-${++n}.md`);
      }
    }
    const out = rel(path.relative(base, full));
    let note = '';
    try { await indexer.indexFile(out); } catch (e) { note = ` (index: ${e.message})`; }
    return `${out}${note}`;
  }

  server.tool('ingest_document', 'Index a file into the knowledge base now (also assigns tags). Files are otherwise indexed automatically.', {
    path: z.string().describe("Relative file path (e.g. 'notes/topic.md')"),
    tags: tagsArg,
  }, async ({ path: p, tags }) => {
    const r0 = rel(path.relative(base, guard(base, p)));
    if (isBinaryName(r0)) return text('error: binary file type, not indexable.');
    const r = await indexer.indexFile(r0, { tags });
    if (r.skipped) return text(`error: not indexed (${r.skipped}).`);
    const d = db.prepare('SELECT title, word_count, (SELECT COUNT(*) FROM chunks WHERE doc_id = docs.id) AS n FROM docs WHERE path = ?').get(r0);
    return text(`Indexed ${r0}: "${d.title}", ${d.n} chunks, ${d.word_count} words`);
  });

  server.tool('add_note', 'Capture a note as a Markdown file (inbox/, or projects/<project>/notes/ when a project is given) and index it.', {
    content: z.string().describe('The note content to capture'),
    title: z.string().optional().describe('Optional title. Defaults to first line.'),
    project: z.string().optional().describe('File it under this project'),
    tags: tagsArg,
  }, async ({ content, title, project, tags = [] }) => {
    if (!content.trim()) return text('error: content is empty.');
    let slug;
    if (project) {
      const p = findProject(base, project);
      if (!p) return text(`error: unknown project "${project}"`);
      slug = p.slug;
    }
    const t = title || content.split('\n')[0].replace(/^#+\s*/, '').slice(0, 80).trim() || 'Note';
    const { rel: r, content: body } = noteFile({ kind: 'note', title: t, tags, text: content, date: new Date().toISOString().slice(0, 10), project: slug });
    return text(`Note saved: ${await capture(r, body)}`);
  });

  server.tool('bookmark_url', 'Fetch a URL, extract its readable text, save it under inbox/bookmarks/ and index it.', {
    url: z.string().url().describe('The URL to capture'),
    title: z.string().optional().describe('Override the auto-detected title'),
    tags: tagsArg,
  }, async ({ url, title, tags = [] }) => {
    let html;
    try {
      html = await fetchPage(url);
    } catch (e) { return text(`error: failed to fetch URL: ${e.message}`); }
    const body = htmlToText(html);
    if (body.length < 100) return text('error: page content too short to index.');
    const t = title || html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim() || url;
    const { rel: r, content } = noteFile({ kind: 'url', title: t, url, tags, text: body });
    return text(`Bookmark saved: ${await capture(r, content)}`);
  });

  async function resolveScope({ scope = 'auto', project }) {
    if (project) {
      const f = projectFolders(base, project);
      if (!f) throw new Error(`Unknown project "${project}". Known: ${loadProjects(base).map(p => p.name).join(', ') || '(none)'}`);
      return { filterFolders: f };
    }
    if (scope === 'all') return {};
    const cur = currentProjects(base, await ctx.projectDir());
    const folders = [...new Set(cur.flatMap(p => p.folders))];
    if (scope === 'project') return { filterFolders: folders, noProject: !folders.length, cur };
    return folders.length ? { boostFolders: folders, cur } : { cur };
  }

  async function run(query, { limit, tags, scope, path: pathPrefix, project, compact, explain, type, expand }) {
    let sc;
    try { sc = await resolveScope({ scope, project }); } catch (e) { return text(`error: ${e.message}`); }
    if (sc.noProject) return text('No project is linked for this session; use link_project or scope "all".');
    await indexer.refreshIfStale().catch(() => {});
    const hits = await searcher.search(query, { limit, tags, pathPrefix, type, expand, rerank: cfg.rerank, compact, filterFolders: sc.filterFolders, boostFolders: sc.boostFolders });
    const block = resourcesBlock(base, { query, project, current: sc.cur || [] });
    const tailBlock = block ? `\n\nLinked resources:\n${block}` : '';
    if (!hits.length) return text(`No results for: "${query}"${tailBlock}`);
    const sc2 = h => (explain ? ` (score ${h.score.toFixed(4)})` : '');
    return text(hits.map((h, i) => compact
      ? `• ${h.path}:${h.startLine}-${h.endLine} — ${h.snippet.replace(/\s+/g, ' ')}${sc2(h)}`
      : `${i + 1}. ${h.title} — ${h.path}:${h.startLine}-${h.endLine}${h.heading ? ` · ${h.heading}` : ''}${sc2(h)}\n${h.snippet}`).join(compact ? '\n' : '\n\n') + tailBlock);
  }

  const searchArgs = {
    query: z.string().describe('What you want to find: natural language or keywords/identifiers'),
    tags: z.array(z.string()).optional().describe('Filter to docs with these tags'),
    type: z.string().optional().describe('Filter to docs whose frontmatter type matches (e.g. playbook)'),
    scope: z.enum(['auto', 'project', 'all']).optional().describe("auto boosts the current project's folders (default); project filters to them; all disables both"),
    path: z.string().optional().describe('Only docs under this folder (base-relative)'),
    project: z.string().optional().describe('Only docs in this linked project'),
    expand: z.boolean().optional().describe('Add docs related through shared tickets, identifiers and links (graph expansion); overrides PITWALL_GRAPH'),
    explain: z.boolean().optional().describe('Show scores'),
  };

  server.tool('semantic_search', 'Search the knowledge base by meaning and keywords (hybrid BM25 + vector + entity graph). Hits are path:lines plus the most relevant lines.', {
    ...searchArgs, limit: z.number().int().min(1).max(20).optional().describe('Max results. Default: 5'),
  }, a => run(a.query, { ...a, limit: a.limit ?? 5 }));

  server.tool('recall', 'Retrieve knowledge about a topic. compact=true gives one line per hit.', {
    ...searchArgs, limit: z.number().int().min(1).max(10).optional().describe('Max results. Default: 4'),
    compact: z.boolean().optional().describe('One line per hit. Default: false'),
  }, a => run(a.query, { ...a, limit: a.limit ?? 4 }));

  server.tool('related_knowledge', 'Find docs related to a topic, a doc path, or an entity (ticket id, identifier): shared rare entities and links first, then similar content. Each item says why it is related.', {
    topic: z.string().optional().describe('A topic or phrase'),
    path: z.string().optional().describe('A doc path (base-relative)'),
    entity: z.string().optional().describe('A ticket id, PR ref or identifier; returns every doc mentioning it plus its linked resources'),
    limit: z.number().int().min(1).max(10).optional().describe('Max results. Default: 5'),
  }, async ({ topic, path: docPath, entity, limit = 5 }) => {
    const c = cache.get();
    if (!c.n) return text('Knowledge base is empty.');
    const g = c.graph();
    const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);
    const lines = [], seen = new Set();
    const addDoc = (id, why) => { if (id && !seen.has(id)) { seen.add(id); lines.push(`• ${c.docs.get(id).path} — ${c.docs.get(id).title} (${why})`); } };
    let tickets = new Set();
    let q = entity ?? (topic && /^[A-Z][A-Z0-9]{1,9}-\d+$/.test(topic.trim()) ? topic.trim() : null);
    if (q) {
      if (/^[A-Z][A-Z0-9]{1,9}-\d+$/.test(q)) tickets.add(q);
      const ids = g.nameIdx.get(q) || [];
      const docs = new Map();
      for (const e of ids) for (const [d, n] of g.entDocs.get(e)) docs.set(d, (docs.get(d) || 0) + n);
      [...docs].sort((a, b) => b[1] - a[1]).forEach(([d]) => addDoc(d, `mentions ${q}`));
    } else if (docPath) {
      const self = g.byPath.get(docPath.replace(/^\.?\//, ''));
      if (!self) return text(`error: not indexed: ${docPath}`);
      seen.add(self);
      for (const e of g.docEnts.get(self) || []) if (g.names.get(e).kind === 'ticket') tickets.add(g.names.get(e).name);
      for (const d of g.out.get(self) || []) addDoc(d, 'links to');
      for (const d of g.inn.get(self) || []) addDoc(d, 'linked from');
      for (const r of sharedWith(g, self).slice(0, limit)) addDoc(r.docId, `shares ${r.names.slice(0, 3).join(', ')}`);
      const m = c.docMeans().get(self);
      if (m) [...c.docMeans()].filter(([id]) => id !== self).map(([id, v]) => [id, dot(m, v)]).sort((a, b) => b[1] - a[1]).slice(0, limit)
        .forEach(([id, sc]) => addDoc(id, `similar ${sc.toFixed(2)}`));
    } else if (topic) {
      const ids = queryEntities(g, topic);
      const docs = new Map();
      for (const e of ids) { if (g.names.get(e).kind === 'ticket') tickets.add(g.names.get(e).name); for (const [d] of g.entDocs.get(e)) docs.set(d, [...(docs.get(d) || []), g.names.get(e).name]); }
      [...docs].sort((a, b) => b[1].length - a[1].length).forEach(([d, n]) => addDoc(d, `mentions ${n.slice(0, 3).join(', ')}`));
      const qv = await embedder.embedQuery(topic);
      [...c.docMeans()].map(([id, v]) => [id, dot(qv, v)]).sort((a, b) => b[1] - a[1]).slice(0, limit)
        .forEach(([id, sc]) => addDoc(id, `similar ${sc.toFixed(2)}`));
    } else return text('error: give one of topic, path or entity.');
    const shown = q ? lines : lines.slice(0, limit * 3);
    const res = listResources(base).filter(r => r.ticket && tickets.has(r.ticket)).slice(0, 5)
      .map(r => `${r.kind} · ${r.title || r.url} — ${r.url} (${[r.project, r.ticket].filter(Boolean).join('/')})`);
    return text((shown.join('\n') || 'Nothing related found.') + (res.length ? `\n\nLinked resources:\n${res.join('\n')}` : ''));
  });

  server.tool('list_knowledge', 'List indexed docs with stats. source_type: note = inbox/ and project notes, url = bookmarks, file = everything else.', {
    source_type: z.enum(['file', 'note', 'url']).optional().describe('Filter by kind'),
    limit: z.number().int().min(1).max(100).optional().describe('Max entries. Default: 50'),
  }, async ({ source_type, limit = 50 }) => {
    const kind = p => (p.includes('bookmarks/') ? 'url' : p.startsWith('inbox/') || p.startsWith('notes/') || /^projects\/[^/]+\/notes\//.test(p) ? 'note' : 'file');
    const stats = db.prepare('SELECT COUNT(*) AS docs, (SELECT COUNT(*) FROM chunks) AS chunks, (SELECT COUNT(*) FROM links) AS links, (SELECT COUNT(*) FROM entities) AS entities FROM docs').get();
    const rows = db.prepare(`SELECT d.id, d.path, d.title, d.tags, d.word_count, (SELECT COUNT(*) FROM chunks WHERE doc_id = d.id) AS n,
      (SELECT COUNT(*) FROM mentions WHERE doc_id = d.id) AS ents, (SELECT COUNT(*) FROM links WHERE src_doc = d.id) AS lnk
      FROM docs d ORDER BY d.updated_at DESC`).all().filter(r => !source_type || kind(r.path) === source_type).slice(0, limit);
    if (!rows.length) return text('No knowledge indexed yet.');
    const tg = r => { const t = JSON.parse(r.tags || '[]'); return t.length ? ` [${t.join(', ')}]` : ''; };
    return text(`${stats.docs} docs, ${stats.chunks} chunks, ${stats.links} links, ${stats.entities} entities\n\n${rows.map(r => `${r.path} — ${r.title}${tg(r)} · ${r.n} chunks · ${r.word_count} words · ${r.ents} entities · ${r.lnk} links`).join('\n')}`);
  });

  server.tool('forget_knowledge', 'Remove a doc from the index and add it to .pitwall/ignore so it stays out. The file itself is kept.', {
    entry_id: z.string().describe('Doc id or path (see list_knowledge)'),
  }, async ({ entry_id }) => {
    const row = /^\d+$/.test(entry_id) ? db.prepare('SELECT path FROM docs WHERE id = ?').get(Number(entry_id)) : db.prepare('SELECT path FROM docs WHERE path = ?').get(entry_id);
    if (!row) return text(`error: not found: ${entry_id}`);
    const ignoreFile = guard(base, '.pitwall/ignore');
    await fs.mkdir(guard(base, '.pitwall'), { recursive: true });
    indexer.removeFile(row.path);
    const prev = await fs.readFile(ignoreFile, 'utf8').catch(() => '');
    await fs.appendFile(ignoreFile, `${prev && !prev.endsWith('\n') ? '\n' : ''}/${row.path}\n`);
    return text(`Removed ${row.path} from the index and added it to .pitwall/ignore.`);
  });

  server.tool('reindex', 'Re-scan the folder and update the index (rebuild=true wipes and rebuilds).', {
    rebuild: z.boolean().optional().describe('Wipe and rebuild everything. Default: false'),
  }, async ({ rebuild = false }) => {
    const r = rebuild ? await indexer.rebuild() : await indexer.reconcile();
    return text(`Indexed ${r.indexed}, removed ${r.removed}, unchanged ${r.unchanged} in ${r.ms} ms`);
  });

  server.tool('init_kb', 'Create the standard knowledge-base layout (projects/, reference/, playbooks/, inbox/, archive/ and starter files) in the base folder. Never overwrites an existing file.', {}, async () => {
    try {
      const r = initKb(base, scaffoldDir);
      return text(`Created ${r.created} file(s), skipped ${r.skipped} existing.`);
    } catch (e) { return text(`error: ${e.message}`); }
  });

  const fmtProject = (p, cur) => `${cur.has(p.name) ? '* ' : '  '}${p.name} [${p.tier}, ${p.status}]\n    repos: ${p.repos.join(', ') || '-'}\n    folders: ${p.folders.join(', ')}\n    resources: ${p.resources.length}${p.subdirs.length ? `\n    subdirs: ${p.subdirs.join(', ')}` : ''}`;

  server.tool('link_project', 'Create or extend a project (projects/<slug>/project.yml): link a repo and extra knowledge folders so search boosts them when working in that repo.', {
    project: z.string().describe('Project name'),
    repo: z.string().optional().describe('Path inside a git repo to link (worktrees map to the main repo)'),
    subdirs: z.array(z.string()).optional().describe('Repo subdirectories that narrow this project when the session is inside one'),
    folders: z.array(z.string()).optional().describe('Extra base-relative knowledge folders (the project folder itself is always included)'),
    tier: z.union([z.string(), z.number()]).optional().describe('adhoc | small | medium | large (or 0-3). Default: small'),
    status: z.enum(['active', 'paused', 'closed']).optional().describe('closed projects are not auto-boosted'),
  }, async a => {
    try {
      const e = linkProject(base, a);
      return text(`Linked ${e.name} [${e.tier}, ${e.status}]: ${e.folders.length} folder(s), ${e.repos.length} repo(s)`);
    } catch (e) { return text(`error: ${e.message}`); }
  });

  server.tool('unlink_project', 'Remove a repo link and/or extra folders from a project. Never deletes a folder or the project.', {
    project: z.string(), repo: z.string().optional(), folders: z.array(z.string()).optional(),
  }, async a => {
    try { return text(unlinkProject(base, a) ? `Updated ${a.project}` : `error: unknown project ${a.project}`); } catch (e) { return text(`error: ${e.message}`); }
  });

  server.tool('list_projects', 'List projects with tier, status, repos, folders and resource count; * marks those matching this session.', {}, async () => {
    const all = loadProjects(base);
    const cur = new Set(currentProjects(base, await ctx.projectDir()).map(p => p.name));
    return text(all.length ? all.map(p => fmtProject(p, cur)).join('\n') : 'No projects yet.');
  });

  const fmtRes = r => `${r.kind} · ${r.title || r.url} — ${r.url} (${[r.project, r.ticket].filter(Boolean).join('/') || '-'})`;

  server.tool('link_resource', 'Record a URL (ticket, PR, thread, doc, link) against a project and/or ticket id so recall can surface it. Only stores the reference: the server never fetches the URL.', {
    url: z.string().url(),
    project: z.string().optional().describe('Store in this project'),
    ticket: z.string().optional().describe('Ticket id this belongs to (alone: stored in .pitwall/resources.yml)'),
    title: z.string().optional(), note: z.string().optional(),
    kind: z.enum(['ticket', 'pr', 'thread', 'doc', 'link']).optional().describe('Inferred from the URL when omitted'),
  }, async a => {
    try {
      const r = linkResource(base, a);
      return text(`${r.updated ? 'Updated' : 'Linked'} ${a.url}`);
    } catch (e) { return text(`error: ${e.message}`); }
  });

  server.tool('unlink_resource', 'Remove a linked resource by URL (narrow with project and/or ticket).', {
    url: z.string(), project: z.string().optional(), ticket: z.string().optional(),
  }, async a => text(`Removed ${unlinkResource(base, a)} resource(s)`));

  server.tool('list_resources', 'List linked resources, optionally filtered by project, ticket or kind.', {
    project: z.string().optional(), ticket: z.string().optional(), kind: z.enum(['ticket', 'pr', 'thread', 'doc', 'link']).optional(),
  }, async a => {
    const rs = listResources(base, a);
    return text(rs.length ? rs.map(fmtRes).join('\n') : 'No resources.');
  });
}
