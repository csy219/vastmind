import { randomUUID } from 'node:crypto';
import { sseData } from './sse.js';
import type { ContentBlock, Message, ModelClient, ModelEvent, ModelRequest, StopReason, Usage } from './types.js';

export interface OpenAIOptions {
  baseUrl: string;
  model: string;
  apiKey: string;
  maxRetries?: number;      // 仅用于开始接收流之前的失败，默认 3
  retryBaseMs?: number;     // 退避基数，默认 500
  fetchImpl?: typeof fetch; // 测试注入
}

export class ModelError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
    this.name = 'ModelError';
  }
}

interface OAIToolCall { id: string; type: 'function'; function: { name: string; arguments: string } }
type OAIMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: OAIToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };

export function toOpenAIMessages(system: string, messages: Message[]): OAIMessage[] {
  const out: OAIMessage[] = [{ role: 'system', content: system }];
  for (const m of messages) {
    if (m.role === 'assistant') {
      let text = '';
      const calls: OAIToolCall[] = [];
      for (const b of m.content) {
        if (b.type === 'text') text += b.text;
        else if (b.type === 'tool_use') {
          calls.push({ id: b.id, type: 'function', function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) } });
        }
      }
      out.push({ role: 'assistant', content: text || null, tool_calls: calls.length ? calls : undefined });
    } else {
      let text = '';
      for (const b of m.content) {
        if (b.type === 'tool_result') out.push({ role: 'tool', tool_call_id: b.toolUseId, content: b.content });
        else if (b.type === 'text') text += b.text;
      }
      if (text) out.push({ role: 'user', content: text }); // 工具消息必须紧跟在 assistant 之后，文字放最后
    }
  }
  return out;
}

interface OAIChunk {
  choices?: Array<{
    delta?: {
      content?: string | null;
      tool_calls?: Array<{ index: number; id?: string; function?: { name?: string; arguments?: string } }>;
    };
    finish_reason?: string | null;
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true });
  });

function parseArgs(raw: string): unknown {
  if (!raw.trim()) return {};
  try { return JSON.parse(raw); } catch { return raw; } // 非法 JSON 原样保留，交给 zod 报错让模型自己修正
}

export class OpenAIClient implements ModelClient {
  constructor(private readonly o: OpenAIOptions) {}

  private async post(body: unknown, signal?: AbortSignal): Promise<Response> {
    const max = this.o.maxRetries ?? 3;
    const base = this.o.retryBaseMs ?? 500;
    const doFetch = this.o.fetchImpl ?? fetch;
    const url = `${this.o.baseUrl.replace(/\/+$/, '')}/chat/completions`;

    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        res = await doFetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${this.o.apiKey}` },
          body: JSON.stringify(body),
          signal,
        });
      } catch (e) {
        if (signal?.aborted || attempt >= max) {
          throw new ModelError(`请求失败：${e instanceof Error ? e.message : String(e)}`);
        }
        await sleep(base * 2 ** attempt, signal);
        continue;
      }
      if (res.ok && res.body) return res;

      const retriable = res.status === 429 || res.status >= 500;
      if (!retriable || attempt >= max) {
        const detail = (await res.text().catch(() => '')).slice(0, 500);
        throw new ModelError(`模型接口返回 ${res.status}：${detail}`, res.status);
      }
      await sleep(base * 2 ** attempt, signal);
    }
  }

  async *stream(req: ModelRequest): AsyncGenerator<ModelEvent> {
    const res = await this.post(
      {
        model: this.o.model,
        messages: toOpenAIMessages(req.system, req.messages),
        tools: req.tools.length
          ? req.tools.map((t) => ({
              type: 'function',
              function: { name: t.name, description: t.description, parameters: t.inputSchema },
            }))
          : undefined,
        stream: true,
        stream_options: { include_usage: true },
      },
      req.signal,
    );

    let text = '';
    let finish: string | null = null;
    let usage: Usage | undefined;
    const calls = new Map<number, { id: string; name: string; args: string }>();

    for await (const data of sseData(res.body!)) {
      if (data === '[DONE]') break;
      let chunk: OAIChunk;
      try { chunk = JSON.parse(data) as OAIChunk; } catch { continue; }

      if (chunk.usage) {
        usage = { inputTokens: chunk.usage.prompt_tokens ?? 0, outputTokens: chunk.usage.completion_tokens ?? 0 };
      }
      const choice = chunk.choices?.[0];
      if (!choice) continue;

      const d = choice.delta;
      if (d?.content) {
        text += d.content;
        yield { type: 'text_delta', text: d.content };
      }
      for (const tc of d?.tool_calls ?? []) {
        const cur = calls.get(tc.index) ?? { id: '', name: '', args: '' };
        if (tc.id) cur.id = tc.id;
        if (tc.function?.name && !cur.name) cur.name = tc.function.name; // 名字只在首个分片出现
        if (tc.function?.arguments) cur.args += tc.function.arguments;
        calls.set(tc.index, cur);
      }
      if (choice.finish_reason) finish = choice.finish_reason;
    }

    const content: ContentBlock[] = [];
    if (text) content.push({ type: 'text', text });
    for (const [, c] of [...calls.entries()].sort((a, b) => a[0] - b[0])) {
      content.push({ type: 'tool_use', id: c.id || `call_${randomUUID()}`, name: c.name, input: parseArgs(c.args) });
    }
    const stopReason: StopReason = calls.size > 0 ? 'tool_use' : finish === 'length' ? 'max_tokens' : 'end_turn';
    yield { type: 'message_done', message: { role: 'assistant', content }, stopReason, usage };
  }
}
