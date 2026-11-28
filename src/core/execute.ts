import { getTool } from '../tools/registry.js';
import type { ToolContext, ToolResult } from '../tools/types.js';
import { checkPermission, DEFAULT_POLICY, type PermissionPolicy } from './permission.js';

export type Approver = (reason: string) => Promise<boolean>;

const denied = (summary: string): ToolResult => ({ ok: false, status: 'denied', summary });

export async function executeTool(
  name: string,
  rawArgs: unknown,
  ctx: ToolContext,
  approve: Approver,
  policy: PermissionPolicy = DEFAULT_POLICY,
): Promise<ToolResult> {
  const tool = getTool(name);
  if (!tool) return { ok: false, status: 'error', summary: `未知工具：${name}` };

  const parsed = tool.schema.safeParse(rawArgs);
  if (!parsed.success) {
    const msg = parsed.error.issues
      .map((i: { path: Array<string | number>; message: string }) => `${i.path.join('.') || '(根)'}: ${i.message}`)
      .join('; ');
    return { ok: false, status: 'error', summary: `参数无效：${msg}` };
  }

  const decision = checkPermission({ tool: tool.name, sideEffect: tool.sideEffect, args: parsed.data }, policy);
  if (decision.kind === 'deny') return denied(`已拒绝：${decision.reason}`);
  if (decision.kind === 'ask' && !(await approve(decision.reason))) return denied('用户未批准');

  try {
    return await tool.run(parsed.data, ctx);
  } catch (e) {
    return { ok: false, status: 'error', summary: `工具异常：${e instanceof Error ? e.message : String(e)}` };
  }
}
