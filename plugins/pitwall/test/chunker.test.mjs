import test from 'node:test';
import assert from 'node:assert/strict';
import { chunkText, extractLinks, parseFrontmatter } from '../src/chunker.js';

const lines = n => Array.from({ length: n }, (_, i) => `line ${i} of some filler prose that takes up room`).join('\n');

test('code fence with a blank line stays in one chunk', () => {
  const t = `# T\n\n${lines(40)}\n\n\`\`\`js\nconst a = 1;\n\nconst b = 2;\n\`\`\`\n\n${lines(40)}`;
  const holder = chunkText(t, { markdown: true }).filter(c => c.text.includes('const a'));
  assert.equal(holder.length, 1);
  assert.ok(holder[0].text.includes('const b'));
});

test('table stays whole', () => {
  const t = `# T\n\n| a | b |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |\n`;
  const c = chunkText(t, { markdown: true });
  assert.ok(c.some(x => x.text.includes('| 1 | 2 |') && x.text.includes('| 3 | 4 |')));
});

test('heading path and 1-based line ranges', () => {
  const t = `# Top\n\n${lines(30)}\n\n## Sub\n\n${lines(30)}`;
  const chunks = chunkText(t, { markdown: true });
  assert.ok(chunks.length >= 2);
  assert.equal(chunks[0].startLine, 1);
  const sub = chunks.find(c => c.text.includes('## Sub'));
  assert.match(sub.heading, /Sub/);
  const all = t.split('\n');
  for (const c of chunks) assert.ok(c.startLine >= 1 && c.endLine <= all.length && c.startLine <= c.endLine);
});

test('frontmatter title and tags', () => {
  const fm = parseFrontmatter('---\ntitle: Hello\ntags: [a, b]\n---\nbody');
  assert.equal(fm.title, 'Hello');
  assert.deepEqual(fm.tags, ['a', 'b']);
});

test('wikilinks and relative links resolve to base-relative paths, fences ignored', () => {
  const l = extractLinks('See [[other]] and [x](../b/c.md)\n```\n[[ignored]]\n```', 'a/d.md');
  assert.ok(l.some(p => p.includes('other')));
  assert.ok(l.includes('b/c.md'));
  assert.ok(!l.some(p => p.includes('ignored')));
});
