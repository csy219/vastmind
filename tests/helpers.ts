import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { executeTool, type Approver } from '../src/core/execute.js';
import type { ToolContext } from '../src/tools/types.js';

export interface Sandbox {
  base: string;
  root: string;
  ctx: ToolContext;
  file: (name: string) => string;
  text: (name: string) => string;
  call: (name: string, args: unknown, approve?: Approver) => ReturnType<typeof executeTool>;
  cleanup: () => void;
}

export const yes: Approver = async () => true;

export function makeSandbox(): Sandbox {
  const base = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'vm-t-')));
  const root = path.join(base, 'ws');
  mkdirSync(root);
  const sb: Sandbox = {
    base,
    root,
    ctx: { workspaceRoot: root, hasGit: false, outputDir: path.join(base, 'out') },
    file: (name) => path.join(root, name),
    text: (name) => readFileSync(path.join(root, name), 'utf8'),
    call: (name, args, approve = yes) => executeTool(name, args, sb.ctx, approve),
    cleanup: () => rmSync(base, { recursive: true, force: true }),
  };
  return sb;
}
