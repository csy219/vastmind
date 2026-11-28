import { describe, expect, it } from 'vitest';
import { checkPermission, type PermissionPolicy } from '../src/core/permission.js';

const policy = (p: Partial<PermissionPolicy>): PermissionPolicy => ({ mode: 'default', allow: [], deny: [], ...p });
const run = (command: string, p: Partial<PermissionPolicy> = {}) =>
  checkPermission({ tool: 'run', sideEffect: 'exec', args: { command } }, policy(p)).kind;
const tool = (name: string, sideEffect: 'none' | 'write' | 'exec', p: Partial<PermissionPolicy> = {}) =>
  checkPermission({ tool: name, sideEffect, args: {} }, policy(p)).kind;

describe('权限模式', () => {
  it('acceptEdits：写入自动通过，命令仍然询问', () => {
    expect(tool('write', 'write', { mode: 'acceptEdits' })).toBe('allow');
    expect(tool('patch', 'write', { mode: 'acceptEdits' })).toBe('allow');
    expect(run('npm test', { mode: 'acceptEdits' })).toBe('ask');
  });
  it('plan：只读，写入和命令一律拒绝，读与 todo 放行', () => {
    expect(tool('write', 'write', { mode: 'plan' })).toBe('deny');
    expect(run('npm test', { mode: 'plan' })).toBe('deny');
    expect(tool('read', 'none', { mode: 'plan' })).toBe('allow');
    expect(tool('todo', 'none', { mode: 'plan' })).toBe('allow');
  });
});

describe('allow / deny 规则', () => {
  const allow = ['run(npm test:*)'];
  it('前缀规则放行匹配的命令', () => {
    expect(run('npm test -- auth', { allow })).toBe('allow');
    expect(run('npm test', { allow })).toBe('allow');
  });
  it('前缀不是整词时不放行', () => {
    expect(run('npm testx', { allow })).toBe('ask');
  });
  it.each(['npm test; echo x', 'npm test && echo x', 'npm test | more', 'npm test > out.txt', 'npm test `id`'])(
    '命令带串联时不放行：%s',
    (cmd) => expect(run(cmd, { allow })).toBe('ask'),
  );
  it('允许规则压不过内置拒绝清单', () => {
    expect(run('git push --force origin main', { allow: ['run(git push:*)'] })).toBe('deny');
  });
  it('拒绝规则按串联拆开逐段匹配', () => {
    const deny = ['run(npm publish:*)'];
    expect(run('npm publish', { deny })).toBe('deny');
    expect(run('echo hi; npm publish', { deny })).toBe('deny');
  });
  it('整个工具的规则', () => {
    expect(tool('write', 'write', { allow: ['write'] })).toBe('allow');
    expect(tool('write', 'write', { deny: ['write'] })).toBe('deny');
  });
});
