import type { SideEffect } from '../tools/types.js';

export type Decision =
  | { kind: 'allow' }
  | { kind: 'ask'; reason: string }
  | { kind: 'deny'; reason: string };

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

export function checkPermission(req: PermissionRequest): Decision {
  if (req.sideEffect === 'none') return { kind: 'allow' };

  if (req.tool === 'run') {
    const command = String((req.args as { command?: unknown }).command ?? '');
    for (const rule of DENY) {
      if (rule.re.test(command)) return { kind: 'deny', reason: rule.reason };
    }
    return { kind: 'ask', reason: `执行命令：${command}` };
  }

  return { kind: 'ask', reason: `写入：${req.tool}` };
}
