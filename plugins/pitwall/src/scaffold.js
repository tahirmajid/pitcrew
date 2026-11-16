import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { guard } from './guard.js';

export const SCAFFOLD_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'scaffold', 'kb');

/** Copies the scaffold tree into `base` without overwriting; returns {created, skipped} file counts. */
export function initKb(base, from = SCAFFOLD_DIR) {
  if (!fs.existsSync(from)) throw new Error(`scaffold not found: ${from}`);
  let created = 0, skipped = 0;
  const rec = rel => {
    for (const e of fs.readdirSync(path.join(from, rel), { withFileTypes: true })) {
      const r = path.join(rel, e.name);
      if (e.isDirectory()) { fs.mkdirSync(guard(base, r), { recursive: true }); rec(r); continue; }
      const dst = guard(base, r);
      if (fs.existsSync(dst)) { skipped++; continue; }
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(path.join(from, r), dst);
      created++;
    }
  };
  rec('');
  return { created, skipped };
}
