---
name: claude-code-agent
description: 通过 Claude Code CLI 的 `claude -p` Agent SDK 入口，将编码、审查、诊断、规划和结构化输出任务委派给独立 Claude Code 会话。使用场景包括 `--resume` / `--continue` 续接多轮会话、`--output-format json` 单结果输出、`stream-json` 事件流，以及需要 `--worktree`、工具白名单、`--bare` 或结构化 JSON 输出的 scripted / CI 调用。
---

# Claude Code Agent

通过 Claude Code CLI 将任务委派给独立的 Claude Code 会话执行。

可把 `claude -p` 理解为 Claude Code Agent SDK 的 CLI 入口。旧文档有时把它叫做 headless mode，但行为和当前 `-p` 入口是同一条能力线。

## 前置条件

1. 安装 Claude Code CLI：`npm install -g @anthropic-ai/claude-code`
2. 确保已完成认证：`claude auth login`
3. 可用 `claude auth status --text` 快速确认当前登录状态
4. 建议先切到目标项目目录再运行；自动化调用默认用 `claude -p`

## 调用方式

### 新建会话（默认）

```bash
claude -p "你的任务描述" --output-format json --permission-mode bypassPermissions --model opus --effort high
```

**返回单个 JSON 对象**，常用字段：

```json
{
  "type": "result",
  "subtype": "success",
  "is_error": false,
  "result": "回复内容",
  "session_id": "81a5f75b-...",
  "total_cost_usd": 0.0944715,
  "usage": { "input_tokens": 3, "output_tokens": 4 }
}
```

- 从 `session_id` 提取会话 ID，用于后续多轮对话
- 从 `result` 提取 Claude 的最终回复
- 用 `is_error`、`subtype`、`usage`、`total_cost_usd` 判断是否出错并记录成本
- 如果同时传了 `--json-schema`，真正受 schema 约束的结果在 `structured_output` 字段里；`result` 可能为空，不要把它当结构化结果读取

### 事件流输出（`stream-json`）

```bash
claude -p "你的任务描述" --output-format stream-json --verbose --model sonnet --effort medium
```

`stream-json` **必须配 `--verbose`**，否则 CLI 会直接报错。当前常见事件：

```jsonl
{"type":"system","subtype":"init","session_id":"bb6067a9-..."}
{"type":"assistant","message":{"content":[{"type":"text","text":"OK"}]}}
{"type":"result","subtype":"success","result":"OK","session_id":"bb6067a9-..."}
```

- 自动化脚本通常以最后一条 `type == "result"` 作为最终结果
- `type == "assistant"` 更适合拿完成后的整条回复，不是稳定的中途增量入口
- `system` / hook / rate-limit 事件是正常噪音；不要把它们当最终答案
- `system/init` 会带上 model、tools、plugins、plugin_errors 等启动元数据；脚本想校验插件是否真的加载成功时，这个事件最有用

如果你需要 token 级增量文本，追加 `--include-partial-messages`，并解析 `type == "stream_event"` 且 `event.delta.type == "text_delta"` 的事件。

### 继续指定会话

```bash
claude -p "后续提问" --output-format json --model sonnet --effort medium --resume "session_id"
```

### 继续最近会话（快捷方式）

```bash
claude -p "后续提问" --output-format json --model sonnet --effort medium --continue
```

- `--continue` 自动续接当前目录最近一次会话
- 已经保存了明确 `session_id`，或需要更稳的脚本行为时，优先用 `--resume`

### 管道输入 / stdin

```bash
cat logs.txt | claude -p "Explain the failure in these logs" --output-format json --model sonnet --effort low
```

- 适合把日志、长文本、生成中的中间产物直接喂给子 Claude Code
- 如果上层工具本身输出 `stream-json`，再考虑配 `--input-format stream-json`

### ⚠️ `--no-session-persistence`：会话不可恢复

加 `--no-session-persistence` 后，本次会话**不会写入磁盘**，因此事后**无法被 `--resume` 或 `--continue` 恢复**。仅在以下场景使用：

- 一次性快速问答，确定不会追问
- CI / 脚本中的临时调用，避免污染会话列表
- 敏感任务，不希望在本地留下记录

**只要后续可能需要追问，就不要加 `--no-session-persistence`。**

## claude CLI 参数

### 输出与结果

| Flag | 说明 |
|------|------|
| `-p, --print` | 非交互模式；`json` / `stream-json` 输出都依赖它 |
| `--output-format FORMAT` | `text`（默认）/ `json` / `stream-json` |
| `--verbose` | 打开详细模式；`stream-json` 必需 |
| `--include-partial-messages` | 在 `stream-json` 中输出部分消息块 |
| `--include-hook-events` | 在 `stream-json` 中包含完整 hook 生命周期事件 |
| `--json-schema SCHEMA` | 用 JSON Schema 约束结构化输出 |

### 会话管理

| Flag | 说明 |
|------|------|
| `-r, --resume SESSION_OR_NAME` | 恢复指定会话 ID 或会话名 |
| `-c, --continue` | 恢复当前目录最近会话 |
| `--fork-session` | 在 resume / continue 时分叉出新会话 |
| `--from-pr NUMBER` | 恢复关联到指定 PR 的会话 |
| `--session-id UUID` | 显式指定会话 ID |
| `-n, --name NAME` | 为会话设置显示名称；后续可 `--resume <name>` |
| `--no-session-persistence` | 不持久化会话 |

### 输入与流式集成

| Flag | 说明 |
|------|------|
| `--input-format FORMAT` | `text`（默认）/ `stream-json`；给上游程序化输入用 |
| `--replay-user-messages` | 在 `stream-json` 输入模式下，把用户消息重新回放到 stdout |
| `--permission-prompt-tool TOOL` | 在非交互模式下，把权限确认委托给指定 MCP 工具 |

### 权限与工具边界

| Flag | 说明 |
|------|------|
| `--permission-mode MODE` | `default` / `acceptEdits` / `plan` / `auto` / `dontAsk` / `bypassPermissions` |
| `--allowedTools TOOLS` | 白名单特定工具，如 `"Read,Grep,Glob,Bash(git *)"` |
| `--disallowedTools TOOLS` | 禁用特定工具 |
| `--tools TOOLS` | 指定可用工具集；`""` 禁用全部，`"default"` 使用全部 |
| `--dangerously-skip-permissions` | 直接跳过所有权限检查，风险极高 |
| `--allow-dangerously-skip-permissions` | 允许会话里把“跳过权限检查”作为可选模式打开 |

`acceptEdits` 适合“允许写文件，但不想把所有 Bash / 网络能力都一把放开”的脚本化修复。`dontAsk` 更适合锁得很死的 CI：任何不在 allowlist 或只读命令集里的动作都会直接失败，而不是进入交互确认。

### 模型与上下文

| Flag | 说明 |
|------|------|
| `--model MODEL` | 指定模型，建议显式传递 |
| `--effort LEVEL` | 思考力度：`low` / `medium` / `high` / `xhigh` / `max` |
| `--max-turns N` | 限制 agentic turn 数；给自动化子会话兜边界 |
| `--max-budget-usd AMOUNT` | 最大花费限制 |
| `--fallback-model MODEL` | `--print` 模式下过载时的自动降级模型 |
| `--system-prompt PROMPT` | 替换默认系统提示词 |
| `--append-system-prompt PROMPT` | 追加系统提示词 |
| `--system-prompt-file FILE` | 从文件加载系统提示词 |
| `--append-system-prompt-file FILE` | 从文件追加系统提示词 |
| `--exclude-dynamic-system-prompt-sections` | 把 cwd / 环境 / git 状态等动态信息移出系统提示词，提升跨机器缓存复用 |
| `--add-dir DIR` | 添加额外可访问目录 |
| `--mcp-config CONFIG` | 加载 MCP 配置（文件或 JSON 字符串） |
| `--settings FILE_OR_JSON` | 加载额外 settings |

### 运行环境

| Flag | 说明 |
|------|------|
| `-w, --worktree [NAME]` | 为该任务创建隔离 worktree |
| `--tmux` | 配合 `--worktree` 创建 tmux / iTerm pane 会话 |
| `--bare` | scripted / SDK 推荐的 clean-room 模式：跳过 hooks、skills、plugins、MCP、auto memory 和 `CLAUDE.md` 自动发现 |
| `--disable-slash-commands` | 禁用所有 skills / slash commands |
| `--agent AGENT` | 指定当前会话使用的 agent |
| `--agents JSON` | 注入自定义 agents 定义 |
| `--plugin-dir PATH` | 为当前会话额外加载 plugin 目录 |
| `--chrome` / `--no-chrome` | 打开或关闭 Claude in Chrome 集成 |

`--bare` 下只会应用你显式传入的 flags；它不会读取本地 OAuth / keychain。需要 Anthropic 鉴权时，通常改用 `ANTHROPIC_API_KEY` 或在 `--settings` 里提供 `apiKeyHelper`。

## 多轮对话

1. 首次 `claude -p ... --output-format json` 获取 `session_id`
2. 后续追问用 `claude -p ... --resume "session_id"`，或在同目录用 `--continue`
3. 自动跟踪 `session_id`，用户无需手动理解完整协议
4. 不同任务各自新建会话；多个 `session_id` 互不干扰

## 模型与 effort 选择

根据任务复杂度显式指定 `--model` 和 `--effort`：

| 任务复杂度 | model | effort | 适用场景 |
|-----------|-------|--------|---------|
| 高 | `opus` | `high` | 架构设计、复杂重构、多文件编码 |
| 中 | `sonnet` | `medium` | 单文件功能实现、bug 修复、一般分析 |
| 低 | `sonnet` | `low` | 简单问答、代码解释、快速续问 |

## 推荐参数组合

| 场景 | model | effort | permission-mode | 其他 flags |
|------|-------|--------|-----------------|-----------|
| 复杂编码 | `opus` | `high` | `bypassPermissions` | `--output-format json` |
| 一般编码 | `sonnet` | `medium` | `bypassPermissions` | `--output-format json` |
| 脚本化小修复 | `sonnet` | `medium` | `acceptEdits` | `--bare --allowedTools "Bash,Read,Edit"` |
| 代码审查 | `sonnet` | `medium` | `plan` | `--allowedTools "Read,Grep,Glob,Bash(git *)"` |
| 锁死的 CI 检查 | `sonnet` | `medium` | `dontAsk` | `--bare --allowedTools "Read,Grep,Glob"` |
| 快速问答 | `sonnet` | `low` | `default` | `--no-session-persistence`（⚠️ 不可恢复） |
| 工具链消费事件流 | `sonnet` | `medium` | 视任务而定 | `--output-format stream-json --verbose` |
| 有边界的自动化子会话 | `sonnet` | `medium` | 视任务而定 | `--max-turns 3 --max-budget-usd 1` |
| 干净子进程 / prompt 实验 | `sonnet` | `medium` | `default` 或 `plan` | `--bare` |
| 结构化输出 | `sonnet` | `medium` | `default` | `--json-schema schema.json` |
| 隔离执行 | `opus` | `high` | `bypassPermissions` | `--worktree feature-x` |

## 使用规则

1. **自动化调用默认用 `-p` + `--output-format json`**：拿稳定的单对象结果；只有确实需要事件流时再切 `stream-json`
2. **`stream-json` 一律配 `--verbose`**：这是 CLI 的硬约束，不是建议
3. **始终显式传 `--model` 和 `--effort`**：避免默认值漂移
4. **始终在目标项目目录运行**：先 `cd /path/to/project`，不要让 Claude 在错误仓库执行
5. **编码任务用 `bypassPermissions`，审查任务用 `plan` + 工具白名单**：`plan` 不是硬沙箱，仍要配 `--allowedTools`
6. **保持对话连续**：只要后续可能追问，就不要加 `--no-session-persistence`
7. **`--continue` 适合“继续刚才那个任务”**；需要可追踪脚本行为、跨目录稳定性或明确会话绑定时，用 `--resume`
8. **需要隔离修改时优先 `--worktree`**：比手工切目录更稳，也更适合子 agent 独立执行
9. **向用户报告结果时优先取 `result` 字段**：必要时再补 `session_id`、成本和 token 使用
10. **如果只允许读，不要只依赖提示词**：同时加 `plan`、工具白名单或 `--tools` 限制，避免子进程意外写文件
11. **需要更可控的自动化边界时，加 `--max-turns`**：避免子会话在模糊任务里跑得过深
12. **scripted / SDK 调用默认优先 `--bare`**：这样不会继承本地 `CLAUDE.md`、skills、plugins、MCP 和 auto memory，结果也更可复现
13. **`-p` 模式里不要依赖 `/commit` 之类交互式 slash commands**：直接用自然语言描述任务；必要时显式给 `--append-system-prompt`、`--allowedTools` 或 `--json-schema`

## Prompt References

按任务类型按需加载对应 reference，不要把所有默认 prompt 一次性塞进主上下文：

- **编码 / 诊断 / 规划 / 窄修复**：读 [references/task-prompt-recipes.md](references/task-prompt-recipes.md)
- **代码审查 / 挑战式审查 / 测试缺口检查**：读 [references/review-prompt-recipes.md](references/review-prompt-recipes.md)
- **委派 handoff / 独立 worker / 续接同一 session**：读 [references/delegation-prompt-recipes.md](references/delegation-prompt-recipes.md)

这些 reference 提供的是可直接复用或轻改的默认 prompt 模板；优先复制最接近的模板，再删掉不需要的块。

## 示例

### 编码任务

```bash
cd /path/to/project && claude -p \
  "Implement a REST API for TODO items with CRUD endpoints. Use Express.js." \
  --output-format json \
  --permission-mode bypassPermissions \
  --model opus \
  --effort high
```

返回的 `result` 是自然语言总结，`session_id` 用于后续追问。

### 继续最近会话

```bash
cd /path/to/project && claude -p \
  "Continue from the current state. Add unit tests for the new endpoints and report only the final outcome." \
  --output-format json \
  --model sonnet \
  --effort medium \
  --continue
```

适合“刚才那个任务继续做”，不想手动保存 `session_id` 的场景。

### 事件流输出给上层工具

```bash
cd /path/to/project && claude -p \
  "Review the current diff and stream back progress plus a final verdict." \
  --output-format stream-json \
  --verbose \
  --permission-mode plan \
  --allowedTools "Read,Grep,Glob,Bash(git *)" \
  --model sonnet \
  --effort medium
```

适合上层 agent 或脚本：中间读 `assistant` / `system` 事件，最后读 `result`。

### 流式抽取纯文本增量

```bash
claude -p "Write a short changelog entry" \
  --output-format stream-json \
  --verbose \
  --include-partial-messages | \
  jq -rj 'select(.type == "stream_event" and .event.delta.type? == "text_delta") | .event.delta.text'
```

适合你自己的上层 UI 或脚本只想吃连续文本 token，不想自己处理整条事件流。

### 管道输入日志或长文本

```bash
cat logs.txt | claude -p \
  "Explain the failure in these logs. Return root cause, evidence, and the smallest safe next step." \
  --output-format json \
  --model sonnet \
  --effort low
```

适合把父进程已经拿到的大段上下文直接流给子 Claude Code，而不是再落成临时 prompt。

### 结构化输出给另一个工具

```bash
claude -p \
  "Extract the main exported function names from src/auth.ts." \
  --output-format json \
  --json-schema '{"type":"object","properties":{"functions":{"type":"array","items":{"type":"string"}}},"required":["functions"]}' | \
  jq '.structured_output'
```

适合上层 agent、CI 或脚本只消费结构化字段；注意真正受 schema 约束的结果在 `structured_output`，不是 `result`。

### 代码审查

```bash
cd /path/to/project && claude -p \
  "Review git diff HEAD~1. Focus on correctness, regression risk, and missing tests. Findings first." \
  --output-format json \
  --permission-mode plan \
  --allowedTools "Read,Grep,Glob,Bash(git *)" \
  --model sonnet \
  --effort medium
```

### 隔离 worktree 执行

```bash
cd /path/to/project && claude -p \
  "Implement the fix in an isolated worktree, run the most relevant tests, and summarize the final result." \
  --output-format json \
  --permission-mode bypassPermissions \
  --model opus \
  --effort high \
  --worktree fix-login-timeout
```

适合让子 Claude Code 独立完成一段实现，而不直接污染当前工作树。

### 干净子进程 / prompt 实验

先决条件：这个示例假设你已经通过 `ANTHROPIC_API_KEY` 或 `--settings` 里的 `apiKeyHelper` 提供鉴权。`--bare` 不会读取本地 OAuth / keychain，所以直接依赖 `claude auth login` 的环境会报 `Not logged in`。

```bash
cd /path/to/project && ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY" claude -p \
  "Review src/auth.ts for contract drift only." \
  --output-format json \
  --permission-mode plan \
  --allowedTools "Read,Grep,Glob" \
  --model sonnet \
  --effort medium \
  --bare \
  --max-turns 3
```

适合做更可复现的 scripted 调用，不希望本地 `CLAUDE.md`、插件、skills 或 auto memory 影响输出。
