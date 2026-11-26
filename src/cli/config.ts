import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { sha256 } from '../tools/fsutil.js';

const FileSchema = z.object({ outputDir: z.string() }).partial().strict();

export interface Config {
  outputDir: string;   // 工具完整输出的落盘目录
}

function readLayer(file: string): Partial<Config> {
  if (!existsSync(file)) return {};
  try {
    return FileSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
  } catch (e) {
    throw new Error(`配置文件无效：${file}：${e instanceof Error ? e.message : String(e)}`);
  }
}

// 优先级：默认值 < 用户级 < 项目级 < 命令行
export function loadConfig(
  workspaceRoot: string,
  cli: Partial<Config> = {},
  home: string = os.homedir(),
): Config {
  const defaults: Config = {
    outputDir: path.join(home, '.vastmind', 'output', sha256(workspaceRoot).slice(0, 12)),
  };
  const user = readLayer(path.join(home, '.vastmind', 'config.json'));
  const project = readLayer(path.join(workspaceRoot, '.vastmind', 'config.json'));

  const merged: Config = { ...defaults, ...user, ...project, ...cli };
  return { ...merged, outputDir: path.resolve(workspaceRoot, merged.outputDir) };
}
