import { readFileSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { guardPath } from '../tools/guard.js';

const MAX_CHARS = 20_000;
const PROJECT_FILES = ['VASTMIND.md', 'AGENTS.md'];

export interface Instructions {
  sources: string[];
  text: string;
  warnings: string[];
}

const clip = (s: string) => (s.length > MAX_CHARS ? s.slice(0, MAX_CHARS) + '\n…[已截断]' : s);

export function loadInstructions(workspaceRoot: string, home: string = os.homedir()): Instructions {
  const parts: string[] = [];
  const sources: string[] = [];
  const warnings: string[] = [];

  const userFile = path.join(home, '.vastmind', 'VASTMIND.md');
  if (statSync(userFile, { throwIfNoEntry: false })?.isFile()) {
    parts.push(`# 用户级说明\n${clip(readFileSync(userFile, 'utf8'))}`);
    sources.push(userFile);
  }

  for (const name of PROJECT_FILES) {
    const g = guardPath(workspaceRoot, name);
    if ('fail' in g) {
      warnings.push(`${name} 指向工作区外，已忽略`);
      continue;
    }
    if (!statSync(g.abs, { throwIfNoEntry: false })?.isFile()) continue;
    parts.push(`# 项目说明（${name}）\n${clip(readFileSync(g.abs, 'utf8'))}`);
    sources.push(g.abs);
    break; // 两个文件只取第一个，VASTMIND.md 优先
  }

  return { sources, text: parts.join('\n\n'), warnings };
}
