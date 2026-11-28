#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { Command } from 'commander';
import { executeTool } from '../core/execute.js';
import { TOOLS } from '../tools/registry.js';
import { resolveWorkspace } from '../workspace/resolve.js';
import { makeApprover } from './approve.js';
import { loadConfig } from './config.js';
import { runCommand } from './run.js';

const collect = (v: string, prev: string[]) => [...prev, v];

const program = new Command();
program.name('vastmind').description('VastMind Coding Agent');

program
  .command('run')
  .description('执行一次开发任务')
  .argument('<task>', '任务描述')
  .option('--cwd <dir>', '工作目录', process.cwd())
  .option('--output-format <fmt>', 'text | json | stream-json', 'text')
  .option('--permission-mode <mode>', 'default | acceptEdits | plan')
  .option('--allow <rule>', '允许规则，可重复，如 "run(npm test:*)"', collect, [] as string[])
  .option('--deny <rule>', '拒绝规则，可重复', collect, [] as string[])
  .option('--max-steps <n>', '模型调用次数上限', (v: string) => Number.parseInt(v, 10))
  .option('--model <name>', '模型名')
  .option('-y, --yes', '自动批准所有询问（内置拒绝清单仍然生效）')
  .action(async (task: string, o) => {
    process.exitCode = await runCommand(task, {
      cwd: o.cwd,
      outputFormat: o.outputFormat,
      permissionMode: o.permissionMode,
      allow: o.allow,
      deny: o.deny,
      maxSteps: o.maxSteps,
      model: o.model,
      yes: o.yes,
    });
  });

program
  .command('tool')
  .description('调试：不经过模型，直接调用一个工具')
  .argument('<name>', `工具名：${TOOLS.map((t) => t.name).join(' | ')}`)
  .argument('[json]', 'JSON 参数；以 @ 开头表示从文件读取', '{}')
  .option('--cwd <dir>', '工作目录', process.cwd())
  .option('-y, --yes', '自动批准询问（仅调试用，拒绝清单仍然生效）')
  .action(async (name: string, json: string, opts: { cwd: string; yes?: boolean }) => {
    let args: unknown;
    try {
      args = JSON.parse(json.startsWith('@') ? readFileSync(json.slice(1), 'utf8') : json);
    } catch {
      console.error('JSON 参数无法解析');
      process.exitCode = 2;
      return;
    }

    const ws = resolveWorkspace(opts.cwd);
    const cfg = loadConfig(ws.root);

    const approve = makeApprover({
      yes: Boolean(opts.yes),
      interactive: Boolean(process.stdin.isTTY && process.stderr.isTTY),
      err: process.stderr,
    });

    const ac = new AbortController();
    process.once('SIGINT', () => ac.abort()); // 第一次 Ctrl+C 优雅中止，第二次由系统默认处理强制退出

    const r = await executeTool(
      name,
      args,
      { workspaceRoot: ws.root, hasGit: ws.hasGit, outputDir: cfg.outputDir, signal: ac.signal },
      approve,
    );

    console.log(r.summary);
    if (r.outputRef) console.error(`[完整输出] ${r.outputRef}`);
    process.exitCode = r.ok ? 0 : r.status === 'denied' ? 3 : r.status === 'timeout' ? 4 : 1;
  });

await program.parseAsync();
