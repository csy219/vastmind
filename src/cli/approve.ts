import readline from 'node:readline/promises';
import type { Approver } from '../core/execute.js';

export interface Writer {
  write(s: string): unknown;
}

export function makeApprover(o: { yes: boolean; interactive: boolean; err: Writer }): Approver {
  if (o.yes) return async () => true; // 内置拒绝清单仍然先于审批生效
  if (!o.interactive) {
    return async (reason) => {
      o.err.write(`未批准（非交互模式；用 --yes 放行，或用 --permission-mode acceptEdits 自动放行写入）：${reason}\n`);
      return false;
    };
  }
  return async (reason) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
    const answer = await rl.question(`${reason}\n允许？[y/N] `);
    rl.close();
    return /^y(es)?$/i.test(answer.trim());
  };
}
