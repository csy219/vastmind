import type { SideEffect } from '../tools/types.js';

export type Decision =
  | { kind: 'allow' }
  | { kind: 'ask'; reason: string }
  | { kind: 'deny'; reason: string };

export type PermissionMode = 'default' | 'acceptEdits' | 'plan';

export interface PermissionPolicy {
  mode: PermissionMode;
  allow: string[]; // 例：'run(npm test:*)'、'write'
  deny: string[];  // 例：'run(npm publish:*)'
}

export const DEFAULT_POLICY: PermissionPolicy = { mode: 'default', allow: [], deny: [] };

export interface PermissionRequest {
  tool: string;
  sideEffect: SideEffect;
  args: unknown;
}

// 拒绝清单是安全带，不是沙箱：正则可被绕过，真正的防线是对每条命令的 ask 审批。
const DENY: Array<{ re: RegExp; reason: string }> = [
  { re: /\brm\s+(-\S*\s+)*-\S*[rR]/, reason: '递归删除' },
  { re: /\b(rd|rmdir)\b.*\/s\b/i, reason: '递归删除目录' },
  { re: /\bdel\b.*\/[sq]\b/i, reason: '批量删除文件' },
  { re: /Remove-Item\b.*-Recurse/i, reason: '递归删除' },
  { re: /\bformat\s+[a-z]:/i, reason: '格式化磁盘' },
  { re: /\b(curl|wget)\b[^|]*\|\s*(sh|bash|zsh|pwsh|powershell)\b/i, reason: '下载后直接执行' },
  { re: /\b(iwr|Invoke-WebRequest)\b.*\|\s*(iex|Invoke-Expression)\b/i, reason: '下载后直接执行' },
  { re: /\bgit\s+push\b.*(--force|\s-f\b)/, reason: '强制推送' },
  { re: /\bgit\s+reset\s+--hard\b/, reason: '丢弃本地改动' },
  { re: /\bgit\s+clean\s+-\S*f/, reason: '删除未跟踪文件' },
];

const CHAIN = /[;&|`\r\n<>]|\$\(/; // 串联、管道、重定向、命令替换

function commandOf(req: PermissionRequest): string {
  return String((req.args as { command?: unknown }).command ?? '').trim();
}

function matchPrefix(command: string, pattern: string): boolean {
  if (pattern.endsWith(':*')) {
    const prefix = pattern.slice(0, -2);
    return command === prefix || command.startsWith(prefix + ' ');
  }
  return command === pattern;
}

// kind='deny' 时按串联拆开逐段匹配（尽量多拦）；kind='allow' 时命令里有串联就不匹配（尽量少放）。
function matchRule(rule: string, req: PermissionRequest, kind: 'allow' | 'deny'): boolean {
  const m = /^(\w+)(?:\((.*)\))?$/.exec(rule.trim());
  if (!m || m[1] !== req.tool) return false;
  const pattern = m[2];
  if (pattern === undefined) return true;        // 规则作用于整个工具
  if (req.tool !== 'run') return false;          // v1：带参数的规则只支持 run

  const command = commandOf(req);
  if (kind === 'allow') return !CHAIN.test(command) && matchPrefix(command, pattern);
  return command.split(/[;&|\r\n`]+|\$\(/).some((seg) => matchPrefix(seg.trim(), pattern));
}

export function checkPermission(
  req: PermissionRequest,
  policy: PermissionPolicy = DEFAULT_POLICY,
): Decision {
  if (req.tool === 'run') {
    const command = commandOf(req);
    for (const rule of DENY) {
      if (rule.re.test(command)) return { kind: 'deny', reason: rule.reason };
    }
  }
  if (policy.deny.some((r) => matchRule(r, req, 'deny'))) {
    return { kind: 'deny', reason: '命中拒绝规则' };
  }
  if (req.sideEffect === 'none') return { kind: 'allow' };

  if (policy.mode === 'plan') {
    return { kind: 'deny', reason: '计划模式只读，不允许写入或执行命令' };
  }
  if (policy.allow.some((r) => matchRule(r, req, 'allow'))) return { kind: 'allow' };
  if (policy.mode === 'acceptEdits' && req.sideEffect === 'write') return { kind: 'allow' };

  return req.tool === 'run'
    ? { kind: 'ask', reason: `执行命令：${commandOf(req)}` }
    : { kind: 'ask', reason: `写入：${req.tool}` };
}
