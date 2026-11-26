import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, writeFileSync } from 'node:fs';
import { makeSandbox, type Sandbox } from './helpers.js';

let sb: Sandbox;
beforeEach(() => { sb = makeSandbox(); });
afterEach(() => sb.cleanup());

describe('run', () => {
  it('成功时返回退出码 0', async () => {
    const r = await sb.call('run', { command: 'node -e "console.log(1+1)"' });
    expect(r.ok).toBe(true);
    expect(r.exitCode).toBe(0);
    expect(r.summary).toContain('2');
  });

  it('原生命令的非 0 退出码被原样透传', async () => {
    const r = await sb.call('run', { command: 'node -e "process.exit(3)"' });
    expect(r.status).toBe('error');
    expect(r.exitCode).toBe(3);
  });

  it('中文输出不乱码', async () => {
    const r = await sb.call('run', { command: 'node -e "console.log(\'你好，世界\')"' });
    expect(r.summary).toContain('你好，世界');
  });

  it('输出过长时截断并保留完整日志引用', async () => {
    const r = await sb.call('run', { command: 'node -e "console.log(\'x\'.repeat(50000))"' });
    expect(r.outputRef).toBeTruthy();
    expect(r.summary.length).toBeLessThan(25000);
  });

  it('命中拒绝清单的命令不会启动，没有副作用', async () => {
    const r = await sb.call('run', {
      command: 'node -e "require(\'fs\').writeFileSync(\'proof.txt\',\'1\')"; rm -rf x',
    });
    expect(r.status).toBe('denied');
    expect(existsSync(sb.file('proof.txt'))).toBe(false);
  });

  it('用户拒绝批准时不启动，没有副作用', async () => {
    const r = await sb.call(
      'run',
      { command: 'node -e "require(\'fs\').writeFileSync(\'proof.txt\',\'1\')"' },
      async () => false,
    );
    expect(r.status).toBe('denied');
    expect(existsSync(sb.file('proof.txt'))).toBe(false);
  });

  it('子进程拿不到未列入白名单的环境变量', async () => {
    process.env.VM_TEST_SECRET = 'leak';
    try {
      const r = await sb.call('run', { command: 'node -e "console.log(process.env.VM_TEST_SECRET ?? \'none\')"' });
      expect(r.summary).toContain('none');
      expect(r.summary).not.toContain('leak');
    } finally {
      delete process.env.VM_TEST_SECRET;
    }
  });

  it('超时后终止整棵进程树，没有残留', async () => {
    writeFileSync(
      sb.file('child.js'),
      "require('fs').writeFileSync('pid.txt', String(process.pid)); setInterval(() => {}, 1000);",
    );
    writeFileSync(
      sb.file('parent.js'),
      "require('child_process').spawn(process.execPath, ['child.js'], { stdio: 'ignore' });" +
        'setInterval(() => {}, 1000);',
    );

    const r = await sb.call('run', { command: 'node parent.js', timeoutMs: 3000 });
    expect(r.status).toBe('timeout');

    const pid = Number(sb.text('pid.txt'));
    await new Promise((res) => setTimeout(res, 500));
    const alive = (() => {
      try { process.kill(pid, 0); return true; } catch { return false; }
    })();
    expect(alive).toBe(false);
  }, 20000);
});

describe('git', () => {
  it('非 Git 工作区直接报错', async () => {
    expect((await sb.call('git', { subcommand: 'status' })).ok).toBe(false);
  });

  it('会写文件的参数被拒绝', async () => {
    sb.ctx = { ...sb.ctx, hasGit: true };
    const r = await sb.call('git', { subcommand: 'diff', args: ['--output=x.txt'] });
    expect(r.status).toBe('denied');
    expect(existsSync(sb.file('x.txt'))).toBe(false);
  });
});
