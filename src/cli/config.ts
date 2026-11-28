import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { DEFAULT_POLICY, type PermissionMode, type PermissionPolicy } from '../core/permission.js';
import { sha256 } from '../tools/fsutil.js';

const Mode = z.enum(['default', 'acceptEdits', 'plan']);
const Common = {
  outputDir: z.string(),
  maxSteps: z.number().int().min(1).max(500),
};

const UserFile = z
  .object({
    ...Common,
    model: z.object({ baseUrl: z.string(), name: z.string() }).partial().strict(),
    permissions: z
      .object({ mode: Mode, allow: z.array(z.string()), deny: z.array(z.string()) })
      .partial()
      .strict(),
  })
  .partial()
  .strict();

const ProjectFile = z.object(Common).partial().strict();

// 这些键能改变「代码发往哪里」和「什么可以免询问」，仓库里的配置文件不能决定它们。
const USER_ONLY_KEYS = ['model', 'permissions'] as const;

export interface CliOverrides {
  outputDir?: string;
  maxSteps?: number;
  model?: string;
  mode?: PermissionMode;
  allow?: string[];
  deny?: string[];
}

export interface Config {
  outputDir: string;
  maxSteps: number;
  model: { baseUrl?: string; name?: string };
  permissions: PermissionPolicy;
  warnings: string[];
}

function readJson(file: string): Record<string, unknown> | null {
  if (!existsSync(file)) return null;
  try {
    const v: unknown = JSON.parse(readFileSync(file, 'utf8'));
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new Error('必须是 JSON 对象');
    return v as Record<string, unknown>;
  } catch (e) {
    throw new Error(`配置文件无效：${file}：${e instanceof Error ? e.message : String(e)}`);
  }
}

function parseWith<T extends z.ZodTypeAny>(schema: T, raw: unknown, file: string): z.infer<T> {
  const r = schema.safeParse(raw);
  if (!r.success) {
    const msg = r.error.issues
      .map((i: { path: Array<string | number>; message: string }) => `${i.path.join('.') || '(根)'}: ${i.message}`)
      .join('; ');
    throw new Error(`配置文件无效：${file}：${msg}`);
  }
  return r.data;
}

// 优先级：命令行 > 环境变量 > 项目级 > 用户级 > 默认值（model / permissions 不接受项目级）
export function loadConfig(
  workspaceRoot: string,
  cli: CliOverrides = {},
  home: string = os.homedir(),
  env: NodeJS.ProcessEnv = process.env,
): Config {
  const warnings: string[] = [];
  const userFile = path.join(home, '.vastmind', 'config.json');
  const projectFile = path.join(workspaceRoot, '.vastmind', 'config.json');

  const user = parseWith(UserFile, readJson(userFile) ?? {}, userFile);

  const rawProject = readJson(projectFile) ?? {};
  for (const key of USER_ONLY_KEYS) {
    if (key in rawProject) {
      warnings.push(`项目配置里的 ${key} 已被忽略：出于安全，模型地址和权限只接受用户级配置、环境变量或命令行`);
      delete rawProject[key];
    }
  }
  const project = parseWith(ProjectFile, rawProject, projectFile);

  const outputDir =
    cli.outputDir ?? project.outputDir ?? user.outputDir ??
    path.join(home, '.vastmind', 'output', sha256(workspaceRoot).slice(0, 12));

  return {
    outputDir: path.resolve(workspaceRoot, outputDir),
    maxSteps: cli.maxSteps ?? project.maxSteps ?? user.maxSteps ?? 40,
    model: {
      baseUrl: env.VASTMIND_BASE_URL ?? user.model?.baseUrl,
      name: cli.model ?? env.VASTMIND_MODEL ?? user.model?.name,
    },
    permissions: {
      mode: cli.mode ?? user.permissions?.mode ?? DEFAULT_POLICY.mode,
      allow: [...(user.permissions?.allow ?? []), ...(cli.allow ?? [])],
      deny: [...(user.permissions?.deny ?? []), ...(cli.deny ?? [])],
    },
    warnings,
  };
}
