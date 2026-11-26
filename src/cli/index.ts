#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import readline from 'node:readline/promises';
import { Command } from 'commander';
import { executeTool, type Approver } from '../core/execute.js';
import { TOOLS } from '../tools/registry.js';
import { resolveWorkspace } from '../workspace/resolve.js';
import { loadConfig } from './config.js';

const program = new Command();
program.name('vastmind').description('VastMind Coding Agent');

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

    const approve: Approver = opts.yes
      ? async () => true
      : async (reason) => {
          const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
          const answer = await rl.question(`${reason}\n允许？[y/N] `);
          rl.close();
          return /^y(es)?$/i.test(answer.trim());
        };

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
