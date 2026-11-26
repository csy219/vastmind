import { spawn } from 'node:child_process';
import { statSync } from 'node:fs';
import { execa } from 'execa';
import { z } from 'zod';
import { buildEnv } from './env.js';
import { fail, guardPath } from './guard.js';
import { limitOutput } from './output.js';
import { defineTool } from './types.js';

const isWin = process.platform === 'win32';

function killTree(pid: number | undefined): void {
  if (!pid) return;
  if (isWin) {
    const k = spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    k.on('error', () => {});
  } else {
    try { process.kill(-pid, 'SIGKILL'); } catch { /* 进程已退出 */ }
  }
}

// Windows 下用 PowerShell 执行。powershell.exe -Command 不会透传原生命令的退出码
// （原生命令失败一律得到 1），所以在脚本末尾显式 exit。输出统一为 UTF-8，避免中文乱码。
export function buildPowerShellScript(command: string): string {
  return [
    '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
    "$ProgressPreference = 'SilentlyContinue'",
    '$global:LASTEXITCODE = 0',
    command,
    '$vmOk = $?',
    'if ($LASTEXITCODE) { exit $LASTEXITCODE }',
    'if (-not $vmOk) { exit 1 }',
  ].join('\n');
}

export const runTool = defineTool({
  name: 'run',
  description:
    '在工作区内执行一条命令，带超时。Windows 下使用 PowerShell，其他系统使用 sh。返回退出码和限长输出。',
  schema: z.object({
    command: z.string().min(1),
    cwd: z.string().optional(),
    timeoutMs: z.number().int().min(1000).max(600_000).default(120_000),
  }),
  sideEffect: 'exec',
  async run(args, ctx) {
    let cwd = ctx.workspaceRoot;
    if (args.cwd) {
      const g = guardPath(ctx.workspaceRoot, args.cwd);
      if ('fail' in g) return g.fail;
      if (!statSync(g.abs, { throwIfNoEntry: false })?.isDirectory()) {
        return fail(`工作目录不存在：${args.cwd}`);
      }
      cwd = g.abs;
    }

    const common = {
      cwd, reject: false, all: true, windowsHide: true,
      detached: !isWin, extendEnv: false, env: buildEnv(),
      maxBuffer: 10 * 1024 * 1024,
    } as const;

    const child = isWin
      ? execa(
          'powershell.exe',
          [
            '-NoProfile', '-NonInteractive',
            '-EncodedCommand', Buffer.from(buildPowerShellScript(args.command), 'utf16le').toString('base64'),
          ],
          common,
        )
      : execa(args.command, { ...common, shell: true });

    let timedOut = false;
    let aborted = false;
    const timer = setTimeout(() => { timedOut = true; killTree(child.pid); }, args.timeoutMs);
    const onAbort = () => { aborted = true; killTree(child.pid); };
    ctx.signal?.addEventListener('abort', onAbort, { once: true });

    const r = await child;
    clearTimeout(timer);
    ctx.signal?.removeEventListener('abort', onAbort);

    const lim = limitOutput(String(r.all ?? ''), ctx.outputDir);
    const code = typeof r.exitCode === 'number' ? r.exitCode : null;
    const status = timedOut ? 'timeout' : aborted ? 'error' : code === 0 ? 'ok' : 'error';
    const head = timedOut ? `超时（${args.timeoutMs}ms），已终止进程树` : aborted ? '已中止' : `exit=${code}`;

    return {
      ok: status === 'ok',
      status,
      exitCode: code,
      summary: `${head}\n${lim.text}`,
      outputRef: lim.outputRef,
    };
  },
});
