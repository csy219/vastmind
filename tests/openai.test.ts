import { describe, expect, it } from 'vitest';
import { ModelError, OpenAIClient, toOpenAIMessages } from '../src/model/openai.js';
import type { Message, ModelEvent } from '../src/model/types.js';

const enc = new TextEncoder();
const ev = (o: unknown) => `data: ${JSON.stringify(o)}\n\n`;
const sse = (chunks: string[], status = 200) =>
  new Response(
    new ReadableStream({
      start(c) {
        chunks.forEach((x) => c.enqueue(enc.encode(x)));
        c.close();
      },
    }),
    { status },
  );

const req = { system: 'sys', messages: [] as Message[], tools: [] };
async function collect(client: OpenAIClient): Promise<ModelEvent[]> {
  const out: ModelEvent[] = [];
  for await (const e of client.stream(req)) out.push(e);
  return out;
}

describe('toOpenAIMessages', () => {
  it('assistant 的工具调用变成 tool_calls，用户的 tool_result 变成独立的 tool 消息', () => {
    const msgs: Message[] = [
      { role: 'user', content: [{ type: 'text', text: '修 bug' }] },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: '先看看' },
          { type: 'tool_use', id: 'c1', name: 'read', input: { path: 'a.ts' } },
        ],
      },
      {
        role: 'user',
        content: [
          { type: 'tool_result', toolUseId: 'c1', content: '1\tx', isError: false },
          { type: 'text', text: '继续' },
        ],
      },
    ];
    const out = toOpenAIMessages('sys', msgs);
    expect(out.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'tool', 'user']);
    expect(out[2]).toMatchObject({ tool_calls: [{ id: 'c1', function: { name: 'read', arguments: '{"path":"a.ts"}' } }] });
    expect(out[3]).toMatchObject({ tool_call_id: 'c1', content: '1\tx' });
  });
});

describe('OpenAIClient.stream', () => {
  const opts = { baseUrl: 'http://x/v1/', model: 'm', apiKey: 'SECRET-KEY', retryBaseMs: 1 };

  it('拼装被切开的工具参数，并给出文字、用量和停止原因', async () => {
    const fetchImpl = async () =>
      sse([
        ev({ choices: [{ delta: { content: '好' } }] }),
        ev({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'read', arguments: '{"pa' } }] } }] }),
        ev({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'th":"a.txt"}' } }] } }] }),
        ev({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }),
        ev({ choices: [], usage: { prompt_tokens: 10, completion_tokens: 5 } }),
        'data: [DONE]\n\n',
      ]);
    const events = await collect(new OpenAIClient({ ...opts, fetchImpl: fetchImpl as typeof fetch }));

    expect(events[0]).toEqual({ type: 'text_delta', text: '好' });
    const done = events[events.length - 1]!;
    expect(done.type).toBe('message_done');
    if (done.type === 'message_done') {
      expect(done.stopReason).toBe('tool_use');
      expect(done.usage).toEqual({ inputTokens: 10, outputTokens: 5 });
      expect(done.message.content).toEqual([
        { type: 'text', text: '好' },
        { type: 'tool_use', id: 'c1', name: 'read', input: { path: 'a.txt' } },
      ]);
    }
  });

  it('参数不是合法 JSON 时原样保留为字符串', async () => {
    const fetchImpl = async () =>
      sse([
        ev({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'read', arguments: '{oops' } }] } }] }),
        'data: [DONE]\n\n',
      ]);
    const events = await collect(new OpenAIClient({ ...opts, fetchImpl: fetchImpl as typeof fetch }));
    const done = events[events.length - 1]!;
    if (done.type === 'message_done') {
      expect(done.message.content[0]).toMatchObject({ type: 'tool_use', input: '{oops' });
    }
  });

  it('429 时退避重试，随后成功', async () => {
    let n = 0;
    const fetchImpl = async () => {
      n++;
      return n === 1
        ? new Response('slow down', { status: 429 })
        : sse([ev({ choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] }), 'data: [DONE]\n\n']);
    };
    const events = await collect(new OpenAIClient({ ...opts, fetchImpl: fetchImpl as typeof fetch }));
    expect(n).toBe(2);
    expect(events[0]).toEqual({ type: 'text_delta', text: 'ok' });
  });

  it('401 不重试，错误信息里没有 API Key', async () => {
    let n = 0;
    const fetchImpl = async () => {
      n++;
      return new Response('invalid key', { status: 401 });
    };
    const err = await collect(new OpenAIClient({ ...opts, fetchImpl: fetchImpl as typeof fetch })).catch((e) => e);
    expect(n).toBe(1);
    expect(err).toBeInstanceOf(ModelError);
    expect(String(err.message)).not.toContain('SECRET-KEY');
    expect(err.status).toBe(401);
  });
});
