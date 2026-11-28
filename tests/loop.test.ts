import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { DEFAULT_POLICY, type PermissionPolicy } from '../src/core/permission.js';
import { runAgent, type RunOutcome } from '../src/core/loop.js';
import type { AgentEvent } from '../src/core/events.js';
import { ModelError } from '../src/model/openai.js';
import type { ContentBlock, ModelClient, ModelEvent, ModelRequest } from '../src/model/types.js';
import { makeSandbox, yes, type Sandbox } from './helpers.js';

type Turn =
  | { text?: string; calls?: Array<{ name: string; input: unknown }> }
  | Error
  | 'max_tokens';

class ScriptedModel implements ModelClient {
  requests: ModelRequest[] = [];
  private i = 0;
  constructor(private turns: Turn[]) {}

  async *stream(req: ModelRequest): AsyncGenerator<ModelEvent> {
    this.requests.push({ ...req, messages: JSON.parse(JSON.stringify(req.messages)) });
    const t = this.turns[this.i++] ?? { text: '（脚本结束）' };
    if (t instanceof Error) throw t;
    if (t === 'max_tokens') {
      yield {
        type: 'message_done',
        message: { role: 'assistant', content: [{ type: 'text', text: '半截' }] },
        stopReason: 'max_tokens',
      };
      return;
    }
    const content: ContentBlock[] = [];
    if (t.text) {
      content.push({ type: 'text', text: t.text });
      yield { type: 'text_delta', text: t.text };
    }
    (t.calls ?? []).forEach((c, k) =>
      content.push({ type: 'tool_use', id: `c${this.i}-${k}`, name: c.name, input: c.input }),
    );
    yield {
      type: 'message_done',
      message: { role: 'assistant', content },
      stopReason: t.calls?.length ? 'tool_use' : 'end_turn',
    };
  }
}

const read = { name: 'read', input: { path: 'a.ts' } };
const patch = { name: 'patch', input: { path: 'a.ts', oldText: 'x = 1', newText: 'x = 2' } };
const runOk = { name: 'run', input: { command: 'node -e "process.exit(0)"' } };
const runBad = { name: 'run', input: { command: 'node -e "process.exit(1)"' } };

let sb: Sandbox;
let events: AgentEvent[];
beforeEach(() => {
  sb = makeSandbox();
  events = [];
  writeFileSync(sb.file('a.ts'), 'const x = 1;\n');
});
afterEach(() => sb.cleanup());

function go(model: ModelClient, extra: Partial<Parameters<typeof runAgent>[0]> = {}): Promise<RunOutcome> {
  return runAgent({
    model, systemPrompt: 'sys', ctx: sb.ctx, policy: DEFAULT_POLICY, approve: yes,
    task: '把 x 改成 2', onEvent: (e) => events.push(e), ...extra,
  });
}
const gates = () => events.filter((e) => e.type === 'gate_blocked').length;

describe('runAgent', () => {
  it('读、改、跑检查、完成；patch 自动带上读取时的哈希', async () => {
    const out = await go(new ScriptedModel([{ calls: [read] }, { calls: [patch] }, { calls: [runOk] }, { text: '已改好，检查通过' }]));
    expect(out.status).toBe('completed');
    expect(out.changedFiles).toEqual(['a.ts']);
    expect(sb.text('a.ts')).toBe('const x = 2;\n');
    expect(out.checks).toEqual([{ command: 'node -e "process.exit(0)"', exitCode: 0, ok: true }]);
    expect(gates()).toBe(0);
  });

  it('没读就改：被拒绝，文件不变，错误回灌给模型', async () => {
    const model = new ScriptedModel([{ calls: [patch] }, { text: '好吧' }]);
    const out = await go(model);
    expect(sb.text('a.ts')).toBe('const x = 1;\n');
    expect(JSON.stringify(model.requests[1]!.messages)).toContain('请先用 read');
    expect(out.changedFiles).toEqual([]);
  });

  it('改完直接收工会被验收门拦回，补跑检查后完成', async () => {
    const out = await go(new ScriptedModel([{ calls: [read] }, { calls: [patch] }, { text: '改好了' }, { calls: [runOk] }, { text: '通过' }]));
    expect(gates()).toBe(1);
    expect(out.status).toBe('completed');
    expect(out.steps).toBe(5);
  });

  it('提醒两次后仍不检查：标为 unverified', async () => {
    const out = await go(new ScriptedModel([{ calls: [read] }, { calls: [patch] }, { text: '改好了' }, { text: '真的改好了' }, { text: '就这样' }]));
    expect(gates()).toBe(2);
    expect(out.status).toBe('unverified');
    expect(out.summary).toBe('就这样');
  });

  it('检查失败不算验证，修复后重跑通过才放行', async () => {
    const out = await go(new ScriptedModel([{ calls: [read] }, { calls: [patch] }, { calls: [runBad] }, { text: '失败了但先这样' }, { calls: [runOk] }, { text: '通过' }]));
    expect(out.status).toBe('completed');
    expect(out.checks.map((c) => c.ok)).toEqual([false, true]);
    expect(gates()).toBe(1);
  });

  it('用户拒绝批准写入：文件不变，denied 的结果回灌', async () => {
    const out = await go(new ScriptedModel([{ calls: [read] }, { calls: [patch] }, { text: '无法修改' }]), { approve: async () => false });
    expect(sb.text('a.ts')).toBe('const x = 1;\n');
    expect(out.status).toBe('completed');
    const denied = events.find((e) => e.type === 'tool_finished' && e.name === 'patch');
    expect(denied && denied.type === 'tool_finished' && denied.result.status).toBe('denied');
  });

  it('计划模式：不向模型暴露写入和命令工具', async () => {
    const model = new ScriptedModel([{ text: '方案如下' }]);
    const policy: PermissionPolicy = { ...DEFAULT_POLICY, mode: 'plan' };
    await go(model, { policy });
    const names = model.requests[0]!.tools.map((t) => t.name);
    expect(names).toContain('read');
    expect(names).not.toContain('write');
    expect(names).not.toContain('run');
  });

  it('步数用完：blocked', async () => {
    const out = await go(new ScriptedModel(Array.from({ length: 10 }, () => ({ calls: [read] }))), { maxSteps: 3 });
    expect(out.status).toBe('blocked');
    expect(out.steps).toBe(3);
  });

  it('模型接口失败：error，带上原因', async () => {
    const out = await go(new ScriptedModel([new ModelError('boom', 500)]));
    expect(out.status).toBe('error');
    expect(out.summary).toContain('boom');
  });

  it('输出被截断：blocked', async () => {
    expect((await go(new ScriptedModel(['max_tokens']))).status).toBe('blocked');
  });

  it('todo 调用产生 todo_updated 事件', async () => {
    const items = [{ content: '读代码', status: 'in_progress' }];
    await go(new ScriptedModel([{ calls: [{ name: 'todo', input: { items } }] }, { text: '完' }]));
    const ev = events.find((e) => e.type === 'todo_updated');
    expect(ev && ev.type === 'todo_updated' && ev.items).toEqual(items);
  });

  it('中途按 Ctrl+C：已完成的结果保留，未执行的调用也有配对结果', async () => {
    const ac = new AbortController();
    const ctx = { ...sb.ctx, signal: ac.signal };
    const approve = async () => { ac.abort(); return true; }; // 第一个命令被批准的瞬间触发中止
    const out = await go(new ScriptedModel([{ calls: [runOk, read] }]), { ctx, approve });
    expect(out.status).toBe('aborted');
    const last = out.messages[out.messages.length - 1]!;
    expect(last.content).toHaveLength(2);
    expect(last.content[1]).toMatchObject({ type: 'tool_result', isError: true, content: expect.stringContaining('已中止') });
  });
});
