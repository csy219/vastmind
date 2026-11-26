import { lstatSync, realpathSync } from 'node:fs';
import path from 'node:path';

export class PathEscapeError extends Error {
  constructor(public readonly requested: string, public readonly workspaceRoot: string) {
    super(`路径越出工作区: ${requested}`);
    this.name = 'PathEscapeError';
  }
}

const isWin = process.platform === 'win32';
const norm = (p: string) => (isWin ? p.toLowerCase() : p);

function isInside(root: string, target: string): boolean {
  const rel = path.relative(norm(root), norm(target));
  if (rel === '') return true;
  if (rel === '..' || rel.startsWith('..' + path.sep)) return false;
  return !path.isAbsolute(rel);   // Windows 下跨盘符时 relative 会返回绝对路径
}

// 目标可能还不存在（新建文件）：找最近的已存在祖先，取其真实路径，再接回剩余部分。
function realpathDeep(p: string): string {
  const rest: string[] = [];
  let cur = p;
  for (;;) {
    let exists = true;
    try {
      lstatSync(cur);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      exists = false;
    }
    if (exists) {
      // 悬空链接会在这里抛 ENOENT，向上传播，由调用方按越界处理（宁可错杀）
      return path.join(realpathSync.native(cur), ...rest.reverse());
    }
    const parent = path.dirname(cur);
    if (parent === cur) return p;
    rest.push(path.basename(cur));
    cur = parent;
  }
}

export function resolveSafe(workspaceRoot: string, requested: string): string {
  const root = realpathSync.native(workspaceRoot);
  const abs = path.resolve(root, requested);
  let real: string;
  try {
    real = realpathDeep(abs);
  } catch {
    throw new PathEscapeError(requested, root);
  }
  if (!isInside(root, real)) throw new PathEscapeError(requested, root);
  return real;
}
