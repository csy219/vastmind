import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { limitOutput } from '../src/tools/output.js';

const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(path.join(tmpdir(), 'vm-out-'));
  dirs.push(d);
  return d;
};
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

describe('limitOutput', () => {
  it('未超限时原样返回，不落盘', () => {
    const r = limitOutput('hello', tmp(), 100);
    expect(r).toEqual({ text: 'hello', truncated: false });
  });

  it('超限时截断，保留头尾，并把完整内容存成文件', () => {
    const full = 'A'.repeat(500) + 'MIDDLE' + 'Z'.repeat(500);
    const r = limitOutput(full, tmp(), 100);
    expect(r.truncated).toBe(true);
    expect(r.text.startsWith('AAAA')).toBe(true);
    expect(r.text.endsWith('ZZZZ')).toBe(true);
    expect(r.text.length).toBeLessThan(full.length);
    expect(readFileSync(r.outputRef!, 'utf8')).toBe(full);
  });
});
