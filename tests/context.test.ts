import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadInstructions } from '../src/context/instructions.js';
import { buildSystemPrompt } from '../src/context/prompt.js';
import { toToolSpecs } from '../src/context/toolSpecs.js';
import { TOOLS } from '../src/tools/registry.js';
import { todoTool } from '../src/tools/todo.js';

const isWin = process.platform === 'win32';
let base: string, root: string, home: string;
beforeEach(() => {
  base = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'vm-i-')));
  root = path.join(base, 'ws');
  home = path.join(base, 'home');
  mkdirSync(root);
  mkdirSync(home);
});
afterEach(() => rmSync(base, { recursive: true, force: true }));

describe('loadInstructions', () => {
  it('VASTMIND.md 优先于 AGENTS.md', () => {
    writeFileSync(path.join(root, 'VASTMIND.md'), 'A');
    writeFileSync(path.join(root, 'AGENTS.md'), 'B');
    const r = loadInstructions(root, home);
    expect(r.text).toContain('A');
    expect(r.text).not.toContain('B');
  });
  it('超长时截断', () => {
    writeFileSync(path.join(root, 'AGENTS.md'), 'x'.repeat(30_000));
    expect(loadInstructions(root, home).text).toContain('[已截断]');
  });
  it.skipIf(isWin)('指向工作区外的符号链接被忽略并警告', () => {
    writeFileSync(path.join(base, 'secret.md'), 'TOP-SECRET');
    symlinkSync(path.join(base, 'secret.md'), path.join(root, 'VASTMIND.md'));
    const r = loadInstructions(root, home);
    expect(r.text).not.toContain('TOP-SECRET');
    expect(r.warnings.length).toBe(1);
  });
});

describe('todo', () => {
  const ctx = () => ({ workspaceRoot: root, hasGit: false, outputDir: base });
  it('回显清单并标记状态', async () => {
    const r = await todoTool.run(
      { items: [{ content: '读代码', status: 'completed' }, { content: '改 bug', status: 'in_progress' }] },
      ctx(),
    );
    expect(r.summary).toBe('[x] 读代码\n[~] 改 bug');
  });
  it('两项同时进行中时报错', async () => {
    const r = await todoTool.run(
      { items: [{ content: 'a', status: 'in_progress' }, { content: 'b', status: 'in_progress' }] },
      ctx(),
    );
    expect(r.ok).toBe(false);
  });
});

describe('toToolSpecs / buildSystemPrompt', () => {
  it('每个工具都有 object 类型的 JSON Schema，且不含 $schema', () => {
    for (const s of toToolSpecs(TOOLS, 'default')) {
      expect(s.inputSchema.type).toBe('object');
      expect(s.inputSchema).not.toHaveProperty('$schema');
    }
  });
  it('计划模式只暴露无副作用的工具', () => {
    const names = toToolSpecs(TOOLS, 'plan').map((s) => s.name);
    expect(names).toContain('read');
    expect(names).toContain('todo');
    expect(names).not.toContain('write');
    expect(names).not.toContain('run');
  });
  it('系统提示包含工作区、shell 提示和指令文件内容', () => {
    const p = buildSystemPrompt({
      workspaceRoot: 'D:\\proj', hasGit: true, platform: 'win32', mode: 'default',
      instructions: { sources: [], text: '用 pnpm', warnings: [] },
    });
    expect(p).toContain('D:\\proj');
    expect(p).toContain('PowerShell');
    expect(p).toContain('用 pnpm');
  });
  it('计划模式的提示里有只读说明', () => {
    const p = buildSystemPrompt({
      workspaceRoot: '/p', hasGit: false, platform: 'linux', mode: 'plan',
      instructions: { sources: [], text: '', warnings: [] },
    });
    expect(p).toContain('计划');
  });
});
