import { existsSync, realpathSync } from 'node:fs';
import path from 'node:path';

export interface Workspace {
  root: string;     // 工作区根的真实路径
  hasGit: boolean;
}

export function resolveWorkspace(cwd: string): Workspace {
  const start = realpathSync.native(path.resolve(cwd));
  let dir = start;
  for (;;) {
    if (existsSync(path.join(dir, '.git'))) return { root: dir, hasGit: true };
    const parent = path.dirname(dir);
    if (parent === dir) return { root: start, hasGit: false };
    dir = parent;
  }
}
