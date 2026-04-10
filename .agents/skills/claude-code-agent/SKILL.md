---
name: claude-code-agent
description: 通过 CLI 模式调用 Claude Code，将编码、审查、问答等任务委派给另一个 Claude Code 实例。支持多轮对话自动续接（--resume）、多 session 并行。当用户要求使用 Claude Code 子进程完成任务时触发。
argument-hint: [任务描述]
---

# Claude Code Agent

通过 Claude Code CLI 将任务委派给独立的 Claude Code 实例执行。

## 前置条件

1. 安装 Claude Code CLI：`npm install -g @anthropic-ai/claude-code`
2. 确保已完成认证（`claude auth login`）

## 调用方式

### 新建会话

```bash
claude -p "你的任务描述" --output-format json --permission-mode bypassPermissions --model opus --effort high
```

**返回 JSON**，关键字段：

```json
{
  "type": "result",
  "subtype": "success",
  "result": "回复内容",
  "session_id": "78da0eae-...",
  "total_cost_usd": 0.074,
  "usage": { "input_tokens": 5, "output_tokens": 463 }
}
```

- 提取 `session_id` 用于后续多轮对话
- 从 `result` 提取回复内容
- `is_error` 判断是否出错

### 继续会话

```bash
claude -p "后续提问" --output-format json --permission-mode bypassPermissions --resume "session_id"
```

### 继续最近会话（快捷方式）

```bash
claude -p "后续提问" --output-format json --permission-mode bypassPermissions --continue
```

`--continue` 自动加载当前目录最近一次会话，无需指定 session_id。

## claude -p 参数

### 输出控制

| Flag | 说明 |
|------|------|
| `-p, --print` | 非交互模式，输出结果后退出 |
| `--output-format FORMAT` | `text`（默认）/ `json` / `stream-json` |
| `--verbose` | 显示完整的中间步骤 |
| `--include-partial-messages` | 流式输出部分消息（需配合 `stream-json`） |
| `--json-schema SCHEMA` | 指定输出的 JSON Schema，约束结构化输出 |

### 会话管理

| Flag | 说明 |
|------|------|
| `--resume SESSION_ID` | 恢复指定会话 |
| `-c, --continue` | 恢复当前目录最近会话 |
| `--session-id UUID` | 使用指定 UUID 作为会话 ID |
| `--fork-session` | resume 时创建新 session（分叉） |
| `--from-pr NUMBER` | 恢复关联到指定 PR 的会话 |
| `-n, --name NAME` | 为会话设置显示名称 |
| `--no-session-persistence` | 不持久化会话 |

### 权限控制

| Flag | 说明 |
|------|------|
| `--permission-mode MODE` | `default` / `acceptEdits` / `plan` / `auto` / `dontAsk` / `bypassPermissions` |
| `--allowedTools TOOLS` | 预批准特定工具，如 `"Bash(git:*),Read,Edit"` |
| `--disallowedTools TOOLS` | 禁用特定工具 |
| `--tools TOOLS` | 限制可用工具集，`""` 禁用全部，`"default"` 全部 |
| `--dangerously-skip-permissions` | 跳过所有权限检查 |

### 模型与成本

| Flag | 说明 |
|------|------|
| `--model MODEL` | 指定模型：`sonnet` / `opus` / 完整模型名 |
| `--effort LEVEL` | 思考力度：`low` / `medium` / `high` / `max` |
| `--max-budget-usd AMOUNT` | 最大花费限制 |
| `--fallback-model MODEL` | 过载时自动降级模型 |

### 上下文注入

| Flag | 说明 |
|------|------|
| `--system-prompt PROMPT` | 替换默认系统提示词 |
| `--append-system-prompt PROMPT` | 追加到默认系统提示词 |
| `--system-prompt-file FILE` | 从文件加载系统提示词 |
| `--append-system-prompt-file FILE` | 从文件追加系统提示词 |
| `--add-dir DIR` | 添加额外可访问目录（可重复） |
| `--mcp-config CONFIG` | 加载 MCP server 配置（JSON 文件或字符串） |

### 高级选项

| Flag | 说明 |
|------|------|
| `--bare` | 最小模式：跳过 hooks、skills、CLAUDE.md 等全部自动加载 |
| `--disable-slash-commands` | 仅禁用 skills（`-p` 模式下无需加，skills 本身不会触发） |
| `-w, --worktree NAME` | 在 git worktree 中隔离运行 |
| `--file SPEC` | 附加文件，格式 `file_id:relative_path`（可重复） |
| `--input-format FORMAT` | 输入格式：`text`（默认）/ `stream-json` |
| `--agent AGENT` | 指定子 agent |

## 多轮对话

1. 首次 `claude -p ... --output-format json` 获取 `session_id`
2. 后续追问用 `claude -p ... --resume "session_id"`
3. 自动跟踪 `session_id`，用户无需关心
4. 不同任务各自新建会话，多个 `session_id` 互不干扰

## 模型与 effort 选择

根据任务复杂度显式指定 `--model` 和 `--effort`：

| 任务复杂度 | model | effort | 适用场景 |
|-----------|-------|--------|---------|
| 高 | `opus` | `high` | 架构设计、复杂重构、多文件编码 |
| 中 | `opus` | `medium` | 单文件功能实现、bug 修复 |
| 低 | `sonnet` | `medium` | 简单问答、代码解释、格式化 |

## 推荐参数组合

| 场景 | model | effort | permission-mode | 其他 flags |
|------|-------|--------|-----------------|-----------|
| 复杂编码 | `opus` | `high` | `bypassPermissions` | — |
| 一般编码 | `opus` | `high` | `bypassPermissions` | — |
| 代码审查 | `opus` | `medium` | `plan` | `--allowedTools "Read,Grep,Glob"` |
| 快速问答 | `sonnet` | `medium` | `bypassPermissions` | `--no-session-persistence` |
| 隔离执行 | `opus` | `high` | `bypassPermissions` | `--worktree feature-x` |

## 使用规则

1. **始终用 `--output-format json`**：确保输出可解析，提取 `session_id` 和 `result`
3. **始终显式传 `--model` 和 `--effort`**：根据任务复杂度选择
4. **始终在目标项目目录下运行**（用 `cd` 切到项目目录）
5. **编码任务用 `--permission-mode bypassPermissions`**：避免子进程交互式确认
6. **审查任务限制工具**：`--allowedTools "Read,Grep,Glob"` 防止意外修改
7. **保持对话连续**：同一任务的追问复用 `session_id`
8. **向用户报告结果**：从 JSON 中提取 `result` 字段，简要总结给用户
9. **关注成本**：从 `total_cost_usd` 跟踪花费，长任务建议设 `--max-budget-usd`

## 示例

### 编码任务

```
用户：用 Claude Code 在当前项目里实现一个 TODO API

步骤 1 - 新建会话：
cd /path/to/project && claude -p "Implement a REST API for TODO items with CRUD endpoints. Use Express.js." --output-format json --permission-mode bypassPermissions --model opus --effort high

→ 解析 JSON，获得 session_id: "xxx"，result: "已创建 server.js ..."

用户：加上单元测试

步骤 2 - 继续会话：
cd /path/to/project && claude -p "Add unit tests for all the TODO API endpoints using vitest." --output-format json --permission-mode bypassPermissions --model opus --effort medium --resume "xxx"
```

### 代码审查

```
cd /path/to/project && claude -p "Review the changes in git diff HEAD~1. Focus on security issues and performance." --output-format json --permission-mode plan --model opus --effort medium --allowedTools "Read,Grep,Glob,Bash(git:*)"
```

### 快速问答

```
claude -p "Explain what this function does" --output-format json --model sonnet --effort medium --no-session-persistence
```
