import { existsSync, readFileSync } from 'node:fs';
import { sha256 } from '../tools/fsutil.js';
import { resolveSafe } from '../workspace/safePath.js';

const isWin = process.platform === 'win32';

export class ReadTracker {
  private hashes = new Map<string, string>();

  constructor(private readonly root: string) {}

  private resolve(p: string): string | null {
    try {
      const abs = resolveSafe(this.root, p);
      return isWin ? abs.toLowerCase() : abs;
    } catch {
      return null;
    }
  }

  /** 读取或写入成功后调用：记下文件当前内容的哈希。 */
  record(p: string): void {
    const key = this.resolve(p);
    if (!key) return;
    try {
      this.hashes.set(key, sha256(readFileSync(resolveSafe(this.root, p), 'utf8')));
    } catch { /* 文件读不了就不记 */ }
  }

  expected(p: string): string | undefined {
    const key = this.resolve(p);
    return key ? this.hashes.get(key) : undefined;
  }

  exists(p: string): boolean {
    try { return existsSync(resolveSafe(this.root, p)); } catch { return false; }
  }
}
