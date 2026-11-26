import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { resolveSafe, PathEscapeError } from '../src/workspace/safePath.js';

const isWin = process.platform === 'win32';
let base: string, root: string, outside: string;

beforeEach(() => {
  base = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'vm-')));
  root = path.join(base, 'ws');
  outside = path.join(base, 'out');
  mkdirSync(root);
  mkdirSync(outside);
  mkdirSync(path.join(base, 'ws-evil'));
  writeFileSync(path.join(root, 'a.txt'), 'x');
  writeFileSync(path.join(outside, 'secret.txt'), 's');
  writeFileSync(path.join(base, 'ws-evil', 'f.txt'), 'e');
});
afterEach(() => rmSync(base, { recursive: true, force: true }));

describe('resolveSafe', () => {
  it('允许工作区内的相对路径', () => {
    expect(resolveSafe(root, 'a.txt')).toBe(path.join(root, 'a.txt'));
  });

  it('允许尚不存在的新文件和新目录', () => {
    expect(resolveSafe(root, 'new/dir/f.ts')).toBe(path.join(root, 'new', 'dir', 'f.ts'));
  });

  it('拒绝 .. 越界', () => {
    expect(() => resolveSafe(root, '../out/secret.txt')).toThrow(PathEscapeError);
  });

  it('拒绝工作区外的绝对路径', () => {
    expect(() => resolveSafe(root, path.join(outside, 'secret.txt'))).toThrow(PathEscapeError);
  });

  it('拒绝名字前缀相同的兄弟目录', () => {
    expect(() => resolveSafe(root, '../ws-evil/f.txt')).toThrow(PathEscapeError);
  });

  it('拒绝指向工作区外的符号链接或目录联接', () => {
    symlinkSync(outside, path.join(root, 'link'), 'junction'); // 非 Windows 忽略第三参数
    expect(() => resolveSafe(root, 'link/secret.txt')).toThrow(PathEscapeError);
  });

  it('拒绝经由外部链接创建新文件', () => {
    symlinkSync(outside, path.join(root, 'link'), 'junction');
    expect(() => resolveSafe(root, 'link/new.txt')).toThrow(PathEscapeError);
  });

  it.skipIf(isWin)('拒绝悬空链接', () => {
    symlinkSync(path.join(outside, 'nope'), path.join(root, 'dangling'));
    expect(() => resolveSafe(root, 'dangling')).toThrow(PathEscapeError);
  });
});
