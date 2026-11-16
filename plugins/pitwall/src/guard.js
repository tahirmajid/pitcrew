import fs from 'node:fs';
import path from 'node:path';

const denied = () => new Error('Access denied: path escapes the base directory.');
const inside = (root, p) => p === root || p.startsWith(root + path.sep);

/** Real path of the deepest existing ancestor plus the not-yet-existing tail; a dangling symlink is refused. */
function realish(p) {
  let cur = p, tail = '';
  for (;;) {
    try { return path.join(fs.realpathSync(cur), tail); } catch (e) {
      if (e.code !== 'ENOENT') throw denied();
      let dangling = false;
      try { fs.lstatSync(cur); dangling = true; } catch { /* absent */ }
      const up = path.dirname(cur);
      if (dangling || up === cur) throw denied();
      tail = path.join(path.basename(cur), tail);
      cur = up;
    }
  }
}

/** Resolves a base-relative path, rejecting anything that leaves the base lexically or through a symlink. */
export function guard(base, p) {
  const full = path.resolve(base, p);
  if (!inside(base, full) || !inside(realish(base), realish(full))) throw denied();
  return full;
}
