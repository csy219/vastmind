import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');

export function atomicWrite(abs: string, content: string): void {
  const dir = path.dirname(abs);
  mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(abs)}.${randomUUID()}.tmp`);
  try {
    writeFileSync(tmp, content, 'utf8');
    renameSync(tmp, abs);
  } catch (e) {
    try { unlinkSync(tmp); } catch { /* 临时文件可能没建成 */ }
    throw e;
  }
}
