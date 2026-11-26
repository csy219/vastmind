import fg from 'fast-glob';
import ignoreModule, { type Ignore } from 'ignore';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { fail } from './guard.js';
import { limitOutput } from './output.js';
import { defineTool } from './types.js';

// ignore 的类型声明在 NodeNext 下把默认导出标成命名空间，运行时它就是工厂函数
const ignore = ignoreModule as unknown as () => Ignore;

const ALWAYS_IGNORE =['**/node_modules/**', '**/.git/**', '**/dist/**'];
const MAX_FILE_BYTES = 1024 * 1024;

export const searchTool = defineTool({
  name: 'search',
  description: '按 glob 列文件；给出 pattern（正则）时在匹配的文件内逐行搜索，返回 路径:行号:内容。',
  schema: z.object({
    glob: z.string().default('**/*'),
    pattern: z.string().optional(),
    maxResults: z.number().int().min(1).max(1000).default(200),
  }),
  sideEffect: 'none',
  async run(args, ctx) {
    let re: RegExp | undefined;
    if (args.pattern !== undefined) {
      try { re = new RegExp(args.pattern); } catch { return fail(`正则无效：${args.pattern}`); }
    }

    const root = ctx.workspaceRoot;
    const ig = ignore();
    const gitignore = path.join(root, '.gitignore');
    if (existsSync(gitignore)) ig.add(readFileSync(gitignore, 'utf8'));

    const files = (
      await fg(args.glob, {
        cwd: root, ignore: ALWAYS_IGNORE, onlyFiles: true, dot: true, followSymbolicLinks: false,
      })
    ).filter((f) => !ig.ignores(f)).sort();

    const out: string[] = [];
    for (const f of files) {
      if (out.length >= args.maxResults) break;
      if (!re) { out.push(f); continue; }

      const abs = path.join(root, f);
      if (statSync(abs).size > MAX_FILE_BYTES) continue;
      const buf = readFileSync(abs);
      if (buf.subarray(0, 8000).includes(0)) continue;

      const lines = buf.toString('utf8').split('\n');
      for (let i = 0; i < lines.length && out.length < args.maxResults; i++) {
        const line = lines[i] ?? '';
        if (re.test(line)) out.push(`${f}:${i + 1}:${line.trim().slice(0, 300)}`);
      }
    }

    const lim = limitOutput(out.join('\n') || '（无匹配）', ctx.outputDir);
    return { ok: true, status: 'ok', summary: lim.text, outputRef: lim.outputRef };
  },
});
