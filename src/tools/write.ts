import { existsSync, statSync } from 'node:fs';
import { z } from 'zod';
import { atomicWrite } from './fsutil.js';
import { fail, guardPath } from './guard.js';
import { defineTool } from './types.js';

export const writeTool = defineTool({
  name: 'write',
  description: '创建或整体覆盖文件。文件已存在时必须显式设置 overwrite=true；局部修改请用 patch。',
  schema: z.object({
    path: z.string(),
    content: z.string(),
    overwrite: z.boolean().default(false),
  }),
  sideEffect: 'write',
  async run(args, ctx) {
    const g = guardPath(ctx.workspaceRoot, args.path);
    if ('fail' in g) return g.fail;

    const exists = existsSync(g.abs);
    if (exists && statSync(g.abs).isDirectory()) return fail(`目标是目录：${args.path}`);
    if (exists && !args.overwrite) {
      return fail(`文件已存在：${args.path}。局部修改请用 patch；确需整体覆盖请设置 overwrite=true`);
    }

    atomicWrite(g.abs, args.content);
    const bytes = Buffer.byteLength(args.content, 'utf8');
    return { ok: true, status: 'ok', summary: `${exists ? '已覆盖' : '已创建'} ${args.path}（${bytes} 字节）` };
  },
});
