import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { atomicWrite, sha256 } from '../src/tools/fsutil.js';
import { makeSandbox, type Sandbox } from './helpers.js';

let sb: Sandbox;
beforeEach(() => { sb = makeSandbox(); });
afterEach(() => sb.cleanup());

describe('执行入口', () => {
  it('参数无效时返回错误而不执行', async () => {
    const r = await sb.call('read', {});
    expect(r.status).toBe('error');
    expect(r.summary).toContain('参数无效');
  });
  it('未知工具', async () => {
    expect((await sb.call('nope', {})).status).toBe('error');
  });
});

describe('read', () => {
  it('按行范围读取并带行号', async () => {
    writeFileSync(sb.file('a.txt'), 'l1\nl2\nl3');
    const r = await sb.call('read', { path: 'a.txt', startLine: 2 });
    expect(r.summary).toBe('2\tl2\n3\tl3');
  });
  it('越界路径被拒绝', async () => {
    expect((await sb.call('read', { path: '../x' })).status).toBe('denied');
  });
  it('二进制文件被拒绝', async () => {
    writeFileSync(sb.file('b.bin'), Buffer.from([1, 0, 2]));
    expect((await sb.call('read', { path: 'b.bin' })).ok).toBe(false);
  });
});

describe('write', () => {
  it('在空工作区创建新目录和新文件', async () => {
    const r = await sb.call('write', { path: 'src/a.ts', content: 'x' });
    expect(r.ok).toBe(true);
    expect(sb.text('src/a.ts')).toBe('x');
  });
  it('文件已存在且未设置 overwrite 时拒绝，内容不变', async () => {
    writeFileSync(sb.file('a.txt'), 'old');
    const r = await sb.call('write', { path: 'a.txt', content: 'new' });
    expect(r.ok).toBe(false);
    expect(sb.text('a.txt')).toBe('old');
  });
  it('不留下临时文件', async () => {
    await sb.call('write', { path: 'a.txt', content: 'x' });
    expect(readdirSync(sb.root).some((n) => n.endsWith('.tmp'))).toBe(false);
  });
  it('原子写失败时清理临时文件并保持目标不变', () => {
    mkdirSync(sb.file('dir')); // 目标是目录，rename 必然失败
    expect(() => atomicWrite(sb.file('dir'), 'x')).toThrow();
    expect(readdirSync(sb.root)).toEqual(['dir']);
  });
});

describe('patch', () => {
  it('唯一匹配时替换', async () => {
    writeFileSync(sb.file('a.ts'), 'const a = 1;\nconst b = 2;\n');
    const r = await sb.call('patch', { path: 'a.ts', oldText: 'const b = 2;', newText: 'const b = 3;' });
    expect(r.ok).toBe(true);
    expect(sb.text('a.ts')).toBe('const a = 1;\nconst b = 3;\n');
  });
  it('未找到时拒绝，文件不变', async () => {
    writeFileSync(sb.file('a.ts'), 'abc');
    const r = await sb.call('patch', { path: 'a.ts', oldText: 'zzz', newText: 'y' });
    expect(r.ok).toBe(false);
    expect(sb.text('a.ts')).toBe('abc');
  });
  it('出现多次时拒绝，文件不变', async () => {
    writeFileSync(sb.file('a.ts'), 'x x');
    const r = await sb.call('patch', { path: 'a.ts', oldText: 'x', newText: 'y' });
    expect(r.ok).toBe(false);
    expect(sb.text('a.ts')).toBe('x x');
  });
  it('旧内容哈希不一致时拒绝，不覆盖用户的编辑', async () => {
    writeFileSync(sb.file('a.ts'), 'v1');
    const stale = sha256('v1');
    writeFileSync(sb.file('a.ts'), 'v1 user-edit');
    const r = await sb.call('patch', { path: 'a.ts', oldText: 'v1', newText: 'v2', expectedFileHash: stale });
    expect(r.ok).toBe(false);
    expect(sb.text('a.ts')).toBe('v1 user-edit');
  });
  it('保留 CRLF 换行', async () => {
    writeFileSync(sb.file('a.txt'), 'a\r\nb\r\nc');
    const r = await sb.call('patch', { path: 'a.txt', oldText: 'a\nb', newText: 'a\nB' });
    expect(r.ok).toBe(true);
    expect(sb.text('a.txt')).toBe('a\r\nB\r\nc');
  });
});

describe('search', () => {
  it('遵守 .gitignore 和固定忽略目录', async () => {
    writeFileSync(sb.file('.gitignore'), '*.log\n');
    writeFileSync(sb.file('a.ts'), 'x');
    writeFileSync(sb.file('debug.log'), 'x');
    mkdirSync(sb.file('node_modules'));
    writeFileSync(sb.file('node_modules/m.js'), 'x');
    const r = await sb.call('search', {});
    expect(r.summary).toContain('a.ts');
    expect(r.summary).not.toContain('debug.log');
    expect(r.summary).not.toContain('m.js');
  });
  it('内容搜索返回 路径:行号:内容', async () => {
    writeFileSync(sb.file('a.ts'), 'one\nfoo bar\n');
    const r = await sb.call('search', { pattern: 'foo' });
    expect(r.summary).toBe('a.ts:2:foo bar');
  });
  it('不跟随指向工作区外的链接', async () => {
    const outside = path.join(sb.base, 'out2');
    mkdirSync(outside);
    writeFileSync(path.join(outside, 'secret.txt'), 's');
    symlinkSync(outside, sb.file('link'), 'junction');
    const r = await sb.call('search', {});
    expect(r.summary).not.toContain('secret.txt');
  });
});
