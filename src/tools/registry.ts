import { gitTool } from './git.js';
import { patchTool } from './patch.js';
import { readTool } from './read.js';
import { runTool } from './run.js';
import { searchTool } from './search.js';
import { todoTool } from './todo.js';
import type { Tool } from './types.js';
import { writeTool } from './write.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyTool = Tool<any>;

export const TOOLS: AnyTool[] = [readTool, searchTool, writeTool, patchTool, runTool, gitTool, todoTool];

export function getTool(name: string): AnyTool | undefined {
  return TOOLS.find((t) => t.name === name);
}
