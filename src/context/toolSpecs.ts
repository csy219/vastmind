import { zodToJsonSchema } from 'zod-to-json-schema';
import type { PermissionMode } from '../core/permission.js';
import type { ToolSpec } from '../model/types.js';
import type { AnyTool } from '../tools/registry.js';

export function toToolSpecs(tools: AnyTool[], mode: PermissionMode): ToolSpec[] {
  return tools
    .filter((t) => mode !== 'plan' || t.sideEffect === 'none') // 计划模式下干脆不给写入类工具
    .map((t) => {
      const { $schema: _omit, ...schema } = zodToJsonSchema(t.schema) as Record<string, unknown>;
      return { name: t.name, description: t.description, inputSchema: schema };
    });
}
