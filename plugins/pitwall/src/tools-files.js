import fs from 'node:fs/promises';
import { statSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { SKIP_DIRS, isBinaryName } from './indexer.js';
import { guard } from './guard.js';

export { guard };

const MAX_SEARCH_FILE_BYTES = 1_000_000;
export const text = t => ({ content: [{ type: 'text', text: t }] });

/** Registers the file tools; writes keep the index in step and never fail on an index error. */
export function registerFileTools(server, { base, indexer }) {
  const G = p => guard(base, p);
  const rel = full => path.relative(base, full).split(path.sep).join('/');
  const sync = async fn => { try { await fn(); return ''; } catch (e) { return ` (index: ${e.message})`; } };
  const reindex = r => sync(() => indexer.indexFile(r));

  server.tool('list_directory', 'List files and subdirectories in a directory (relative to the base folder)', {
    directory: z.string().optional().describe('Relative path from base. Defaults to root.'),
    recursive: z.boolean().optional().describe('If true, list nested entries (skips node_modules/.git/build and binaries).'),
  }, async ({ directory = '.', recursive = false }) => {
    const MAX = 300;
    let count = 0, capped = false;
    async function listDir(dir, prefix = '') {
      const lines = [];
      for (const e of await fs.readdir(dir, { withFileTypes: true })) {
        if (count >= MAX) { capped = true; break; }
        const r = path.join(prefix, e.name);
        if (e.isDirectory()) {
          count++;
          lines.push(`${r}/`);
          if (recursive && !SKIP_DIRS.has(e.name)) lines.push(...await listDir(path.join(dir, e.name), r));
        } else {
          if (recursive && isBinaryName(e.name)) continue;
          count++;
          lines.push(`${r}  (${(statSync(path.join(dir, e.name)).size / 1024).toFixed(1)} KB)`);
        }
      }
      return lines;
    }
    const lines = await listDir(G(directory));
    return text(`./${directory}\n\n${lines.join('\n') || '(empty)'}${capped ? `\n\n... capped at ${MAX} entries; list a sub-directory.` : ''}`);
  });

  server.tool('read_file', 'Read a file, whole or a line range', {
    path: z.string().describe('Relative path from base'),
    encoding: z.enum(['utf-8', 'base64']).optional().describe('Default: utf-8'),
    offset: z.number().int().min(1).optional().describe('First line to return (1-based)'),
    limit: z.number().int().min(1).optional().describe('Number of lines to return'),
  }, async ({ path: p, encoding = 'utf-8', offset, limit }) => {
    const content = await fs.readFile(G(p), encoding);
    if (encoding === 'base64') return text(`(base64)\n${content}`);
    if (offset === undefined && limit === undefined) return text(content);
    const lines = content.split('\n');
    const start = (offset ?? 1) - 1;
    return text(lines.slice(start, limit ? start + limit : undefined).join('\n'));
  });

  server.tool('read_multiple_files', 'Read several files at once', {
    paths: z.array(z.string()).describe('Array of relative file paths'),
  }, async ({ paths }) => {
    const out = [];
    for (const fp of paths) {
      try { out.push(`--- ${fp} ---\n${await fs.readFile(G(fp), 'utf-8')}`); } catch (e) { out.push(`--- ${fp} ---\nerror: ${e.message}`); }
    }
    return text(out.join('\n\n'));
  });

  server.tool('write_file', 'Write or overwrite a file (auto-creates parent directories)', {
    path: z.string().describe('Relative path'),
    content: z.string().describe('Content to write'),
    create_dirs: z.boolean().optional().describe('Create missing parent dirs. Default: true'),
  }, async ({ path: p, content, create_dirs = true }) => {
    const full = G(p);
    if (create_dirs) await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, content, 'utf-8');
    return text(`Written ${content.length} chars to ${p}${await reindex(rel(full))}`);
  });

  server.tool('append_file', 'Append content to a file (or create it)', {
    path: z.string().describe('Relative path'),
    content: z.string().describe('Content to append'),
  }, async ({ path: p, content }) => {
    const full = G(p);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.appendFile(full, content, 'utf-8');
    return text(`Appended ${content.length} chars to ${p}${await reindex(rel(full))}`);
  });

  server.tool('edit_file', 'Surgical in-place edit: replace old_string with new_string in a file (exact literal match)', {
    path: z.string().describe('Relative path'),
    old_string: z.string().describe('Exact text to find and replace'),
    new_string: z.string().describe('Replacement text'),
    replace_all: z.boolean().optional().describe('Replace all occurrences. Default: false'),
  }, async ({ path: p, old_string, new_string, replace_all = false }) => {
    const full = G(p);
    if (old_string === new_string) return text('error: old_string and new_string must differ');
    const original = await fs.readFile(full, 'utf-8');
    const n = original.split(old_string).length - 1;
    if (n === 0) return text(`error: old_string not found in ${p}`);
    if (!replace_all && n > 1) return text(`error: old_string is not unique (${n} matches); pass replace_all:true or add more context`);
    const updated = replace_all ? original.split(old_string).join(new_string)
      : original.slice(0, original.indexOf(old_string)) + new_string + original.slice(original.indexOf(old_string) + old_string.length);
    await fs.writeFile(full, updated, 'utf-8');
    return text(`Edited ${p}: replaced ${replace_all ? n : 1} occurrence(s), ${updated.length - original.length} char delta${await reindex(rel(full))}`);
  });

  server.tool('create_directory', 'Create a directory (and any missing parents)', {
    path: z.string().describe('Relative directory path'),
  }, async ({ path: p }) => { await fs.mkdir(G(p), { recursive: true }); return text(`Directory created: ${p}`); });

  server.tool('delete_file', 'Delete a file', { path: z.string().describe('Relative file path') }, async ({ path: p }) => {
    const full = G(p);
    await fs.unlink(full);
    return text(`Deleted: ${p}${await sync(() => indexer.removeFile(rel(full)))}`);
  });

  server.tool('move_file', 'Move or rename a file or directory', {
    source: z.string().describe('Relative source path'),
    destination: z.string().describe('Relative destination path'),
  }, async ({ source, destination }) => {
    const src = G(source), dest = G(destination);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.rename(src, dest);
    const note = await sync(async () => {
      indexer.removeFile(rel(src));
      if ((await fs.stat(dest)).isDirectory()) await indexer.reconcile(); else await indexer.indexFile(rel(dest));
    });
    return text(`Moved: ${source} -> ${destination}${note}`);
  });

  server.tool('file_info', 'Get metadata about a file or directory', { path: z.string().describe('Relative path') }, async ({ path: p }) => {
    const s = await fs.stat(G(p));
    return text(JSON.stringify({
      path: p, type: s.isDirectory() ? 'directory' : 'file', size_bytes: s.size, size_kb: (s.size / 1024).toFixed(2),
      created: s.birthtime.toISOString(), modified: s.mtime.toISOString(), permissions: s.mode.toString(8),
    }, null, 2));
  });

  server.tool('search_files', 'Find files by name pattern (case-insensitive substring)', {
    pattern: z.string().describe('Substring to match against file names'),
    directory: z.string().optional().describe('Sub-directory to search. Default: root'),
  }, async ({ pattern, directory = '.' }) => {
    const matches = [], MAX = 50, needle = pattern.toLowerCase();
    let more = 0;
    async function walk(dir) {
      for (const e of await fs.readdir(dir, { withFileTypes: true })) {
        const isDir = e.isDirectory();
        if (isDir && SKIP_DIRS.has(e.name)) continue;
        if (!isDir && isBinaryName(e.name)) continue;
        if (e.name.toLowerCase().includes(needle)) {
          if (matches.length < MAX) matches.push(rel(path.join(dir, e.name)) + (isDir ? '/' : '')); else more++;
        }
        if (isDir) await walk(path.join(dir, e.name));
      }
    }
    await walk(G(directory));
    return text((matches.join('\n') || `No files matched "${pattern}"`) + (more ? `\n... +${more} more; narrow the pattern or directory.` : ''));
  });

  server.tool('search_in_files', 'Full-text search inside file contents', {
    query: z.string().describe('Text to search for'),
    directory: z.string().optional().describe('Sub-directory. Default: root'),
    file_extension: z.string().optional().describe("Limit to this extension, e.g. '.md'"),
    case_sensitive: z.boolean().optional().describe('Default: false'),
    max_files: z.number().int().min(1).max(100).optional().describe('Max files to show. Default: 15'),
    files_only: z.boolean().optional().describe('List matching paths only, no line text (cheapest). Default: false'),
  }, async ({ query, directory = '.', file_extension, case_sensitive = false, max_files = 15, files_only = false }) => {
    const results = [], MAX_LINE = 200, MAX_PER_FILE = 3, MAX_TOTAL = 20_000;
    let total = 0, more = 0, truncated = false;
    const needle = case_sensitive ? query : query.toLowerCase();
    async function walk(dir) {
      for (const e of await fs.readdir(dir, { withFileTypes: true })) {
        if (total >= MAX_TOTAL) { truncated = true; return; }
        const full = path.join(dir, e.name);
        if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) await walk(full); continue; }
        if (file_extension && !e.name.endsWith(file_extension)) continue;
        if (isBinaryName(e.name)) continue;
        try {
          guard(base, full);
          if ((await fs.stat(full)).size > MAX_SEARCH_FILE_BYTES) continue;
          const t = await fs.readFile(full, 'utf-8');
          if (t.includes('\0')) continue;
          if (!(case_sensitive ? t : t.toLowerCase()).includes(needle)) continue;
          if (results.length >= max_files) { more++; continue; }
          const r = rel(full);
          const block = files_only ? r : `${r}:\n${t.split('\n').map((l, i) => ({ l, i: i + 1 }))
            .filter(({ l }) => (case_sensitive ? l : l.toLowerCase()).includes(needle)).slice(0, MAX_PER_FILE)
            .map(({ l, i }) => { const s = l.trim(); return `  L${i}: ${s.length > MAX_LINE ? `${s.slice(0, MAX_LINE)} ...` : s}`; }).join('\n')}`;
          results.push(block);
          total += block.length;
        } catch { /* unreadable */ }
      }
    }
    await walk(G(directory));
    const notes = [];
    if (more) notes.push(`+${more} more matching file(s)`);
    if (truncated) notes.push(`output capped at ${MAX_TOTAL} chars`);
    return text((results.join(files_only ? '\n' : '\n\n') || `No matches for "${query}"`)
      + (notes.length ? `\n\n... ${notes.join('; ')}. Narrow the query/directory/extension or use files_only.` : ''));
  });
}
