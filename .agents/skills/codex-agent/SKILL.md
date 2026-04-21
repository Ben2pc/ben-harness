---
name: codex-agent
description: 通过 Codex CLI 将编码、审查、诊断、规划、结构化输出和本机浏览器调研任务委派给独立的 Codex 会话。使用场景包括 `codex exec` 新建任务、`codex exec resume` 续接多轮会话、`codex exec review` 做只读审查，以及需要 `--json` 事件流、`-o` 最终消息落盘、图片输入或 Computer Use 浏览器操作时。
---

# Codex Agent

通过 Codex CLI 将任务委派给独立的 Codex 会话执行。

## 前置条件

1. 安装 Codex CLI：`npm install -g @openai/codex`
2. 确保已完成 Codex 登录认证（`codex` 首次运行会引导登录）
3. 建议在目标项目目录下运行，或显式传 `-C /path/to/project`

## 调用方式

### 新建会话

```bash
codex exec --json --sandbox workspace-write --skip-git-repo-check --model gpt-5.4 "你的任务描述"
```

上面这条只适合**短 prompt**。当 prompt 超过约 500 字符或包含多行/特殊字符时，不要继续用位置参数；改走 stdin 更稳。

**输出为 JSONL**，每行一个事件。当前常见事件：

```jsonl
{"type":"thread.started","thread_id":"019d32fc-..."}
{"type":"turn.started"}
{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"回复内容"}}
{"type":"turn.completed","usage":{"input_tokens":46879,"cached_input_tokens":2432,"output_tokens":54}}
```

- 从 `thread.started` 事件中提取 `thread_id`，用于后续多轮对话
- 从 `item.completed` 事件（`item.type == "agent_message"`）中提取 `text` 作为 Codex 的回复
- 从 `turn.completed` 中提取 `usage`，记录 token 消耗

自动化脚本里只应解析 JSON 行。若你的运行环境会把 `stderr` 的 warning 和 `stdout` 合并，先过滤出以 `{` 开头的 JSON 行，或将 `stderr` 重定向掉。

### 长 prompt 用 stdin 管道

当 prompt 超过约 500 字符或包含多行/特殊字符时，不要继续用位置参数。实测这类输入可能卡在 `Reading additional input from stdin...`，即使手动把 stdin 关掉也不稳定。推荐直接把 prompt 写进文件，再让 `codex exec` 用 `-` 从 stdin 读取：

```bash
codex exec --json --sandbox workspace-write --full-auto --model gpt-5.4 \
  --skip-git-repo-check - < /tmp/task-prompt.txt > /tmp/task-out.jsonl 2>&1
```

位置参数仍然适合短 prompt，例如一句话问答、很短的续问，或临时命令行实验。

### 继续会话

```bash
codex exec resume --json --model gpt-5.4 "thread_id" "后续提问"
```

### 继续最近会话（快捷方式）

```bash
codex exec resume --json --model gpt-5.4 --last "后续提问"
```

- `--last` 默认只看当前目录最近一次记录的会话
- 需要跨目录查找时，加 `--all`

### ⚠️ `--ephemeral`：会话不可恢复

加 `--ephemeral` 后，本次会话**不会写入磁盘**（不持久化到 `~/.codex/sessions/`），因此事后**无法被 `codex exec resume` 或 `--last` 恢复**。仅在以下场景使用：

- 一次性快速问答，确定不会追问
- CI / 脚本中的临时调用，避免污染会话列表
- 敏感任务，不希望在本地留下记录

**只要后续可能需要追问，就不要加 `--ephemeral`。** 与 `claude -p --no-session-persistence` 语义对等。

## codex exec 参数

### 输出与结果

| Flag | 说明 |
|------|------|
| `--json` | JSONL 格式输出，便于解析事件流 |
| `--output-schema FILE` | 用 JSON Schema 约束最后一条消息的结构 |
| `-o, --output-last-message FILE` | 将最后一条消息直接写入文件 |
| `--color COLOR` | 颜色输出：`always` / `never` / `auto` |

### 执行环境

| Flag | 说明 |
|------|------|
| `-s, --sandbox MODE` | 沙箱模式：`read-only` / `workspace-write` / `danger-full-access` |
| `--full-auto` | 当前等价于 `--sandbox workspace-write` 的便捷写法 |
| `--dangerously-bypass-approvals-and-sandbox` | 跳过所有确认和沙箱，极度危险 |
| `-C, --cd DIR` | 指定工作目录 |
| `--skip-git-repo-check` | 允许在非 git 目录运行 |
| `--add-dir DIR` | 额外可写目录（可重复） |

### 模型与配置

| Flag | 说明 |
|------|------|
| `-m, --model MODEL` | 指定模型，建议显式传递 |
| `-p, --profile PROFILE` | 使用 `config.toml` 中的 profile |
| `-c, --config key=value` | 覆盖 `config.toml` 配置项 |
| `--enable FEATURE` | 启用 feature flag（可重复） |
| `--disable FEATURE` | 禁用 feature flag（可重复） |
| `--oss` | 使用本地开源模型 provider |
| `--local-provider PROVIDER` | 指定本地 provider（如 `lmstudio` / `ollama`） |

### 输入

| Flag / 方式 | 说明 |
|-------------|------|
| `-i, --image FILE` | 附加图片（可重复） |
| `PROMPT` | 直接把短任务作为命令行参数传入；只推荐给短 prompt |
| `-` 或 stdin | 不传 prompt，或把 prompt 写成 `-`，即可从 stdin 读取；长 prompt、Markdown、多行结构优先用这一种 |

## codex exec resume 参数

| Flag | 说明 |
|------|------|
| `--json` | JSONL 格式输出 |
| `-m, --model MODEL` | 指定模型 |
| `--full-auto` | 便捷写法，等价于 `workspace-write` 沙箱 |
| `--dangerously-bypass-approvals-and-sandbox` | 跳过确认和沙箱 |
| `--skip-git-repo-check` | 允许非 git 目录 |
| `--ephemeral` | 不持久化 |
| `-i, --image FILE` | 附加图片 |
| `-o, --output-last-message FILE` | 最后消息写入文件 |
| `-c, --config key=value` | 覆盖 `config.toml` 配置项 |
| `--enable FEATURE` | 启用特性（可重复） |
| `--disable FEATURE` | 禁用特性（可重复） |
| `--last` | 恢复最近一次会话（无需指定 ID） |
| `--all` | 查找全部会话（不限当前目录） |

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
| `--full-auto` | 便捷写法，等价于 `workspace-write` 沙箱 |
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
| 一般编码 | `gpt-5.4-mini` | `workspace-write` | `--full-auto` |
| 只读问答 / 分析 | `gpt-5.4-mini` | `read-only` | `--skip-git-repo-check`（非 git 目录时） |
| 浏览器调研 / Computer Use | `gpt-5.4` | `read-only` | `-C "$PWD" -o /tmp/result.txt`，需要事件流时再加 `--json` |
| 代码审查 | `gpt-5.4-mini` | `read-only` | `codex exec --json ... "Review ..."` |
| 仓库 review | `gpt-5.4-mini` | — | `codex exec review --base main` |
| 快速问答 | `gpt-5.4-mini` | `read-only` | `--skip-git-repo-check --ephemeral`（⚠️ 不可恢复） |
| 结构化输出 | `gpt-5.4-mini` | `read-only` | `--output-schema schema.json -o result.json` |

## 使用规则

1. **自动化调用一律加 `--json`**：确保输出可解析，提取 `thread_id` 和回复内容
2. **始终显式传 `--model`**：避免默认模型漂移
3. **始终在目标项目目录运行**：优先 `cd /path/to/project` 或 `-C /path/to/project`
4. **编码任务用 `workspace-write`**：通常直接用 `--sandbox workspace-write` 或 `--full-auto`
5. **审查任务用 `read-only` 或 `codex exec review`**：防止意外修改
6. **保持对话连续**：同一任务的追问复用 `thread_id`；**只要可能追问就别加 `--ephemeral`**
7. **需要稳定下游解析时，用 `--output-schema` + `-o`**：把最终结果约束成机器可消费的结构
8. **长 prompt 用 stdin 管道**：prompt 超过约 500 字符或包含多行/特殊字符时，不要继续用位置参数；先写入文件，再用 `- < file.txt` 传入，避免卡在 `Reading additional input from stdin...`
9. **向用户报告结果**：每次调用后，从 JSONL 中提取最终回复，简要总结给用户
10. **区分 `-o` 和 `--json` 的职责**：`-o` 负责把最后一条回复落文件；`--json` 负责把整段事件流打印到 stdout。脚本常见组合是两者一起用。
11. **非编码的本机浏览器任务优先 `read-only`**：如果只是让 Codex 用 Computer Use 打开 Chrome、浏览网页、总结内容，不需要 `--full-auto`；提示词里再补一句 `Do not modify local files.` 作为双保险。

## Prompt References

按任务类型按需加载对应 reference，不要把所有默认 prompt 一次性塞进主上下文：

- **编码 / 诊断 / 规划 / 窄修复**：读 [references/task-prompt-recipes.md](references/task-prompt-recipes.md)
- **代码审查 / 挑战式审查 / 测试缺口检查**：读 [references/review-prompt-recipes.md](references/review-prompt-recipes.md)
- **本机浏览器调研 / Reddit 或社区采样 / 证据型总结**：读 [references/browser-research-prompt-recipes.md](references/browser-research-prompt-recipes.md)

这些 reference 提供的是可直接复用或轻改的默认 prompt 模板；优先复制最接近的模板，再删掉不需要的块。

## 示例

### 编码任务

```
用户：用 Codex 在当前项目里实现一个 TODO API

步骤 1 - 新建会话：
cd /path/to/project && codex exec --json --full-auto --model gpt-5.4 "Implement a REST API for TODO items with CRUD endpoints. Use Express.js."

→ 解析输出，获得 thread_id: "xxx"，回复: "Implemented server.js ..."

用户：加上单元测试

步骤 2 - 继续会话：
cd /path/to/project && codex exec resume --json --model gpt-5.4-mini "xxx" "Add unit tests for all the TODO API endpoints using vitest."
```

### 继续最近会话

```bash
cd /path/to/project && codex exec resume --json --model gpt-5.4-mini --last "Continue the refactor and remove the dead helper functions."
```

适合“刚才那个任务继续做”，不想手动保存 `thread_id` 的场景。

### 代码审查

```bash
# 通用只读审查
cd /path/to/project && codex exec --json --sandbox read-only --model gpt-5.4-mini "Review the changes in git diff HEAD~1. Focus on correctness, security, and missing tests."

# 内置 review：对比 main
cd /path/to/project && codex exec review --json --model gpt-5.4-mini --base main

# 审查未提交变更
cd /path/to/project && codex exec review --json --model gpt-5.4-mini --uncommitted
```

### 结构化输出并写入文件

```bash
cd /path/to/project && codex exec --json --sandbox read-only --model gpt-5.4-mini \
  --output-schema ./review-schema.json \
  -o /tmp/review-result.json \
  "Review src/todo.ts and output summary, risks, and suggested tests."
```

适合要把结果继续喂给脚本、CI 或其他 agent 的场景。

### 本机浏览器调研（只要最终答案）

```bash
codex exec \
  -m gpt-5.4 \
  --sandbox read-only \
  --skip-git-repo-check \
  -C "$PWD" \
  -o /tmp/codex-last.txt \
  "Use Computer Use on my Mac. Open Google Chrome, go to Reddit, search for 'Duolingo review', open 3 representative posts (one positive, one negative, one long-term review), then summarize the findings in Chinese. Do not modify local files."
```

适合人工查看最终结论，不关心中间事件流的场景。

### 本机浏览器调研（既要事件流，也要最终答案落盘）

```bash
codex exec \
  -m gpt-5.4 \
  --sandbox read-only \
  --skip-git-repo-check \
  -C "$PWD" \
  --json \
  -o /tmp/codex-last.txt \
  "Use Computer Use on my Mac. Open Google Chrome, search Reddit for Duolingo reviews, open a few representative posts, and then summarize them in Chinese. Do not modify local files."
```

适合脚本或上层 agent：stdout 读 JSONL 事件流，`/tmp/codex-last.txt` 读最终自然语言结论。

### 图片输入

```bash
cd /path/to/project && codex exec --json --sandbox read-only --model gpt-5.4-mini \
  -i ./screenshots/login-bug.png \
  "Describe the UI issue in this screenshot and propose a minimal fix plan."
```

适合视觉回归、报错截图诊断、设计稿差异分析。

### 长任务 prompt（推荐）

```bash
# 1. 把复杂 prompt 写进文件
cat > /tmp/task-prompt.txt <<'PROMPT_EOF'
请在当前仓库完成以下任务：
1. 先阅读 README 和 tests
2. 只修改与 issue 直接相关的文件
3. 先补测试，再改实现，最后运行验证
PROMPT_EOF

# 2. 用 - 从 stdin 读取，避免长位置参数卡住
codex exec --json --sandbox workspace-write --full-auto --model gpt-5.4 \
  --skip-git-repo-check - < /tmp/task-prompt.txt > /tmp/task-out.jsonl 2>&1
```

适合市场调研、多段 Markdown 约束、脚本拼装 prompt，或任何已经超过一屏的任务描述。

### 从 stdin 传长提示词

```bash
cat ./prompt.md | codex exec --json --sandbox workspace-write --model gpt-5.4 -
```

适合长 prompt、模板化 prompt，或脚本动态拼接指令后直接通过管道喂给 Codex。若是在 shell 脚本里长期复用，优先上一节的 `- < file.txt` 写法，可读性更好，也更容易排查问题。
