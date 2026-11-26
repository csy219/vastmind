import { z } from 'zod';

export interface ToolResult {
  ok: boolean;
  status: 'ok' | 'error' | 'denied' | 'timeout';
  summary: string;            // 给模型和用户看的限长文本
  outputRef?: string;         // 输出被截断时，完整内容所在的文件
  exitCode?: number | null;   // 仅命令类工具有意义
}

export interface ToolContext {
  workspaceRoot: string;      // 已是真实路径
  hasGit: boolean;
  outputDir: string;          // 完整输出的落盘目录
  signal?: AbortSignal;       // 用于 Ctrl+C 中止
}

export type SideEffect = 'none' | 'write' | 'exec';

export interface Tool<S extends z.ZodTypeAny = z.ZodTypeAny> {
  name: string;
  description: string;
  schema: S;
  sideEffect: SideEffect;
  run(args: z.infer<S>, ctx: ToolContext): Promise<ToolResult>;
}

export function defineTool<S extends z.ZodTypeAny>(tool: Tool<S>): Tool<S> {
  return tool;
}
