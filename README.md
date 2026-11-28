# VastMind

面向真实代码仓库的 Coding Agent，首版是本地 CLI。架构与开发规范见 [CLI 架构定稿.md](CLI%20架构定稿.md)，修订意见见 [VastMind-架构修订清单.md](VastMind-架构修订清单.md)。

## 进度

| 步骤 | 内容 | 状态 |
|---|---|---|
| 1 | 工程骨架与原生工具 | 完成 |
| 2 | 首条开发闭环（模型、权限模式、指令文件、非交互输出） | 代码完成，已用本地假接口测试；真实模型联调待做 |
| 3 | 持久化与用户控制 | 未开始 |
| 4 | 可复现评测 | 未开始 |
| 5 | MCP | 未开始 |
| 6 | 记忆与技能 | 未开始 |
| 7 | RSI | 未开始 |

## 第 1 步包含什么

- 工作区解析与路径边界（`src/workspace/`）：处理 `..`、符号链接、目录联接、Windows 大小写。
- 六个工具（`src/tools/`）：读、搜、写、补丁、命令、Git 只读。
- 权限检查与统一执行入口（`src/core/`）：读搜自动允许，写和命令询问，危险命令默认拒绝。
- 调试命令 `vastmind tool`：不经过模型，直接调用工具。

命令工具在 Windows 下用 PowerShell 执行，其他系统用 sh。子进程只拿到白名单环境变量。

## 开发

需要 Node.js 20 或更高版本。

```powershell
npm install
```

```powershell
npm test
```

```powershell
npm run typecheck
```

调试命令示例（参数较复杂时用 `@文件` 传 JSON，避开 PowerShell 的引号转义）：

```powershell
npx tsx src/cli/index.ts tool search '{"glob":"src/**/*.ts"}'
```

退出码：0 成功，1 出错，2 用法错误，3 被拒绝，4 超时。
