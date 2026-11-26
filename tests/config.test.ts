import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadConfig } from '../src/cli/config.js';

let base: string, root: string, home: string;
beforeEach(() => {
  base = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'vm-c-')));
  root = path.join(base, 'ws');
  home = path.join(base, 'home');
  mkdirSync(path.join(root, '.vastmind'), { recursive: true });
  mkdirSync(path.join(home, '.vastmind'), { recursive: true });
});
afterEach(() => rmSync(base, { recursive: true, force: true }));

describe('loadConfig', () => {
  it('默认输出目录在用户目录下，不在工作区内', () => {
    const c = loadConfig(root, {}, home);
    expect(c.outputDir.startsWith(home)).toBe(true);
  });
  it('项目配置覆盖用户配置，命令行覆盖项目配置', () => {
    writeFileSync(path.join(home, '.vastmind', 'config.json'), '{"outputDir":"u"}');
    writeFileSync(path.join(root, '.vastmind', 'config.json'), '{"outputDir":"p"}');
    expect(loadConfig(root, {}, home).outputDir).toBe(path.join(root, 'p'));
    expect(loadConfig(root, { outputDir: 'c' }, home).outputDir).toBe(path.join(root, 'c'));
  });
  it('未知字段报错', () => {
    writeFileSync(path.join(root, '.vastmind', 'config.json'), '{"oops":1}');
    expect(() => loadConfig(root, {}, home)).toThrow(/配置文件无效/);
  });
});
