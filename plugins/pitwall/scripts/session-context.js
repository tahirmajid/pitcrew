#!/usr/bin/env node
// Session-start hook: prints a short KB summary (<= 600 chars). No model load, no reconcile; never throws.
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { loadConfig } from '../src/config.js';
import { currentProjects } from '../src/projects.js';

const MAX = 600;

/** Builds the hook text from env and the stdin JSON string; exported for tests. */
export function sessionContext(env, stdin = '') {
  try {
    const e = { ...env };
    const set = v => (v ?? '').trim() && !/^\$\{.*\}$/.test(v.trim());
    e.PITWALL_BASE_DIR = set(e.PITWALL_BASE_DIR) ? e.PITWALL_BASE_DIR : e.CLAUDE_PLUGIN_OPTION_KB_DIR;
    let cfg;
    try { cfg = loadConfig(e); } catch (err) { return `Pitwall: ${err.message}.`.slice(0, MAX); }
    let cwd = e.CLAUDE_PROJECT_DIR;
    try { cwd ||= JSON.parse(stdin).cwd; } catch { /* no stdin */ }
    let docs = null;
    try {
      if (fs.existsSync(cfg.dbPath)) {
        const db = new DatabaseSync(cfg.dbPath, { readOnly: true });
        docs = db.prepare('SELECT COUNT(*) AS n FROM docs').get().n;
        db.close();
      }
    } catch { /* index absent or old */ }
    let projects = [];
    try { projects = currentProjects(cfg.base, cwd); } catch { /* not a repo */ }
    const lines = [`Pitwall knowledge base: ${cfg.base}${docs === null ? '' : ` (${docs} docs)`}.`];
    const tail = 'Use recall before answering from memory.';
    if (projects.length) {
      const room = MAX - lines[0].length - tail.length - 2;
      lines.push(`Current projects: ${projects.map(p => `${p.name} [${p.tier}, ${p.status}, ${p.resources.length} resources]`).join('; ')}.`.slice(0, Math.max(0, room)));
    }
    lines.push(tail);
    return lines.join('\n').slice(0, MAX);
  } catch { return ''; }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  let buf = '';
  const done = () => { process.stdout.write(`${sessionContext(process.env, buf)}\n`); process.exit(0); };
  const timer = setTimeout(done, 300);
  process.stdin.on('data', d => { buf += d; });
  process.stdin.on('end', () => { clearTimeout(timer); done(); });
  process.stdin.on('error', done);
}
