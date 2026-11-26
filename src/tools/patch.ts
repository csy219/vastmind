import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { atomicWrite, sha256 } from './fsutil.js';
import { fail, guardPath } from './guard.js';
import { defineTool } from './types.js';

export const patchTool = defineTool({
  name: 'patch',
  description: '把文件中唯一出现的 oldText 替换为 newText。oldText 出现 0 次或多于 1 次都会失败。',
  schema: z.object({
    path: z.string(),
    oldText: z.string().min(1),
    newText: z.string(),
    expectedFileHash: z.string().optional(), // 上次读取时文件内容的 sha256，由核心填入
  }),
  sideEffect: 'write',
  async run(args, ctx) {
    const g = guardPath(ctx.workspaceRoot, args.path);
    if ('fail' in g) return g.fail;

    let raw: string;
    try { raw = readFileSync(g.abs, 'utf8'); } catch { return fail(`文件不存在：${args.path}`); }

    if (args.expectedFileHash && sha256(raw) !== args.expectedFileHash) {
      return fail(`文件已被修改，与上次读取的版本不一致：${args.path}。请重新读取后再改`);
    }

    // 以 LF 匹配，写回时还原原文件的换行风格（Windows 上常见 CRLF）
    const crlf = raw.includes('\r\n');
    const text = crlf ? raw.replace(/\r\n/g, '\n') : raw;
    const oldText = args.oldText.replace(/\r\n/g, '\n');
    const newText = args.newText.replace(/\r\n/g, '\n');

    const first = text.indexOf(oldText);
    if (first === -1) return fail('未找到 oldText，请重新读取文件，确认内容与缩进完全一致');
    if (text.indexOf(oldText, first + 1) !== -1) {
      return fail('oldText 出现多次，请带上更多上下文使其唯一');
    }

    const replaced = text.slice(0, first) + newText + text.slice(first + oldText.length);
    const out = crlf ? replaced.replace(/\n/g, '\r\n') : replaced;
    atomicWrite(g.abs, out);

    return { ok: true, status: 'ok', summary: `已修改 ${args.path}，新哈希 ${sha256(out)}` };
  },
});
