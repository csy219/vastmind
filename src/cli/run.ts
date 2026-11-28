import { z } from 'zod';
import { loadInstructions } from '../context/instructions.js';
import { buildSystemPrompt } from '../context/prompt.js';
import type { RunStatus } from '../core/events.js';
import { runAgent } from '../core/loop.js';
import type { PermissionMode } from '../core/permission.js';
import { OpenAIClient } from '../model/openai.js';
import type { ModelClient } from '../model/types.js';
import { resolveWorkspace } from '../workspace/resolve.js';
import { makeApprover, type Writer } from './approve.js';
import { loadConfig, type Config } from './config.js';
import { createRenderer, type Format } from './render.js';

export interface RunCliOptions {
  cwd: string;
  outputFormat: string;
  permissionMode?: string;
  allow: string[];
  deny: string[];
  maxSteps?: number;
  model?: string;
  yes?: boolean;
}

export interface RunDeps {
  env?: NodeJS.ProcessEnv;
  home?: string;
  model?: ModelClient;
  stdout?: Writer;
  stderr?: Writer;
  interactive?: boolean;
}

export const EXIT: Record<RunStatus, number> = {
  completed: 0,
  error: 1,
  unverified: 5,
  blocked: 6,
  aborted: 130,
};
const USAGE_ERROR = 2;

function isLoopback(host: string): boolean {
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1';
}

function buildModel(cfg: Config, env: NodeJS.ProcessEnv): ModelClient | { problems: string[] } {
  const problems: string[] = [];
  const { baseUrl, name } = cfg.model;
  const apiKey = env.VASTMIND_API_KEY;

  if (!baseUrl) problems.push('缺少接口地址：设置环境变量 VASTMIND_BASE_URL，或用户配置 model.baseUrl');
  if (!name) problems.push('缺少模型名：用 --model、环境变量 VASTMIND_MODEL，或用户配置 model.name');
  if (!apiKey) problems.push('缺少 API Key：设置环境变量 VASTMIND_API_KEY');
  if (baseUrl) {
    try {
      const u = new URL(baseUrl);
      if (u.protocol !== 'https:' && !(u.protocol === 'http:' && isLoopback(u.hostname))) {
        problems.push('接口地址必须是 https（本机地址除外），否则代码和 Key 会明文传输');
      }
    } catch {
      problems.push(`接口地址不是合法的 URL：${baseUrl}`);
    }
  }
  if (problems.length) return { problems };
  return new OpenAIClient({ baseUrl: baseUrl!, model: name!, apiKey: apiKey! });
}

export async function runCommand(task: string, opts: RunCliOptions, deps: RunDeps = {}): Promise<number> {
  const env = deps.env ?? process.env;
  const out = deps.stdout ?? process.stdout;
  const err = deps.stderr ?? process.stderr;

  const format = z.enum(['text', 'json', 'stream-json']).safeParse(opts.outputFormat);
  const mode = z.enum(['default', 'acceptEdits', 'plan']).optional().safeParse(opts.permissionMode);
  if (!format.success) { err.write('--output-format 只能是 text、json、stream-json\n'); return USAGE_ERROR; }
  if (!mode.success) { err.write('--permission-mode 只能是 default、acceptEdits、plan\n'); return USAGE_ERROR; }

  const ws = resolveWorkspace(opts.cwd);

  let cfg: Config;
  try {
    cfg = loadConfig(
      ws.root,
      {
        maxSteps: opts.maxSteps, model: opts.model, mode: mode.data as PermissionMode | undefined,
        allow: opts.allow, deny: opts.deny,
      },
      deps.home,
      env,
    );
  } catch (e) {
    err.write(`${e instanceof Error ? e.message : String(e)}\n`);
    return USAGE_ERROR;
  }
  for (const w of cfg.warnings) err.write(`警告：${w}\n`);

  const model = deps.model ?? buildModel(cfg, env);
  if ('problems' in model) {
    for (const p of model.problems) err.write(`${p}\n`);
    return USAGE_ERROR;
  }

  const instructions = loadInstructions(ws.root, deps.home);
  for (const w of instructions.warnings) err.write(`警告：${w}\n`);

  const interactive = deps.interactive ?? Boolean(process.stdin.isTTY && process.stderr.isTTY);
  const approve = makeApprover({ yes: Boolean(opts.yes), interactive, err });

  const ac = new AbortController();
  const onSigint = () => ac.abort(); // 第一次 Ctrl+C 优雅中止；监听器 once，第二次由系统直接退出
  process.once('SIGINT', onSigint);

  const renderer = createRenderer(format.data as Format, out, err);
  try {
    const outcome = await runAgent({
      model,
      systemPrompt: buildSystemPrompt({
        workspaceRoot: ws.root, hasGit: ws.hasGit, platform: process.platform,
        mode: cfg.permissions.mode, instructions,
      }),
      ctx: { workspaceRoot: ws.root, hasGit: ws.hasGit, outputDir: cfg.outputDir, signal: ac.signal },
      policy: cfg.permissions,
      approve,
      task,
      maxSteps: cfg.maxSteps,
      onEvent: renderer.onEvent,
    });
    renderer.finalize(outcome);
    return EXIT[outcome.status];
  } finally {
    process.removeListener('SIGINT', onSigint);
  }
}
