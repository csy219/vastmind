import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { runCommand, type RunCliOptions } from '../src/cli/run.js';
import { makeSandbox, type Sandbox } from './helpers.js';

const ev = (o: unknown) => `data: ${JSON.stringify(o)}\n\n`;
const toolCall = (id: string, name: string, args: unknown) => [
  ev({ choices: [{ delta: { tool_calls: [{ index: 0, id, function: { name, arguments: JSON.stringify(args) } }] } }] }),
  ev({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }),
  'data: [DONE]\n\n',
];
const reply = (text: string) => [
  ev({ choices: [{ delta: { content: text } }] }),
  ev({ choices: [{ delta: {}, finish_reason: 'stop' }] }),
  ev({ choices: [], usage: { prompt_tokens: 7, completion_tokens: 3 } }),
  'data: [DONE]\n\n',
];

interface FakeServer {
  url: string;
  bodies: Array<{ messages: Array<{ role: string; content: string }>; tools?: Array<{ function: { name: string } }> }>;
  auths: Array<string | undefined>;
  close(): Promise<void>;
}

function startServer(responses: string[][]): Promise<FakeServer> {
  const bodies: FakeServer['bodies'] = [];
  const auths: FakeServer['auths'] = [];
  let n = 0;
  const server = http.createServer((req, res) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => {
      bodies.push(JSON.parse(data));
      auths.push(req.headers.authorization);
      const chunks = responses[Math.min(n++, responses.length - 1)]!;
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      chunks.forEach((c) => res.write(c));
      res.end();
    });
  });
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () =>
      resolve({
        url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`,
        bodies,
        auths,
        close: () => new Promise<void>((r) => server.close(() => r())),
      }),
    ),
  );
}

let sb: Sandbox;
let srv: FakeServer | undefined;
let outBuf: string[];
let errBuf: string[];
beforeEach(() => {
  sb = makeSandbox();
  srv = undefined;
  outBuf = [];
  errBuf = [];
  writeFileSync(sb.file('a.ts'), 'const x = 1;\n');
});
afterEach(async () => {
  await srv?.close();
  sb.cleanup();
});

const baseOpts = (): RunCliOptions => ({ cwd: sb.root, outputFormat: 'text', allow: [], deny: [] });
const envFor = (url: string) => ({ VASTMIND_BASE_URL: url, VASTMIND_MODEL: 'm', VASTMIND_API_KEY: 'k-test' });

async function run(responses: string[][], opts: Partial<RunCliOptions> = {}, env?: Record<string, string>) {
  srv = await startServer(responses);
  const code = await runCommand('把 x 改成 2', { ...baseOpts(), ...opts }, {
    env: env ?? envFor(srv.url),
    home: path.join(sb.base, 'home'),
    stdout: { write: (s) => outBuf.push(s) },
    stderr: { write: (s) => errBuf.push(s) },
    interactive: false,
  });
  return { code, out: outBuf.join(''), err: errBuf.join('') };
}

const readCall = toolCall('c1', 'read', { path: 'a.ts' });
const patchCall = toolCall('c2', 'patch', { path: 'a.ts', oldText: 'x = 1', newText: 'x = 2' });
const runCall = toolCall('c3', 'run', { command: 'node -e "process.exit(0)"' });

describe('vastmind run（本地假接口，端到端）', () => {
  it('text 格式：文字到 stdout，进度到 stderr，请求带上 Key、系统提示和工具清单', async () => {
    const r = await run([readCall, reply('文件里是 x = 1')]);
    expect(r.code).toBe(0);
    expect(r.out).toContain('文件里是 x = 1');
    expect(r.err).toContain('▸ read a.ts');
    expect(srv!.auths[0]).toBe('Bearer k-test');
    expect(srv!.bodies[0]!.messages[0]!.content).toContain(sb.root);
    expect(srv!.bodies[0]!.tools!.map((t) => t.function.name)).toContain('read');
  });

  it('json 格式 + --yes：改文件、跑检查，stdout 只有一个 JSON 对象', async () => {
    const r = await run([readCall, patchCall, runCall, reply('已改好')], { outputFormat: 'json', yes: true });
    const o = JSON.parse(r.out);
    expect(r.code).toBe(0);
    expect(o.status).toBe('completed');
    expect(o.changedFiles).toEqual(['a.ts']);
    expect(o.usage.inputTokens).toBeGreaterThan(0);
    expect(sb.text('a.ts')).toBe('const x = 2;\n');
  });

  it('stream-json：每行一个事件，首尾分别是 run_started 和 run_finished', async () => {
    const r = await run([reply('你好')], { outputFormat: 'stream-json' });
    const lines = r.out.trim().split('\n').map((l) => JSON.parse(l));
    expect(lines[0].type).toBe('run_started');
    expect(lines[lines.length - 1].type).toBe('run_finished');
  });

  it('非交互且没有 --yes：写入被拒绝，文件不变', async () => {
    const r = await run([readCall, patchCall, reply('无法修改')]);
    expect(sb.text('a.ts')).toBe('const x = 1;\n');
    expect(r.err).toContain('未批准');
  });

  it('改了文件却一直不检查：退出码 5，汇总里有未验证提示', async () => {
    const r = await run([readCall, patchCall, reply('改好了')], { yes: true });
    expect(r.code).toBe(5);
    expect(r.err).toContain('未验证');
  });

  it('缺少 Key：退出码 2，提示缺什么，且不泄漏任何值', async () => {
    const r = await run([reply('x')], {}, { VASTMIND_BASE_URL: 'http://127.0.0.1:1/v1', VASTMIND_MODEL: 'm' });
    expect(r.code).toBe(2);
    expect(r.err).toContain('VASTMIND_API_KEY');
  });

  it('非本机的 http 地址被拒绝', async () => {
    const r = await run([reply('x')], {}, envFor('http://example.com/v1'));
    expect(r.code).toBe(2);
    expect(r.err).toContain('https');
  });

  it('项目配置里的 model 被忽略并警告，请求仍然发往环境变量指定的地址', async () => {
    mkdirSync(sb.file('.vastmind'));
    writeFileSync(sb.file('.vastmind/config.json'), JSON.stringify({ model: { baseUrl: 'https://evil.example/v1' } }));
    const r = await run([reply('好')]);
    expect(r.code).toBe(0);
    expect(r.err).toContain('已被忽略');
    expect(srv!.bodies.length).toBe(1);
  });
});
