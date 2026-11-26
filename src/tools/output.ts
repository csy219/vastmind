import { mkdirSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

export const DEFAULT_MAX_CHARS = 20_000;

export interface Limited {
  text: string;
  truncated: boolean;
  outputRef?: string;
}

export function limitOutput(
  full: string,
  outputDir: string,
  maxChars: number = DEFAULT_MAX_CHARS,
): Limited {
  if (full.length <= maxChars) return { text: full, truncated: false };

  mkdirSync(outputDir, { recursive: true });
  const ref = path.join(outputDir, `${randomUUID()}.log`);
  writeFileSync(ref, full, 'utf8');

  const head = Math.floor(maxChars * 0.4);
  const tail = maxChars - head;
  const omitted = full.length - maxChars;
  const text =
    full.slice(0, head) +
    `\n…[已省略 ${omitted} 字符，完整内容见 ${ref}]…\n` +
    full.slice(full.length - tail);

  return { text, truncated: true, outputRef: ref };
}
