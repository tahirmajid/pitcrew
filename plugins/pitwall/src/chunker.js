export const CHUNKER_VERSION = 1;

const TARGET = 1600;
const HARD_MAX = 2400;
const MIN_CHUNK = 200;
const OVERLAP = Math.round(TARGET * 0.1);

/** Splits leading YAML frontmatter off; returns the title/tags it declares and the line it ends on (0 if none). */
export function parseFrontmatter(text) {
  const lines = text.split('\n');
  const out = { title: null, tags: [], type: null, project: null, status: null, endLine: 0 };
  if (lines[0].trim() !== '---') return out;
  let end = -1;
  for (let i = 1; i < Math.min(lines.length, 60); i++) if (lines[i].trim() === '---') { end = i; break; }
  if (end < 0) return out;
  out.endLine = end + 1;
  const unq = s => { s = s.trim(); if (/^".*"$/.test(s)) { try { return JSON.parse(s); } catch { /* fall through */ } } return s.replace(/^['"]|['"]$/g, ''); };
  for (let i = 1; i < end; i++) {
    const m = lines[i].match(/^(title|tags|type|project|status)\s*:\s*(.*)$/);
    if (!m) continue;
    if (m[1] !== 'tags') { out[m[1]] = unq(m[2]) || null; continue; }
    const v = m[2].trim();
    if (v) out.tags = v.replace(/^\[|\]$/g, '').split(',').map(unq).filter(Boolean);
    else for (let j = i + 1; j < end && /^\s*-\s+/.test(lines[j]); j++) out.tags.push(unq(lines[j].replace(/^\s*-\s+/, '')));
  }
  return out;
}

/** Derives a title: frontmatter title, first Markdown heading, then the file name. */
export function extractTitle(text, filePath) {
  const fm = parseFrontmatter(text);
  if (fm.title) return fm.title;
  if (!filePath || /\.md$/i.test(filePath)) {
    const body = text.split('\n').slice(fm.endLine).join('\n').replace(/^(```|~~~)[\s\S]*?^\1/gm, '');
    const heading = body.match(/^#{1,3}\s+(.+)$/m);
    if (heading) return heading[1].trim().replace(/[*_`#]/g, '');
  }
  if (filePath) return (filePath.split('/').pop() || filePath).replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ');
  return 'Untitled';
}

/** Strips HTML tags and decodes common entities. */
export function htmlToText(html) {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s{3,}/g, '\n\n')
    .trim();
}

/** Lists link targets: wikilink names and base-relative paths of relative Markdown links. */
export function extractLinks(text, relPath) {
  const body = text.replace(/^(```|~~~)[\s\S]*?^\1/gm, '');
  const out = new Set();
  for (const m of body.matchAll(/\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]/g)) out.add(m[1].trim());
  const dir = relPath.includes('/') ? relPath.slice(0, relPath.lastIndexOf('/')) : '';
  for (const m of body.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
    const t = m[1].split('#')[0];
    if (!t || /^[a-z][a-z0-9+.-]*:/i.test(t) || t.startsWith('/')) continue;
    let target = t;
    try { target = decodeURI(t); } catch { /* keep the raw target */ }
    const parts = (dir ? dir.split('/') : []).concat(target.split('/'));
    const stack = [];
    for (const p of parts) { if (p === '..') stack.pop(); else if (p && p !== '.') stack.push(p); }
    if (stack.length) out.add(stack.join('/'));
  }
  return [...out];
}

/** Text that is embedded for a chunk: title and heading path on top of the chunk body. */
export function embedText(title, chunk) {
  return `${title}${chunk.heading ? ` > ${chunk.heading}` : ''}\n${chunk.text}`;
}

function splitLongLine(line) {
  const out = [];
  for (let i = 0; i < line.length; i += HARD_MAX) out.push(line.slice(i, i + HARD_MAX));
  return out;
}

function parseBlocks(lines, firstLine, markdown) {
  const blocks = [];
  const heads = [];
  let i = firstLine;
  const isBlank = l => !l.trim();
  while (i < lines.length) {
    const line = lines[i];
    if (isBlank(line)) { i++; continue; }
    const start = i;
    let type = 'para';
    let heading = null;
    if (markdown) {
      const fence = line.match(/^\s*(```|~~~)/);
      const h = line.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/);
      if (fence) {
        type = 'fence'; i++;
        while (i < lines.length && !new RegExp(`^\\s*${fence[1]}`).test(lines[i])) i++;
        i = Math.min(i + 1, lines.length);
      } else if (h) {
        type = 'heading'; i++;
        while (heads.length && heads[heads.length - 1].level >= h[1].length) heads.pop();
        heads.push({ level: h[1].length, text: h[2] });
        heading = heads.map(x => x.text).join(' > ');
      } else if (/^\s*\|/.test(line)) {
        type = 'table'; i++;
        while (i < lines.length && /^\s*\|/.test(lines[i])) i++;
      }
    }
    if (type === 'para') {
      i++;
      while (i < lines.length && !isBlank(lines[i]) && !(markdown && /^\s*(```|~~~|#{1,6}\s|\|)/.test(lines[i]))) i++;
    }
    blocks.push({ type, start, end: i - 1, heading, path: heads.map(x => x.text).join(' > ') });
  }
  return blocks;
}

/** Splits text into {text, heading, startLine, endLine} chunks (1-based lines); Markdown-aware when `markdown`. */
export function chunkText(text, { markdown = true } = {}) {
  const lines = text.replace(/\r\n/g, '\n').replace(/\t/g, '  ').split('\n');
  const fm = markdown ? parseFrontmatter(lines.join('\n')) : { endLine: 0 };
  const blocks = parseBlocks(lines, fm.endLine, markdown);
  const len = (s, e) => { let n = 0; for (let k = s; k <= e; k++) n += lines[k].length + 1; return n; };
  const chunks = [];
  const emit = (s, e, heading) => {
    const t = lines.slice(s, e + 1).join('\n').trim();
    if (t) chunks.push({ text: t, heading, startLine: s + 1, endLine: e + 1 });
  };
  let cur = null;
  const flush = () => { if (cur) { emit(cur.s, cur.e, cur.heading); cur = null; } };

  for (const b of blocks) {
    if (b.type === 'heading' && cur && len(cur.s, cur.e) >= MIN_CHUNK) flush();
    const bl = len(b.start, b.end);
    if (bl > HARD_MAX) {
      flush();
      let s = b.start;
      let acc = 0;
      for (let k = b.start; k <= b.end; k++) {
        const l = lines[k].length + 1;
        if (l > HARD_MAX) {
          if (acc) { emit(s, k - 1, b.path); acc = 0; }
          for (const piece of splitLongLine(lines[k])) chunks.push({ text: piece, heading: b.path, startLine: k + 1, endLine: k + 1 });
          s = k + 1;
          continue;
        }
        if (acc + l > TARGET && acc) { emit(s, k - 1, b.path); s = k; acc = 0; }
        acc += l;
      }
      if (acc) emit(s, b.end, b.path);
      continue;
    }
    if (cur && len(cur.s, cur.e) + bl > TARGET) {
      const prev = cur;
      flush();
      if (b.type !== 'heading' && prev.lastType === 'para' && prev.path === b.path) {
        let ov = prev.e + 1, n = 0;
        for (let k = prev.e; k >= prev.lastStart; k--) { n += lines[k].length + 1; if (n > OVERLAP) break; ov = k; }
        if (ov <= prev.e) cur = { s: ov, e: ov - 1, heading: b.path, path: b.path };
      }
    }
    if (!cur) cur = { s: b.start, e: b.end, heading: b.path, path: b.path };
    cur.e = b.end;
    cur.lastType = b.type;
    cur.lastStart = b.start;
    cur.path = b.path;
  }
  flush();
  return chunks;
}
