import { execa } from 'execa';
import { z } from 'zod';
import { buildEnv } from './env.js';
import { fail } from './guard.js';
import { limitOutput } from './output.js';
import { defineTool } from './types.js';

const SAFE_FLAGS: Record<string, RegExp[]> = {
  status: [/^(-s|--short|-b|--branch|--porcelain(=v?\d)?)$/],
  diff: [/^(--stat|--name-only|--name-status|--cached|--staged|--no-color)$/, /^-U\d+$/],
  log: [/^(--oneline|--stat|--name-only|--no-color)$/, /^-n?\d+$/],
  show: [/^(--stat|--name-only|--no-color|--oneline)$/],
};

export const gitTool = defineTool({
  name: 'git',
  description: '只读 Git 查询：status、diff、log、show。只接受白名单参数，其余以 - 开头的参数一律拒绝。',
  schema: z.object({
    subcommand: z.enum(['status', 'diff', 'log', 'show']),
    args: z.array(z.string()).default([]),
  }),
  sideEffect: 'none',
  async run(args, ctx) {
    if (!ctx.hasGit) return fail('当前工作区不是 Git 仓库');

    const flags = SAFE_FLAGS[args.subcommand] ?? [];
    for (const a of args.args) {
      if (a === '--') continue;
      if (a.startsWith('-') && !flags.some((re) => re.test(a))) {
        return { ok: false, status: 'denied', summary: `不允许的参数：${a}` };
      }
    }

    const r = await execa(
      'git',
      ['--no-pager', '-c', 'core.fsmonitor=false', args.subcommand, ...args.args],
      {
        cwd: ctx.workspaceRoot, reject: false, all: true, windowsHide: true, timeout: 30_000,
        extendEnv: false, env: buildEnv({ GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' }),
      },
    );

    const lim = limitOutput(String(r.all ?? ''), ctx.outputDir);
    const code = typeof r.exitCode === 'number' ? r.exitCode : null;
    return {
      ok: code === 0,
      status: code === 0 ? 'ok' : 'error',
      exitCode: code,
      summary: lim.text,
      outputRef: lim.outputRef,
    };
  },
});
