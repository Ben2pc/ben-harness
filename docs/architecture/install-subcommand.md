# `npx auriga-cli install` 非交互子命令设计

> **Status**: Draft
> **Date**: 2026-04-21
> **Issue**: [#28](https://github.com/Ben2pc/auriga-cli/issues/28)
> **Breaking change**: 否（minor bump，见 §6）

## 1. 背景与动机

`npx auriga-cli` 目前入口是 `@inquirer/prompts` 的 checkbox 交互菜单，非 TTY 环境无法使用。最近一轮 auriga-go dogfooding 暴露摩擦：Agent 在 `claude -p` 或 `claude -p --worktree` 这类非 TTY session 里没法直接装 harness——"把一个空仓库带到 auriga 工作流可用状态"仍然只能人工触发。

项目层面的其它 bootstrap 动作（`git init`、`npm create vite`、`cargo init`、建 remote、首个 commit、拉 feat 分支、开 Draft PR）Agent 自己就能调现成命令完成；唯独 auriga harness 这一步 Agent 拿不到，因为 CLI 不吃非交互输入。

## 2. 目标

新增非交互式命令路径，让 Agent 在 non-TTY session 里能一次调用装好 harness。

**In scope**：

- 新增 `install` 动词子命令；三种严格互斥的合法形式：交互菜单 / `--all` 原子装 / 单类别装（可带匹配的子项过滤）
- 新增 `guide` 子命令：输出类似 skill SOP 的安装引导，作为 **Agent bootstrap 的单一入口**（解决 discoverability 问题）
- 详细 `--help` 输出，内嵌完整 skill / plugin / hook 目录（名字 + 描述），让 Agent 看完 help 就能判断"我的需求该装哪些"
- `install --all` 分级退出码（0 / 1 / 2）+ precheck 外部 CLI，让 Agent 可以识别"部分成功"并精准补装
- 幂等：二次安装能识别已装项，不破坏用户本地修改
- 向后兼容 workflow / skills / plugins / hooks 的现有安装函数，通过签名扩展复用

**Out of scope**：

- 技术栈 scaffold（`npm create vite` / `cargo init` 等，Agent 自己调）
- 依赖管理、测试基线、CI 模板
- GitHub remote 配置、首个 feat 分支、Draft PR 引导
- "setup skill" / "auriga-setup" ——有了非交互子命令后这层 agent 包装不再必要

**Non-goals**：

- 不做万能脚手架
- 不替代 Agent 的判断与调度

## 3. CLI 命令表面

### 3.1 顶层命令

| 命令 | 行为 |
|---|---|
| `npx auriga-cli` | **checkbox 交互菜单（沿用现状）**；非 TTY 下 exit 1 |
| `npx auriga-cli guide` | 打印 **Agent bootstrap SOP**（见 3.6）——Agent 单一入口。非交互调用要用 `npx -y auriga-cli guide` 绕开 npx 自己的"是否安装包"提示 |
| `npx auriga-cli --help` / `-h` | 打印详细 help（含完整 catalog） |
| `npx auriga-cli --version` / `-v` | 打印版本号 |
| `npx auriga-cli install ...` | 非交互安装入口（见 3.2） |

### 3.2 `install` 子命令语法

**合法形式（互斥）：**

```
npx auriga-cli install                               # TTY: checkbox 菜单；非 TTY: error
npx auriga-cli install --all [scope options]         # 装 workflow+skills+plugins+hooks（不含 recommended）
npx auriga-cli install <type> [type-specific flags]  # 装单一类别（可带子项过滤）
```

**`<type>`** — 必须恰好一个，取自：`workflow` / `skills` / `recommended` / `plugins` / `hooks`

**workflow 独有：**

- `--lang <code>` — 语言；默认 `en`；当前支持 `en` / `zh-CN`
- `--cwd <dir>` — 安装目标目录；默认 `process.cwd()`

**skills / recommended / plugins 共享：**

- `--scope <project|user>` — 安装范围；默认 `project`；CLI 内部把 `user` 映射成 `npx skills -g` / `claude plugins install --scope user`

**子项过滤（必须与匹配的 `<type>` 同时出现，空格分隔，对齐 `npx skills`）：**

- `install skills --skill <names...>` — 只装这些 workflow skill
- `install recommended --recommended-skill <names...>` — 只装这些 recommended skill
- `install plugins --plugin <names...>` — 只装这些 plugin
- `install hooks --hook <names...>` — 只装这些 hook
- 支持通配 `'*'`（例：`--skill '*'` = 该类全装，等价于不写 filter）

**顶层选项：**

- `-h, --help` — 详细 help（= `npx auriga-cli --help`）
- `-v, --version` — 版本号

### 3.3 组合示例

```bash
# 全装（Agent bootstrap 最常用）
npx auriga-cli install --all

# 装单一类别（全子项）
npx auriga-cli install workflow
npx auriga-cli install skills
npx auriga-cli install recommended
npx auriga-cli install plugins
npx auriga-cli install hooks

# 类内子项过滤
npx auriga-cli install skills --skill brainstorming systematic-debugging
npx auriga-cli install plugins --plugin auriga-go
npx auriga-cli install recommended --recommended-skill codex-agent
npx auriga-cli install hooks --hook notify pr-create-guard

# 语言 / scope
npx auriga-cli install workflow --lang zh-CN
npx auriga-cli install --all --scope user

# 想装多个类别？分多次调用（单命令每次只装一类）
npx auriga-cli install --all
npx auriga-cli install recommended
```

### 3.4 `install` 无位置参数、无 `--all` 时

TTY / 非 TTY 判据：`process.stdin.isTTY`（`true` = TTY）。

| 环境 | 行为 |
|---|---|
| TTY | 进 checkbox 交互菜单（沿用当前 `src/cli.ts` 行为） |
| 非 TTY | `exit 1`；打印 `Interactive mode requires a TTY. Run 'npx auriga-cli --help' for non-interactive options.` |

### 3.5 语义规则（强约束，简化歧义）

1. **`install` 命令最多接一个位置 `<type>`**。多个位置参数（例：`install workflow skills`）fail-fast
2. **`--all` 是原子开关**：不接受任何位置 `<type>`、也不接受任何子项过滤 flag。冲突（例：`install --all recommended` / `install --all --skill x`）fail-fast
3. **子项过滤 flag 必须与匹配的 `<type>` 同时出现**：
   - `--skill` 要求 `install skills`
   - `--recommended-skill` 要求 `install recommended`
   - `--plugin` 要求 `install plugins`
   - `--hook` 要求 `install hooks`
   - 不匹配（例：`install workflow --skill x` / `install --skill x`）fail-fast
4. **workflow 类别无子项**，不接受任何 filter flag
5. **`--lang` / `--cwd` 只对 workflow 生效**；与其它 `<type>` / `--all` 组合时 fail-fast
6. **`--scope` 对 `skills` / `recommended` / `plugins` / `hooks` 生效**（非交互 default 都是 `project`）；与 `workflow` 组合时 fail-fast；`install`（TTY 菜单）下忽略（菜单自己会 prompt）。hooks 的 `project-local` scope 仅交互式菜单可达 — 非交互 `--scope` 只接 `project` / `user` 两值。
7. **非交互识别**：传了位置 `<type>` 或 `--all` → 非交互；否则走 3.4
8. **顶层未知参数**：`npx auriga-cli --all` / `npx auriga-cli foo` 等在顶层（未经 `install`）均 fail-fast

### 3.6 `guide` 子命令（Agent bootstrap SOP）

**目的**：给一个没有任何先验上下文的 Agent 单一入口——用户只需告诉 Agent "跑 `npx -y auriga-cli guide`"，Agent 读输出就能按序自主完成 bootstrap，包含 precheck / install / reload 三段关键提示。

**形式：**

- `npx auriga-cli guide` — 唯一形态；我们 CLI 本身没有额外 flag
- 颜色自动判定：TTY 且 `NO_COLOR` 未设 → 彩色；否则纯文本
- Agent 非交互调用：`npx -y auriga-cli guide`（`-y` 是 **npx 的** flag，绕开它的"是否安装包"提示；不是我们 CLI 的参数）

**输出契约**（SOP 模板）：

```
# auriga-cli bootstrap SOP

This guide walks an Agent through installing the auriga harness
(CLAUDE.md + skills + plugins + hooks) into the current repository.

Run each step in order. If any step fails with exit 1, stop and report.
If exit 2, see stderr for per-category status and follow the "retry"
hint.

## Step 1 — Prerequisite check

Ensure these CLIs are in PATH:
  - node   (>= 18)
  - git
  - claude (required for plugins; see https://docs.claude.com/claude-code)

Optional (only if you'll push a PR): gh

Verify:
  node --version && git --version && claude --version

If `claude` is missing: install Claude Code first, then re-run this guide.

## Step 2 — Read --help BEFORE installing (do not skip)

⚠ Always inspect the catalog first.

Top-level catalog (every workflow skill / recommended skill / plugin /
hook with a short description):
  npx -y auriga-cli --help

Per-type detail (flags + only that category's catalog slice):
  npx -y auriga-cli install workflow --help
  npx -y auriga-cli install skills --help
  npx -y auriga-cli install recommended --help
  npx -y auriga-cli install plugins --help
  npx -y auriga-cli install hooks --help

## Step 3 — Install

Preset — the full default-on set (workflow + skills + plugins + hooks;
recommended is NOT included):
  npx -y auriga-cli install --all

Targeted — single category:
  npx -y auriga-cli install workflow --lang en
  npx -y auriga-cli install skills --skill brainstorming test-driven-development
  npx -y auriga-cli install plugins --plugin skill-creator codex --scope user
  npx -y auriga-cli install hooks --hook pr-ready-guard

Opt-in hooks (e.g. notify — macOS-only + brew deps) require naming them
explicitly:
  npx -y auriga-cli install hooks --hook notify

Opt-in recommended skills:
  npx -y auriga-cli install recommended

Exit codes:
  0  — all requested categories installed
  1  — fatal error (parse / fetch / missing prerequisite). Read stderr;
       fix the root cause and re-run the SAME command.
  2  — partial success. stderr lists per-category status + a Retry:
       block naming only the failed category(ies).

## Step 4 — Reload session (REQUIRED when installed non-interactively)

`CLAUDE.md`, `.agents/skills/`, `.claude/plugins.json`, and hook
registrations (`.claude/settings.json`) are all loaded at Claude Code
session startup. If you ran
`npx -y auriga-cli install` inside an existing Claude Code session
(e.g., `claude -p` / `claude -p --worktree`), **the current session
will NOT see the new harness.**

Action:
  - Commit any in-flight work first
  - Exit this session and start a new one to pick up the harness
  - Resume the original task in the new session

## Step 5 — Verify install

Expected artifacts:
  - CLAUDE.md                 (workflow manifesto)
  - AGENTS.md -> CLAUDE.md    (symlink)
  - .agents/skills/<name>/    (one per installed skill)
  - .claude/plugins.json
  - .claude/settings.json     (updated hook registrations, if hooks selected)

## Troubleshooting

- Network error during fetch → retry; if persistent, check GitHub raw access
- "catalog missing" error → re-install the package (`npx clear-npx-cache`)
- `claude plugins install` hangs → abort, report; see known issue list
```

**模板实现**：
- `src/guide.ts` 导出 `renderGuide(opts: { color: boolean; version: string })`
- 版本从 `package.json` 注入；catalog 引用为静态"去 `--help` 查"链接，不在 guide 里重复列
- `color` 自动判定：`process.stdout.isTTY && !process.env.NO_COLOR`
- **不**在 SOP 里嵌入 skill/plugin 列表——列表归 `--help`，guide 只讲"做什么"（职责分工：guide = 流程，help = 目录）

**触发形式约束：**
- `guide` 不接受任何参数；传任意 flag / 位置参数 fail-fast。**唯一例外**：`guide --help` / `guide -h` 路由到 top-level `--help`（universal affordance），避免用户探索新子命令时被拒绝。其它任何 token（`guide foo`、`guide --lang en`）仍 fail-fast。

## 4. `--help` 输出契约（详细目录）

### 4.1 目标

Agent 读完 `npx auriga-cli --help` 就能回答"我该装哪些"，不用再查 README。

### 4.2 输出结构

```
auriga-cli v<ver> — install Claude Code harness modules

USAGE
  npx auriga-cli guide                                   Agent bootstrap SOP (start here)
  npx auriga-cli install                                 (TTY only) checkbox menu
  npx auriga-cli install --all [--scope <s>]             workflow + skills + plugins + hooks
                                                         (excludes recommended — install separately)
  npx auriga-cli install <type> [type-specific flags]    single category
  npx auriga-cli --help

  For non-interactive (Agent) use, prepend npx's own -y flag:
    npx -y auriga-cli guide
    npx -y auriga-cli install --all

TYPES (exactly one with <type> form)
  workflow       CLAUDE.md + AGENTS.md (workflow manifesto, ~100 lines)
  skills         Default-on workflow skills (listed below)
  recommended    Opt-in utility skills (listed below)
  plugins        Claude Code plugins (listed below)
  hooks          Project-level hooks for Claude Code (listed below)

TYPE-SPECIFIC FLAGS
  workflow:       --lang <code>    default en; available: en, zh-CN
                  --cwd <dir>      default current working directory
  skills:         --skill <names...>             space-separated; '*' = all
                  --scope <project|user>         default project
  recommended:    --recommended-skill <names...>
                  --scope <project|user>
  plugins:        --plugin <names...>
                  --scope <project|user>
  hooks:          --hook <names...>

TOP-LEVEL OPTIONS
  -h, --help                     show this help
  -v, --version                  show version

──────────────────────────────────────────────────────
CATALOG (what each category contains)
──────────────────────────────────────────────────────

Workflow skills (category: skills)  ← installed by --all
  brainstorming                  Clarify requirements via dialogue before coding
  deep-review                    Multi-dimensional PR review (correctness/consistency/...)
  parallel-implementation        Plan how to slice work across parallel subagents
  planning-with-files            Manus-style file-based planning for complex tasks
  playwright-cli                 Browser automation & testing verification
  systematic-debugging           Find root cause before fixing bugs
  test-designer                  Independent failing-test design for complex features
  test-driven-development        Red-green-refactor discipline
  ui-ux-pro-max                  UI/UX design intelligence (styles / palettes / guidelines)
  verification-before-completion Require verification evidence before claiming done

Recommended skills (category: recommended)  ← NOT installed by --all
  claude-code-agent              Delegate tasks to another Claude Code CLI instance
  codex-agent                    Delegate tasks to Codex CLI (GPT-5.4)

Plugins (category: plugins)
  auriga-go                      Workflow autopilot — drives CLAUDE.md workflow forward
  skill-creator                  Create / modify / measure skills
  claude-md-management           Audit & improve CLAUDE.md files
  codex                          Codex CLI integration (rescue, review, delegation)

Hooks (category: hooks)
  notify                         macOS notification when Claude needs attention
  pr-create-guard                Inject PR body snapshot after `gh pr create`
  pr-ready-guard                 Block `gh pr ready` on unpushed commits / stray docs

──────────────────────────────────────────────────────
EXAMPLES
──────────────────────────────────────────────────────

  # full install (typical Agent bootstrap)
  npx auriga-cli install --all

  # workflow only, Chinese
  npx auriga-cli install workflow --lang zh-CN

  # just two workflow skills
  npx auriga-cli install skills --skill systematic-debugging test-driven-development

  # everything + opt-in recommended (two calls; 'install' takes one type at a time)
  npx auriga-cli install --all
  npx auriga-cli install recommended

More: https://github.com/Ben2pc/auriga-cli
```

### 4.3 描述约束

- 每行 ≤ 80 列；描述截断到 50 列以内
- Help 整体英文（Agent 跨语言场景更多；workflow 模板仍支持 `--lang zh-CN`）
- Install 前提（例：plugins 需 `claude` CLI 在 PATH）**不写进 help**；在安装阶段被检测到再报错，避免 help 膨胀
- **描述的真源**：build-time 从各类元数据读取后内嵌到 `dist/catalog.json`：
  - workflow skills / recommended skills → `.agents/skills/<name>/SKILL.md` 的 YAML frontmatter `description`
  - plugins → `.claude/plugins.json` 的 `plugins[].description`
  - hooks → `.claude/hooks/hooks.json` 的 `hooks[].description`
- 本文档 §4.2 的 CATALOG 段是**示意**，不是手写真源；实际 help 里的描述按以上映射取自源文件并截断到 50 列

## 5. 实现

### 5.1 文件变更

| 文件 | 动作 | 职责 |
|---|---|---|
| `src/cli.ts` | 重写 | 参数解析、命令分发、help / guide 打印、非交互路径 |
| `src/help.ts` | 新增 | 从 `dist/catalog.json` 生成 help 文本 |
| `src/guide.ts` | 新增 | 输出 §3.6 的 SOP 模板 |
| `src/catalog.ts` | 新增 | 类型定义 + catalog 读取工具 |
| `src/build/generate-catalog.ts` | 新增 | build 脚本；扫本地元数据生成 `dist/catalog.json` |
| `src/workflow.ts` | 改签名 | `installWorkflow(packageRoot, opts)` |
| `src/skills.ts` | 改签名 + 清理 | `installSkills(packageRoot, opts)` / `installRecommendedSkills(packageRoot, opts)`；删除 `RECOMMENDED_DESCRIPTIONS` 硬编码 map（由 catalog 替代） |
| `src/plugins.ts` | 改签名 | `installPlugins(packageRoot, opts)` |
| `src/hooks.ts` | 改签名 | `installHooks(packageRoot, opts)` |
| `src/utils.ts` | 扩展 | 新增 `isNonInteractive()` / scope 词汇映射 |
| `package.json` | 更新 | `build` 脚本追加 catalog 生成步骤；`files` 字段排除 `dist/build/` |
| `tests/cli-parse.test.ts` | 新增 | 参数解析矩阵（含 guide） |
| `tests/install-nontty.test.ts` | 新增 | 非交互路径冒烟 + 分级退出码 |
| `tests/guide.test.ts` | 新增 | guide SOP 输出快照；TTY / NO_COLOR 分支；带参数 fail-fast |

### 5.2 参数解析器

手写 40 行解析器。`commander` / `yargs` 对此 scope 过重；`minimist` 对"空格分隔多值"支持不够好。

契约（按 §3.5 强约束简化）：

```ts
type CategoryName = "workflow" | "skills" | "recommended" | "plugins" | "hooks";

interface ParsedArgs {
  command: "help" | "version" | "guide" | "install";
  // guide 没有命令级参数；颜色在 renderGuide 内部用 process.stdout.isTTY + NO_COLOR 判定
  install?: {
    all: boolean;                 // true = --all；false = 位置 <type> 或无
    type?: CategoryName;          // 恰好一个；all=true 时必为 undefined
    filter?: string[];            // 子项；undefined = 全子项
    lang?: string;                // 仅 workflow
    cwd?: string;                 // 仅 workflow
    scope?: "project" | "user";   // skills / recommended / plugins
  };
}
```

**解析规则（fail-fast）：**

1. 收集位置参数 → 至多 1 个 `<type>`；多个 fail-fast
2. 遇 `--all` 且已有 `<type>` / filter / `--lang` / `--cwd` 冲突的 flag → fail-fast
3. 遇 filter flag（`--skill` / `--recommended-skill` / `--plugin` / `--hook`）：
   - 必须与匹配的 `<type>` 同时出现；否则 fail-fast
   - 一个 `install` 命令里 filter flag 最多出现一次
4. 遇 `--lang` / `--cwd`：要求 `<type>` 为 `workflow`；否则 fail-fast
5. 遇 `--scope`：要求 `<type>` 为 `skills` / `recommended` / `plugins`（或 `--all`）；否则 fail-fast
6. 无 `<type>` 且无 `--all` → 走 §3.4 无参路径

**Filter flag 的 nargs 终止规则：**

`--skill` / `--recommended-skill` / `--plugin` / `--hook` 后的值 consume 直到遇到以下任一 terminator：

- 下一个以 `--` / `-` 开头的 flag
- `--` 显式终止
- 参数结束

(注：因强约束下 `<type>` 必在 filter flag 之前出现，不需要把 type 名纳入 terminator。)

**子项名校验**：解析得到的 filter 值对照 catalog 校验，未知名字 fail-fast 并列出可选。

### 5.3 install 函数统一签名

```ts
interface InstallOpts {
  lang?: string;              // workflow only
  cwd?: string;               // workflow only
  scope?: "project" | "user"; // skills/recommended/plugins
  selected?: string[];        // 子项筛选；undefined=全部；['*']=全部；具名=过滤
  interactive: boolean;       // true=走现有 prompt；false=纯用 opts
}
```

内部 pattern：

```ts
const lang = opts.interactive
  ? await withEsc(select({ ... }))
  : (opts.lang ?? "en");
```

交互 / 非交互走同一套函数体，避免两份实现漂移。

### 5.3.1 `install --all` 的 Precheck 与分级退出

**Precheck 阶段**（进入任何真实安装动作前）：

- 检查 `claude` CLI 在 PATH（`plugins` 安装依赖）
- 检查 `git` 可用（安装后用户大概率会用到；非硬性，仅警告不阻断）
- 检查 `fetchContentRoot()` 能拉到内容（DEV=1 或 GitHub raw 可达）

**分级退出码**：

| 退出码 | 含义 |
|---|---|
| 0 | 全部类别安装成功 |
| 1 | **完全失败**：parse 错、catalog 缺失、fetch 失败、`claude` CLI 缺失等 precheck 失败——未动本地文件 |
| 2 | **部分成功**：某些类别安装好、某些失败。stderr 打印每类状态 + 具体的 `npx auriga-cli install <type>` 重试命令 |

**部分失败的标准输出**（例：`claude` CLI 中途挂了）：

```
[OK]   workflow
[OK]   skills
[FAIL] plugins — claude CLI error: ...
[OK]   hooks

Retry: npx auriga-cli install plugins
exit 2
```

### 5.4 Catalog 生成（`src/build/generate-catalog.ts`）

**输入：**

- `.agents/skills/<name>/SKILL.md` YAML frontmatter 的 `description` 字段
- `.claude/plugins.json` 的 `plugins[].description`
- `.claude/hooks/hooks.json` 的 `hooks[].description`
- `src/skills.ts` 的 `WORKFLOW_SKILLS` 数组（决定归 `workflowSkills` 还是 `recommendedSkills`）

**输出 `dist/catalog.json`：**

```json
{
  "generatedAt": "2026-04-21T...",
  "workflowSkills": [{ "name": "brainstorming", "description": "..." }, ...],
  "recommendedSkills": [{ "name": "claude-code-agent", "description": "..." }, ...],
  "plugins": [{ "name": "auriga-go", "description": "..." }, ...],
  "hooks": [{ "name": "notify", "description": "..." }, ...]
}
```

**构建流程：**

- `package.json`: `"build": "tsc && node dist/build/generate-catalog.js"`——两步必须同时保留；CI 里加一条"发布前 `test -f dist/catalog.json`"校验，防止漏改 build 脚本导致发布产物缺 catalog
- 复用 `src/utils.ts` 导出的 `SkillsLock` / `PluginDef` 类型
- `package.json` 的 `files` 字段显式列出运行时产物（不含 `dist/build/`），避免 build 脚本发到 npm
- YAML frontmatter 解析用 **`gray-matter`**（markdown frontmatter 标准库，轻量）；避免正则——`parallel-implementation` / `ui-ux-pro-max` 等 skill 的 description 跨多行含转义字符，正则易漏

### 5.5 Scope 词汇统一

外层统一成 `project` / `user`（与 `claude plugins --scope user` 一致）；作用于 `skills` / `recommended` / `plugins`；CLI 内部映射：

- skills / recommended: `user` → `npx skills add -g`，`project` → 无 flag
- plugins: `user` → `claude plugins install --scope user`，`project` → `--scope project`
- hooks（非交互）: `user` → `~/.claude/settings.json`；默认 / `project` → `./.claude/settings.json`。`project-local`（`./.claude/settings.local.json`）只在 TTY 菜单可选。

`workflow` 不受 `--scope` 影响；与它组合时 fail-fast（§3.5 规则 6）。

## 6. 向后兼容与版本

**非破坏性变更**：

- 新增 `install` 子命令（非交互入口）
- 新增详细 `--help` 输出（含 catalog）
- `npx auriga-cli`（无参）沿用现有 checkbox 菜单——老用户 muscle memory 不受影响

**Bump: minor**（1.x → 1.y）。

README 更新：

- 新增一段介绍非交互用法（Agent / CI 场景）
- CLI 表面示例同步

## 7. 错误处理

**解析阶段（§3.5 / §5.2 规则触发）：**

| 场景 | 行为 |
|---|---|
| 多个位置 `<type>`（例 `install workflow skills`） | fail-fast + `install takes one <type> at a time` |
| `--all` + `<type>` / filter / `--lang` / `--cwd` | fail-fast + `--all is atomic; no extra types or filters` |
| filter flag 与 `<type>` 不匹配（例 `install workflow --skill x` / `install --skill x`） | fail-fast + `--skill requires 'install skills'`（依 flag 对应） |
| `--lang` / `--cwd` 不在 `workflow` 下使用 | fail-fast + `--lang/--cwd only apply to workflow` |
| `--scope` 与 `workflow` 组合 | fail-fast + `--scope does not apply to workflow` |
| `--skill foo` 未知名字（catalog 校验） | fail-fast + `unknown skill 'foo'; available: ...` |
| `--lang xx` 不在 LANGUAGES | fail-fast + 列可选 |
| `--scope foo` 非法值 | fail-fast |
| `--cwd /path` 不存在 | fail-fast |
| 顶层未知参数（未经 `install`） | fail-fast + 提示 `--help` |
| `dist/catalog.json` 缺失（CLI 启动即校验） | fail-fast + `catalog missing; run 'npm run build' or reinstall` |

**安装阶段（`install --all` 见 §5.3.1；单类别 install 同义）：**

| 场景 | 行为 |
|---|---|
| Precheck 失败（`claude` CLI 缺失，`--all` 或含 `plugins` 的单类装） | **exit 1**（未动文件）+ 提示 `install Claude Code first: https://docs.claude.com/claude-code` |
| `fetchContentRoot()` 网络失败 | **exit 1** + 提示 `fetch failed; check network and retry. If persistent, the GitHub raw endpoint may be blocked in your region.` |
| `npx skills add` 单个 skill 失败 | `log.error` 打印该 skill、继续下一个；skills 类整体结果汇总到 `install --all` 的按类状态 |
| 单一类别彻底失败，但其它类别成功（`install --all`） | **exit 2** + stderr 打印按类状态 + 具体重试命令 |
| 单类别 install 失败（例：`install plugins` 整体失败） | **exit 1**（没有"部分"概念） |
| workflow 已有 `CLAUDE.md` | `.bak + 覆盖`（沿用现状，非交互下不额外确认） |
| 成功完成 `install --all` 或单类别（非交互路径） | **最后一行** stderr 打印 `⚠ Reload your Claude Code session to pick up the new harness (CLAUDE.md / skills / plugins are loaded at session startup).` |

**原则**：
- 解析阶段错误一律 fail-fast + 友好提示
- 安装阶段区分三档：精检失败（exit 1）/ 彻底失败（exit 1）/ 部分成功（exit 2）
- 错误文案尽量包含"可直接粘贴的下一条命令"

## 8. 测试策略

### 新增

- `tests/cli-parse.test.ts`：按 §3.5 规则逐条覆盖——
  - 合法路径：`guide`、`install`、`install --all`、`install <type>`（5 个类别）、`install <type> --<filter> a b`
  - 违法路径：多 type、`--all` + 任何额外参数、filter 不匹配 type、`--lang` 用在非 workflow、`--scope` 用在 workflow、未知 skill 名、未知 top-level flag、`guide` 带任何参数
- `tests/install-nontty.test.ts`：
  - `install`（无参 + `stdin: 'ignore'`）→ exit 1 + 预期错误串
  - `install --all` (precheck pass) → 各 installX 被调用，opts 传递正确，stderr 末尾含 reload 提醒（mock `exec` 避免真跑 `claude plugins install`）
  - `install --all` (mock `claude` 缺失) → exit 1 + precheck 错误串
  - `install --all` (mock plugins 类别失败、其它成功) → exit 2 + 按类状态 + 重试命令
  - `install catalog.json 缺失` 冒烟
- `tests/guide.test.ts`：
  - `guide` 输出包含 Step 1–5 + Troubleshooting 标题
  - `guide` 在非 TTY（`stdout: 'pipe'`）或 `NO_COLOR=1` 下输出不含 ANSI escape 码
  - `guide` 带任意参数 → exit 1

### 现有

- `tests/hooks.test.ts`：签名改动后更新 caller（install 函数加了 `opts` 参数）
- `tests/ship-loop.test.sh`：不受影响

### 验证口径

- `npm test` 必过
- 手动跑 `DEV=1 node dist/cli.js install --all --cwd /tmp/smoke-test` 验端到端
- 非 TTY（`process.stdin.isTTY === false`）：`DEV=1 node dist/cli.js install < /dev/null` → 应 exit 1

## 9. 风险

1. **catalog drift**：npm 发布版 vs GitHub `main` 漂移。缓解：走 `.github/workflows/release.yml`——推 tag 自动触发 CI publish，不再有"忘了发"风险。不需要额外机制。
2. **`claude plugins install` 非 TTY 行为**（spike #1 已验证 2026-04-21）：三种场景（install、marketplace add 幂等、marketplace add 错误）均非交互 OK，exit 0/1 干净，无 hang 无 prompt。`stdio: "inherit"` 现路径安全。**已解除风险**，保留此条作为"版本升级时需回归测试"的注记。
3. **Session reload 感知**（spike #2 已验证 2026-04-21）：实测确认 **CLAUDE.md / skills / plugins 三类均在 session 启动时加载，不支持热重载**——子 `claude -p` 自省 system prompt 明确："启动时 cwd 里没有 CLAUDE.md，刚才的 cp 是会话开始后发生的，不会被追加到已锁定的 system prompt"。当前 spec 设计（install 成功后 stderr 打印 reload 提醒 + guide SOP Step 4 明说 REQUIRED）成立。**已知限制**，由 guide SOP 强制告知 Agent。若将来 Claude Code 支持热加载，重新评估降级措辞。
4. **`npx skills add --yes` 的幂等**：重复跑不应炸但可能有输出噪音；作为已知行为不处理。
5. **`--skill foo`（不存在名）的校验依赖 catalog**：若 catalog 漏生成（发布失误），校验会误报"未知 skill"。§5.4 已约定 CI 发布前校验 `dist/catalog.json` 存在。
6. **`.claude/plugins.json` 描述手写**：和上游 plugin 真实 metadata 可能漂移。**原则**：catalog 只信 repo 内部源（`plugins.json` / `hooks.json` / `SKILL.md` frontmatter）；新增插件 PR 同步 `plugins.json` 的 `description` 字段。
7. **`--skill` 等 filter flag 的值里含类似类别名的 skill**（理论可能，例如将来若有 skill 叫 `plugins`）：当前 nargs terminator 基于 `--` 前缀，不把类别名算作 terminator，所以安全。catalog 校验会挡住误用。
8. **Guide SOP 漂移**：SOP 静态模板写在 `src/guide.ts`，与实际 `install --all` 行为硬编码对齐。若将来改 exit code 语义或 install 流程，guide 得同步改。缓解：test 覆盖——`tests/guide.test.ts` 快照 guide 输出，修改时触发审阅。

## 10. 未决项（落地前必须 spike）

**状态：两条 spike 均已于 2026-04-21 跑完（见 `findings.md` 全文与 §9 Risk #2/#3 更新）。**

- ✅ Spike #1：`claude plugins install` 非交互 OK（exit 0/1 干净，无 hang 无 prompt）——`plugins.ts` 现路径无需改
- ✅ Spike #2：三类均需 session 重启（**分支 (b) 命中**）——guide Step 4 "REQUIRED" 保持；§7 reload 提醒成立

原 spike 设计段保留如下备查：

---

### Spike #1 — `claude plugins install` 非 TTY 真实行为

在一个干净项目里、`claude -p --worktree` 非交互 session 内跑 `claude plugins install <pkg> --scope project`：

- 会 prompt 吗？hang 吗？
- exit code 是 0/1，还是有更细分级？
- 输出 stdout/stderr 的时序和 `stdio: "inherit"` 兼容吗？

**分支：**

- 行为正常（直接装完、exit 0/1 清晰）→ spec 无需改，落地时按现有 `plugins.ts` 路径复用
- 会 prompt → 查 upstream 的 `-y` / env 变量 bypass；更新 `plugins.ts` 调用
- Hang 或无法非交互 → 必须在 spec 里把 plugins 从 `install --all` 降级为"可选类别"，并在 guide SOP 里明示

### Spike #2 — 同 session reload 行为

在一个干净项目里、`claude -p --worktree` session 跑 `npx auriga-cli install --all` 后，**不退出 session**，紧接着：

- 触发一个 skill（例：`/brainstorming` 或描述型触发），看能否识别
- 读 `CLAUDE.md`（`cat CLAUDE.md`），看 Agent 是否能感知新内容影响工作流
- 跑一个依赖 plugin 的触发（例：`/auriga-go`），看 plugin 是否已注册

**三种可能分支：**

- (a) 全部同 session 立即生效 → guide Step 4 从"REQUIRED"降级为"skip if you're in a fresh session"；§7 reload 提醒改为"hint"
- (b) 全部需要重启 session → 按当前 spec 保留 Step 4 硬提醒
- (c) 部分生效（CLAUDE.md 动态扫描、plugin 需重启，或反之）→ Step 4 要按类区分，guide 要更新

### Spike 结果回写机制

每个 spike 跑完，结果写入本 spec 的 §9 Risk 对应条目 + §3.6 guide 模板定稿。spike 的 transcript 存档到 `docs/worklog/worklog-<日期>-<分支名>/`（PR Ready 时一起迁移）。

## 11. 验收

**命令形态：**

- [ ] `npx auriga-cli --help` 打印详细目录，含所有 workflow skills / recommended skills / plugins / hooks 的名字 + 描述
- [ ] `npx auriga-cli guide`（TTY）打印 §3.6 的 SOP（5 个 Step + Troubleshooting），含 ANSI 色
- [ ] `npx auriga-cli guide`（非 TTY 或 `NO_COLOR=1`）输出同内容、无 ANSI 色
- [ ] `npx auriga-cli guide foo` 任意参数 exit 1
- [ ] `npx auriga-cli install --all` 在非 TTY 下装好 workflow / skills / plugins / hooks（不含 recommended）；成功输出末尾含 reload 提醒
- [ ] `npx auriga-cli install workflow --lang zh-CN` 装中文 CLAUDE.md
- [ ] `npx auriga-cli install skills --skill brainstorming test-driven-development` 只装两个 skill
- [ ] `npx auriga-cli install`（TTY 无参）进 checkbox 菜单（现状行为）
- [ ] `npx auriga-cli install`（非 TTY 无参）exit 1 + 正确错误串
- [ ] `npx auriga-cli`（无参、TTY）进 checkbox 菜单（沿用现状，与 `install` 无参等价）

**fail-fast 矩阵：**

- [ ] `npx auriga-cli install workflow skills`（多 type）exit 1
- [ ] `npx auriga-cli install --all --skill foo` exit 1
- [ ] `npx auriga-cli install --all recommended` exit 1
- [ ] `npx auriga-cli install workflow --skill foo` exit 1
- [ ] `npx auriga-cli install --skill foo`（无 type）exit 1
- [ ] `npx auriga-cli install hooks --scope user` → exit 0（hooks 从 v1.9.1 起接受 `--scope`）
- [ ] `npx auriga-cli install workflow --scope user` exit 1
- [ ] `npx auriga-cli install skills --skill foo`（未知名）exit 1 + 列可选
- [ ] `npx auriga-cli guide --anything` / `guide foo`（任意参数）exit 1
- [ ] CLI 启动时 `dist/catalog.json` 缺失 → exit 1

**分级退出码：**

- [ ] mock：`claude` CLI 缺失时跑 `install --all` → precheck 阶段 exit 1，未动本地文件
- [ ] mock：workflow / skills / hooks 成功、plugins 失败 → exit 2；stderr 含按类状态 + `Retry: npx auriga-cli install plugins`
- [ ] mock：单独 `install plugins` 失败 → exit 1（单类别无"部分"概念）

**其它：**

- [ ] `npm test` 全绿（含新增的 parse / non-tty / guide / exit-code 测试）
- [ ] README 加 Agent bootstrap recipe 一段（开头即示例 `npx -y auriga-cli guide`；同时说明 `-y` 是 npx 的 flag）
- [x] ~~根 `CLAUDE.md` 加"如何重新安装 harness"的反向指针（指向 `auriga-cli guide`）~~ — 原 spec 实现时加了；PR #46 做 CLAUDE.md SSOT 瘦身时移除。现 bootstrap recipe 只在 `README.md` / `README.zh-CN.md` 留存。
- [ ] `package.json` 版本号 bump minor
- [ ] §10 的两条 spike 已跑完，结果回写到 §9 Risk 对应条目
