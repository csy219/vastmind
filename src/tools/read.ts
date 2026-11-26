import { readFileSync, statSync } from 'node:fs';
import { z } from 'zod';
import { fail, guardPath } from './guard.js';
import { limitOutput } from './output.js';
import { defineTool } from './types.js';

const MAX_BYTES = 2 * 1024 * 1024;

export const readTool = defineTool({
  name: 'read',
  description: '读取文本文件，可按行范围。输出每行带行号前缀（行号与制表符），修改文件时不要把前缀写进补丁。',
  schema: z.object({
    path: z.string(),
    startLine: z.number().int().min(1).optional(),
    endLine: z.number().int().min(1).optional(),
  }),
  sideEffect: 'none',
  async run(args, ctx) {
    const g = guardPath(ctx.workspaceRoot, args.path);
    if ('fail' in g) return g.fail;

    let st;
    try { st = statSync(g.abs); } catch { return fail(`文件不存在：${args.path}`); }
    if (!st.isFile()) return fail(`不是文件：${args.path}`);
    if (st.size > MAX_BYTES) return fail(`文件过大（${st.size} 字节），请改用 search 定位后按行范围读取`);

    const buf = readFileSync(g.abs);
    if (buf.subarray(0, 8000).includes(0)) return fail('疑似二进制文件，已拒绝读取');

    const lines = buf.toString('utf8').split(/\r?\n/);
    const start = args.startLine ?? 1;
    const end = Math.min(args.endLine ?? lines.length, lines.length);
    if (start > lines.length) return fail(`起始行 ${start} 超出文件总行数 ${lines.length}`);

    const body = lines.slice(start - 1, end).map((l, i) => `${start + i}\t${l}`).join('\n');
    const lim = limitOutput(body, ctx.outputDir);
    return { ok: true, status: 'ok', summary: lim.text, outputRef: lim.outputRef };
  },
});
