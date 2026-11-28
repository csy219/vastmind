import type { ContentBlock, Message, ModelClient, ModelEvent, Usage } from '../model/types.js';
import { toToolSpecs } from '../context/toolSpecs.js';
import { TOOLS } from '../tools/registry.js';
import type { ToolContext, ToolResult } from '../tools/types.js';
import type { AgentEvent, CheckRecord, RunStatus, TodoItem } from './events.js';
import { executeTool, type Approver } from './execute.js';
import type { PermissionPolicy } from './permission.js';
import { ReadTracker } from './readTracker.js';

export interface LoopOptions {
  model: ModelClient;
  systemPrompt: string;
  ctx: ToolContext;
  policy: PermissionPolicy;
  approve: Approver;
  task: string;
  maxSteps?: number; // 模型调用次数上限，默认 40
  onEvent?: (e: AgentEvent) => void;
}

export interface RunOutcome {
  status: RunStatus;
  summary: string;
  changedFiles: string[];
  checks: CheckRecord[];
  usage: Usage;
  steps: number;
  messages: Message[];
}

type ToolUse = Extract<ContentBlock, { type: 'tool_use' }>;

const MAX_NUDGES = 2;

// 修改前的检查与补全：patch 必须先读过，且自动带上读取时的哈希；覆盖已有文件同样必须先读。
function prepare(name: string, input: unknown, tracker: ReadTracker): { input: unknown } | { error: string } {
  if (typeof input !== 'object' || input === null) return { input };
  const obj = input as Record<string, unknown>;
  const p = typeof obj.path === 'string' ? obj.path : undefined;
  if (!p) return { input };

  if (name === 'patch') {
    const hash = tracker.expected(p);
    if (!hash) return { error: `请先用 read 读取 ${p} 再修改` };
    return { input: { ...obj, expectedFileHash: hash } }; // 以核心记录的为准，覆盖模型自己传的值
  }
  if (name === 'write' && obj.overwrite === true && tracker.exists(p) && !tracker.expected(p)) {
    return { error: `覆盖已有文件前请先用 read 读取 ${p}` };
  }
  return { input };
}

export async function runAgent(o: LoopOptions): Promise<RunOutcome> {
  const emit = o.onEvent ?? (() => {});
  const maxSteps = o.maxSteps ?? 40;
  const specs = toToolSpecs(TOOLS, o.policy.mode);
  const tracker = new ReadTracker(o.ctx.workspaceRoot);

  const messages: Message[] = [{ role: 'user', content: [{ type: 'text', text: o.task }] }];
  const usage: Usage = { inputTokens: 0, outputTokens: 0 };
  const changed = new Set<string>();
  const checks: CheckRecord[] = [];

  let seq = 0;        // 每次工具调用递增，用来比较「改动」和「检查」的先后
  let lastChange = 0; // 最近一次成功修改文件的序号
  let lastPass = 0;   // 最近一次成功检查的序号
  let nudges = 0;
  let steps = 0;
  let lastText = '';

  const finish = (status: RunStatus, summary: string): RunOutcome => {
    const out: RunOutcome = { status, summary, changedFiles: [...changed], checks, usage, steps, messages };
    emit({ type: 'run_finished', status, summary, changedFiles: out.changedFiles, checks, usage, steps });
    return out;
  };

  emit({ type: 'run_started', workspaceRoot: o.ctx.workspaceRoot, mode: o.policy.mode });

  for (;;) {
    if (o.ctx.signal?.aborted) return finish('aborted', '已中止');
    if (steps >= maxSteps) return finish('blocked', `达到步数上限 ${maxSteps}，已完成的改动保留在工作区`);
    steps++;

    let done: Extract<ModelEvent, { type: 'message_done' }> | undefined;
    try {
      for await (const ev of o.model.stream({
        system: o.systemPrompt, messages, tools: specs, signal: o.ctx.signal,
      })) {
        if (ev.type === 'text_delta') emit({ type: 'text_delta', text: ev.text });
        else done = ev;
      }
    } catch (e) {
      if (o.ctx.signal?.aborted) return finish('aborted', '已中止');
      return finish('error', `模型调用失败：${e instanceof Error ? e.message : String(e)}`);
    }
    if (!done) return finish('error', '模型没有返回完整消息');

    messages.push(done.message);
    if (done.usage) {
      usage.inputTokens += done.usage.inputTokens;
      usage.outputTokens += done.usage.outputTokens;
    }
    lastText = done.message.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');

    const calls: ToolUse[] = [];
    for (const b of done.message.content) if (b.type === 'tool_use') calls.push(b);

    if (calls.length > 0) {
      const results: ContentBlock[] = [];
      for (const c of calls) {
        // 被中止时，剩下的调用也要补一条结果，保证每个 tool_use 都有配对的 tool_result
        if (o.ctx.signal?.aborted) {
          results.push({ type: 'tool_result', toolUseId: c.id, content: '已中止，未执行', isError: true });
          continue;
        }
        emit({ type: 'tool_started', id: c.id, name: c.name, input: c.input });

        const prep = prepare(c.name, c.input, tracker);
        const r: ToolResult =
          'error' in prep
            ? { ok: false, status: 'error', summary: prep.error }
            : await executeTool(c.name, prep.input, o.ctx, o.approve, o.policy);

        seq++;
        const input = ('input' in prep ? prep.input : c.input) as Record<string, unknown> | null;
        const path = typeof input?.path === 'string' ? input.path : undefined;

        if (r.ok && path && (c.name === 'read' || c.name === 'patch' || c.name === 'write')) tracker.record(path);
        if (r.ok && path && (c.name === 'patch' || c.name === 'write')) {
          changed.add(path);
          lastChange = seq;
        }
        if (c.name === 'run') {
          checks.push({ command: String(input?.command ?? ''), exitCode: r.exitCode ?? null, ok: r.ok });
          if (r.ok) lastPass = seq;
        }
        if (c.name === 'todo' && r.ok) emit({ type: 'todo_updated', items: (input?.items ?? []) as TodoItem[] });

        emit({ type: 'tool_finished', id: c.id, name: c.name, result: r });
        results.push({ type: 'tool_result', toolUseId: c.id, content: r.summary, isError: !r.ok });
      }
      messages.push({ role: 'user', content: results });
      continue;
    }

    // 模型没有再调用工具：准备收工，先过验收门
    if (done.stopReason === 'max_tokens') return finish('blocked', '模型输出达到长度上限被截断');

    if (lastChange > lastPass) {
      if (nudges < MAX_NUDGES) {
        nudges++;
        const failedAfter = checks.length > 0 && !checks[checks.length - 1]!.ok;
        const reason = failedAfter
          ? '你修改了文件，最近一次检查失败了，此后没有成功的检查。请修复后重新运行，或明确说明无法通过的原因。'
          : '你修改了文件，但此后没有成功运行任何检查。请运行相关测试、类型检查或构建；确实无法运行时，请明确写出「未验证」和原因。';
        emit({ type: 'gate_blocked', reason });
        messages.push({ role: 'user', content: [{ type: 'text', text: reason }] });
        continue;
      }
      return finish('unverified', lastText || '已修改文件，但没有成功运行任何检查');
    }
    return finish('completed', lastText);
  }
}
