import type { AgentEvent, RunStatus } from '../core/events.js';
import type { RunOutcome } from '../core/loop.js';
import type { Writer } from './approve.js';

export type Format = 'text' | 'json' | 'stream-json';

const LABEL: Record<RunStatus, string> = {
  completed: '已完成',
  unverified: '未验证',
  blocked: '已阻塞',
  error: '出错',
  aborted: '已中止',
};

function describeCall(name: string, input: unknown): string {
  const o = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>;
  const s = (v: unknown) => (typeof v === 'string' ? v : '');
  switch (name) {
    case 'run': return `run ${s(o.command).slice(0, 100)}`;
    case 'search': return `search ${s(o.pattern) || s(o.glob) || '**/*'}`;
    case 'git': return `git ${s(o.subcommand)}`;
    case 'todo': return 'todo';
    default: return `${name} ${s(o.path)}`.trim();
  }
}

const firstLine = (s: string) => (s.split(/\r?\n/)[0] ?? '').slice(0, 120);
const MARK = { pending: '[ ]', in_progress: '[~]', completed: '[x]' } as const;

export function createRenderer(format: Format, out: Writer, err: Writer) {
  let atLineStart = true;

  const onEvent = (e: AgentEvent): void => {
    if (format === 'stream-json') {
      out.write(JSON.stringify(e) + '\n');
      return;
    }
    if (format === 'json') return;

    switch (e.type) {
      case 'text_delta':
        out.write(e.text);
        atLineStart = e.text.endsWith('\n');
        break;
      case 'tool_started':
        err.write(`▸ ${describeCall(e.name, e.input)}\n`);
        break;
      case 'tool_finished':
        err.write(
          e.result.ok
            ? `  ✓${e.name === 'run' ? ' ' + firstLine(e.result.summary) : ''}\n`
            : `  ✗ ${firstLine(e.result.summary)}\n`,
        );
        break;
      case 'todo_updated':
        err.write(e.items.map((i) => `  ${MARK[i.status]} ${i.content}`).join('\n') + '\n');
        break;
      case 'gate_blocked':
        err.write(`⚠ 验收提醒：${e.reason}\n`);
        break;
      case 'run_finished': {
        if (!atLineStart) out.write('\n');
        const lines = [`── ${LABEL[e.status]} ──`];
        if (e.status !== 'completed') lines.push(e.summary);
        if (e.changedFiles.length) lines.push(`改动：${e.changedFiles.join(', ')}`);
        for (const c of e.checks) {
          lines.push(`检查：${c.command} → ${c.ok ? '通过' : `失败(exit ${c.exitCode ?? '?'})`}`);
        }
        if (e.status === 'unverified') lines.push('⚠ 改了文件，但没有成功的检查，请自行验证');
        lines.push(`用量：输入 ${e.usage.inputTokens} / 输出 ${e.usage.outputTokens} tokens，共 ${e.steps} 步`);
        err.write(lines.join('\n') + '\n');
        break;
      }
      default:
        break;
    }
  };

  const finalize = (o: RunOutcome): void => {
    if (format !== 'json') return;
    const { messages: _messages, ...rest } = o;
    out.write(JSON.stringify(rest, null, 2) + '\n');
  };

  return { onEvent, finalize };
}
