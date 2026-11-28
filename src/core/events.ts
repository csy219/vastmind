import type { Usage } from '../model/types.js';
import type { ToolResult } from '../tools/types.js';
import type { PermissionMode } from './permission.js';

export type RunStatus = 'completed' | 'unverified' | 'blocked' | 'error' | 'aborted';

export interface TodoItem {
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
}

export interface CheckRecord {
  command: string;
  exitCode: number | null;
  ok: boolean;
}

export type AgentEvent =
  | { type: 'run_started'; workspaceRoot: string; mode: PermissionMode }
  | { type: 'text_delta'; text: string }
  | { type: 'tool_started'; id: string; name: string; input: unknown }
  | { type: 'tool_finished'; id: string; name: string; result: ToolResult }
  | { type: 'todo_updated'; items: TodoItem[] }
  | { type: 'gate_blocked'; reason: string }
  | {
      type: 'run_finished';
      status: RunStatus;
      summary: string;
      changedFiles: string[];
      checks: CheckRecord[];
      usage: Usage;
      steps: number;
    };
