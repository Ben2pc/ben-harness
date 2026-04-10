---
name: codex-agent
description: 通过 CLI 模式调用 Codex，将编码、审查、问答等任务委派给 Codex（GPT-5.4）。支持多轮对话自动续接（exec resume）、多 session 并行。当用户要求使用 Codex 完成任务时触发。
argument-hint: [任务描述]
---

# Codex Agent

通过 Codex CLI 将任务委派给 Codex 执行。

## 前置条件

1. 安装 Codex CLI：`npm install -g @openai/codex`
2. 确保已完成 Codex 登录认证（`codex` 首次运行会引导登录）

## 调用方式

### 新建会话

```bash
codex exec --json --sandbox workspace-write --skip-git-repo-check --model gpt-5.4 "你的任务描述"
```

**输出为 JSONL**，逐行解析。关键事件：

```jsonl
{"type":"thread.started","thread_id":"019d32fc-..."}
{"type":"turn.started"}
{"type":"item.completed","item":{"id":"...","type":"agent_message","text":"回复内容"}}
{"type":"turn.completed","usage":{"input_tokens":...,"output_tokens":...}}
```

- 从 `thread.started` 事件中提取 `thread_id`，用于后续多轮对话
- 从 `item.completed` 事件（`type: "agent_message"`）中提取 `text` 作为 Codex 的回复

### 继续会话

```bash
codex exec resume --json --model gpt-5.4 "thread_id" "后续提问"
```

注意：`resume` 子命令支持的 flags 与 `exec` 不同，详见下方参数表。

## codex exec 参数

| Flag | 说明 |
|------|------|
| `--json` | JSONL 格式输出，便于解析 |
| `-s, --sandbox MODE` | 沙箱模式：`read-only` / `workspace-write` / `danger-full-access` |
| `--full-auto` | 快捷方式：`-a on-request` + `--sandbox workspace-write`，自动批准 |
| `--dangerously-bypass-approvals-and-sandbox` | 跳过所有确认和沙箱，极度危险 |
| `-m, --model MODEL` | 指定模型，默认 gpt-5.4 |
| `-C, --cd DIR` | 指定工作目录 |
| `--skip-git-repo-check` | 允许在非 git 目录运行 |
| `--add-dir DIR` | 额外可写目录（可重复） |
| `-i, --image FILE` | 附加图片（可重复） |
| `-c, --config key=value` | 覆盖 config.toml 配置项 |
| `-p, --profile PROFILE` | 使用 config.toml 中的配置 profile |
| `--color COLOR` | 颜色输出：`always` / `never` / `auto` |
| `--ephemeral` | 不持久化会话文件 |
| `--output-schema FILE` | 指定响应的 JSON Schema |
| `-o, --output-last-message FILE` | 将最后一条消息写入文件 |
| `--enable FEATURE` | 启用特性（可重复） |
| `--disable FEATURE` | 禁用特性（可重复） |

## codex exec resume 参数

| Flag | 说明 |
|------|------|
| `--json` | JSONL 格式输出 |
| `-m, --model MODEL` | 指定模型 |
| `--full-auto` | 自动批准 |
| `--dangerously-bypass-approvals-and-sandbox` | 跳过确认和沙箱 |
| `--skip-git-repo-check` | 允许非 git 目录 |
| `--ephemeral` | 不持久化 |
| `-i, --image FILE` | 附加图片 |
| `-o, --output-last-message FILE` | 最后消息写入文件 |
| `-c, --config key=value` | 覆盖 config.toml 配置项 |
| `--enable FEATURE` | 启用特性（可重复） |
| `--disable FEATURE` | 禁用特性（可重复） |
| `--last` | 恢复最近一次会话（无需指定 ID） |
| `--all` | 显示所有会话（不限当前目录） |

## codex exec review 参数

内置代码审查子命令，针对当前仓库进行 review：

```bash
codex exec review [OPTIONS] [PROMPT]
```

| Flag | 说明 |
|------|------|
| `--uncommitted` | 审查暂存、未暂存和未跟踪的变更 |
| `--base BRANCH` | 对比指定基准分支 |
| `--commit SHA` | 审查指定 commit 引入的变更 |
| `--title TITLE` | review 摘要中显示的标题 |
| `-m, --model MODEL` | 指定模型 |
| `--json` | JSONL 格式输出 |
| `--full-auto` | 自动批准 |
| `--ephemeral` | 不持久化 |
| `-o, --output-last-message FILE` | 最后消息写入文件 |

## 多轮对话

1. 首次 `codex exec --json ...` 获取 `thread_id`
2. 后续追问用 `codex exec resume --json "thread_id" "prompt"`
3. 自动跟踪 `thread_id`，用户无需关心
4. 不同任务各自新建会话，多个 `thread_id` 互不干扰

## 模型选择

根据任务复杂度显式指定 `--model`：

| 任务复杂度 | model | 适用场景 |
|-----------|-------|---------|
| 高 | `gpt-5.4` | 架构设计、复杂重构、多文件编码 |
| 中 | `gpt-5.4-mini` | 单文件功能实现、bug 修复 |
| 低 | `gpt-5.3-codex-spark` | 简单问答、代码解释 |

## 推荐参数组合

| 场景 | model | sandbox | 其他 flags |
|------|-------|---------|-----------|
| 复杂编码 | `gpt-5.4` | `workspace-write` | `--full-auto` |
| 一般编码 | `gpt-5.4` | `workspace-write` | `--full-auto` |
| 代码审查 | `gpt-5.4-mini` | `read-only` | — |
| 代码审查（review） | `gpt-5.4-mini` | — | `codex exec review --base main` |
| 快速问答 | `gpt-5.4-mini` | `read-only` | `--skip-git-repo-check` |

## 使用规则

1. **始终用 `--json`**：确保输出可解析，提取 `thread_id` 和回复内容
2. **始终显式传 `--model`**：根据任务复杂度选择合适模型
3. **始终在目标项目目录下运行**（用 `cd` 或 `-C` 切到项目目录）
4. **编码任务用 `--sandbox workspace-write`**：平衡安全与效率
5. **审查任务用 `--sandbox read-only`** 或 `codex exec review`：防止意外修改
6. **保持对话连续**：同一任务的追问复用 `thread_id`，不要每次都新建会话
7. **向用户报告结果**：每次调用后，从 JSONL 中提取 Codex 的回复，简要总结给用户

## 示例

### 编码任务

```
用户：用 Codex 在当前项目里实现一个 TODO API

步骤 1 - 新建会话：
cd /path/to/project && codex exec --json --sandbox workspace-write --full-auto --model gpt-5.4 "Implement a REST API for TODO items with CRUD endpoints. Use Express.js."

→ 解析输出，获得 thread_id: "xxx"，回复: "已创建 server.js ..."

用户：加上单元测试

步骤 2 - 继续会话：
cd /path/to/project && codex exec resume --json --model gpt-5.4-mini "xxx" "Add unit tests for all the TODO API endpoints using vitest."
```

### 代码审查

```bash
# 通用审查
cd /path/to/project && codex exec --json --sandbox read-only --model gpt-5.4-mini "Review the changes in git diff HEAD~1. Focus on security issues and performance."

# 内置 review（对比 main 分支）
cd /path/to/project && codex exec review --json --model gpt-5.4-mini --base main

# 审查未提交变更
cd /path/to/project && codex exec review --json --model gpt-5.4-mini --uncommitted
```
