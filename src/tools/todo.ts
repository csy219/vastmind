import { z } from 'zod';
import { fail } from './guard.js';
import { defineTool } from './types.js';

const MARK = { pending: '[ ]', in_progress: '[~]', completed: '[x]' } as const;

export const todoTool = defineTool({
  name: 'todo',
  description:
    '维护任务清单。每次调用提交完整清单（覆盖旧的）。复杂或多步任务开工前先列清单；' +
    '同一时间最多一项 in_progress；完成一项就立刻标记 completed。',
  schema: z.object({
    items: z
      .array(
        z.object({
          content: z.string().min(1),
          status: z.enum(['pending', 'in_progress', 'completed']),
        }),
      )
      .max(30),
  }),
  sideEffect: 'none',
  async run(args) {
    if (args.items.filter((i) => i.status === 'in_progress').length > 1) {
      return fail('同一时间只能有一项 in_progress');
    }
    const text = args.items.map((i) => `${MARK[i.status]} ${i.content}`).join('\n');
    return { ok: true, status: 'ok', summary: text || '（清单为空）' };
  },
});
