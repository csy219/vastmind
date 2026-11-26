import { resolveSafe, PathEscapeError } from '../workspace/safePath.js';
import type { ToolResult } from './types.js';

export type Guarded = { abs: string } | { fail: ToolResult };

export const fail = (summary: string): ToolResult => ({ ok: false, status: 'error', summary });

export function guardPath(root: string, requested: string): Guarded {
  try {
    return { abs: resolveSafe(root, requested) };
  } catch (e) {
    if (e instanceof PathEscapeError) {
      return { fail: { ok: false, status: 'denied', summary: e.message } };
    }
    throw e;
  }
}
