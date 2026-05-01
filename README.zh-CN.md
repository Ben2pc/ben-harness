[English](README.md) | 中文

# auriga-cli

模块化的 Claude Code harness —— 按需选装你需要的部分。

这个仓库本身就是一个完整配置好的 harness 项目。可以直接 clone 查看完整配置，也可以用 CLI 把各模块安装到你自己的项目中。

## 包含什么

| 模块 | 说明 |
|---|---|
| **Workflow** | `CLAUDE.md` 里的 auriga 工作流：需求澄清 → TDD → Review，Harness 原则，Subagent 使用指南 |
| **Skills** | 开发流程 + 编排类 skills —— brainstorming、systematic-debugging、TDD、verification、planning、playwright、deep-review、test-designer、parallel-implementation |
| **Recommended Skills** | 可选的工具类 skills（如 `codex-agent`、`claude-code-agent`），在 workflow skills 之外按需追加 |
| **Plugins** | 推荐的 Claude Code 插件 —— skill-creator、claude-md-management、codex、auriga-go |
| **Hooks** | Claude Code hooks：`notify`（macOS 通知，终端在焦点时仅放声不弹横幅 —— **opt-in**：`install --all` 不装，需要 `install hooks --hook notify`）、`pr-create-guard`（`gh pr create` 后注入 PR body 快照的 PostToolUse）、`pr-ready-guard`（`gh pr ready` 前按游离 planning 文档 / `docs/specs/` 内未清理的 spec / 未 push commits 拦截的 PreToolUse） |

## 快速开始

### Agent Bootstrap（非交互）

在 `claude -p`、`claude -p --worktree` 或任何非交互 Agent 会话里想装整套 harness？从这里开始：

```bash
npx -y auriga-cli guide
```

会打印一份 5 步 SOP（前置检查 → `install --all` → 可选 recommended skills → 重启 session → 验证）。Agent 照着顺序往下跑就能装完整套 harness，全程不需要人按键。

开头的 `-y` 是 **npx 自己的 flag**（用来跳过"是否要装这个包"的确认），**不是** auriga-cli 的参数。

非交互安装命令：

```bash
npx -y auriga-cli install --all              # workflow + skills + plugins + hooks（原子）
npx -y auriga-cli install recommended        # 可选工具 skills（不在 --all 内）
npx -y auriga-cli install <type> [--flags]   # 单类：workflow | skills | recommended | plugins | hooks
npx -y auriga-cli --help                     # 完整 catalog + flag 说明
```

退出码：`0` 成功；`1` 致命错误（前置检查 / 解析 / 拉取失败）；`2` 部分成功——`stderr` 会列出逐类 `[OK]/[FAIL]` 和 `Retry:` 提示。装完后请重启 Claude Code session，让新的 `CLAUDE.md` / skills / plugins / hook 注册 生效。

### 交互式菜单

```bash
npx auriga-cli
```

交互式菜单，按需选择安装：

```
? 选择要安装的模块类型：
  ◉ Workflow — CLAUDE.md + AGENTS.md
  ◉ Skills — 开发流程 skills
  ◉ Recommended Skills — 额外的工具 skills
  ◉ Plugins — Claude Code 插件
  ◉ Hooks — Claude Code hooks
```

每个模块支持作用域选择（Skills: project/global，Plugins: user/project，Hooks: project local / project / user）。

## 模块详情

### Workflow

将 `CLAUDE.md` 复制到目标项目，并创建 `AGENTS.md` 软链接以兼容不同 Agent 框架。支持中英文版本，安装时可选择。

- 目标已有 `CLAUDE.md` 时会自动备份后覆盖
- 涵盖：需求澄清、TDD、代码 Review、分支工作流、Subagent 编排

### Skills

通过 `npx skills add` 安装选中的 skills，同时安装到 Claude Code 和 Codex。

| Skill | 来源 | 说明 |
|---|---|---|
| brainstorming | [obra/superpowers](https://github.com/obra/superpowers) | 需求澄清与设计探索 |
| systematic-debugging | [obra/superpowers](https://github.com/obra/superpowers) | 系统化调试，先找根因再修复 |
| test-driven-development | [obra/superpowers](https://github.com/obra/superpowers) | 测试驱动开发流程 |
| verification-before-completion | [obra/superpowers](https://github.com/obra/superpowers) | 完成前验证，用证据说话 |
| planning-with-files | [OthmanAdi/planning-with-files](https://github.com/OthmanAdi/planning-with-files) | 文件化任务计划与进度跟踪 |
| playwright-cli | [microsoft/playwright-cli](https://github.com/microsoft/playwright-cli) | 浏览器自动化与测试 |
| deep-review | [Ben2pc/g-claude-code-plugins](https://github.com/Ben2pc/g-claude-code-plugins) | 多维度 PR review 编排器（必选 + 条件 + punch list 汇总） |
| test-designer | [Ben2pc/g-claude-code-plugins](https://github.com/Ben2pc/g-claude-code-plugins) | TDD 红灯阶段的 Independent Evaluation 测试设计器 |
| parallel-implementation | [Ben2pc/g-claude-code-plugins](https://github.com/Ben2pc/g-claude-code-plugins) | 多 subagent 并行写代码时的切片计划器 |

支持 project 和 global 两种安装范围。

### Plugins

通过 `claude plugins install` 安装选中的插件，自动添加所需的 marketplace。

| 插件 | 说明 |
|---|---|
| skill-creator | 创建和管理自定义 skills |
| claude-md-management | 审计和改进 CLAUDE.md |
| codex | Codex 跨模型协作 |
| auriga-go | auriga 工作流的自动驾驶：按 `CLAUDE.md` 的 phase 做 reminder-based 导航；包含 Experimental 的 hook-backed `ship` 模式。内置一个 skill（按 description 的自然语言触发 + `/auriga-go` slash command）和一个 plugin 层面的 Stop hook。 |

### Hooks

把 Claude Code hooks 安装到选定的作用域。每个 hook 都是 `.claude/hooks/<name>/` 下一个自包含目录，可以**不改代码**自定义。

| Hook | 说明 |
|---|---|
| notify *(opt-in)* | 当 Claude 需要你关注时弹一条原生 macOS 通知。在通知小图标位显示品牌图，点击通知可把发起 Claude 的终端拉回前台。**焦点感知**：发起 Claude 的终端正处于前台时，仅放提示音不弹横幅（通过 `config.json` 的 `soundOnlyWhenFocused` 切换）。**按项目分组**：新通知会干净地替换通知中心里的旧条目，不会进程堆积，也不会跨项目互相覆盖。会自动通过 Homebrew 安装 `alerter`（`vjeantet/tap/alerter`）。改 `.claude/hooks/notify/config.json` 即可换提示音、替换 `.claude/hooks/notify/icon.png` 即可换图标。仅 macOS 运行时生效，其它平台静默 no-op。 |
| pr-create-guard | `gh pr create` 的 PostToolUse hook。创建成功后通过 `gh pr view` 拉真实 PR body，扫 `^##` / `^###` headings 并统计 `- [ ]` / `- [x]`，通过 `additionalContext` 注入快照让 Agent 对照 PR-readiness 阶段的"范围 / 验收标准 / 风险 / 剩余 TODO"四要素。不 block——PostToolUse 发生在动作之后。gh 不可用时静默降级。 |
| pr-ready-guard | `gh pr ready` 的 PreToolUse hook。**只按结构信号**拦截：(1) 仓库根存在游离 planning 文档（`findings.md` / `progress.md` / `task_plan.md`）或 `docs/superpowers/specs/*.md` 未归档——按 CLAUDE.md 的"文档规范"迁到 `docs/worklog/worklog-<date>-<branch>/` 或删除；(2) `docs/specs/*.md` 内有未结案的活跃 spec——晋升到 `docs/architecture/`、归档或删除；(3) 本地有未 push commits。**不做 PR 正文文本 regex 匹配**。放行时注入 PR body 快照。 |

作用域选择：

- **Project local**（推荐给跨平台团队）：文件落在 `./.claude/hooks/`，注册到 `./.claude/settings.local.json` —— 每个开发者各自安装，不进 git。
- **Project**：同样的文件，注册到 `./.claude/settings.json` —— 整个团队共享。
- **User**：文件落在 `~/.claude/hooks/`，注册到 `~/.claude/settings.json` —— 全局生效。

重新跑安装器时会保留你修改过的 `config.json` 和 `icon.png`，覆盖运行时本身，并通过 marker 字段幂等去重，绝不会产生重复的 hook 条目。

## 环境要求

- Node.js >= 18
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code)（Plugins 和 Hooks 模块需要）
- [Homebrew](https://brew.sh)（`notify` hook 用来安装 `alerter`，可选）

## 开发

- `npm test` —— 单元/集成测试（亚秒）
- `bash tests/ship-loop.test.sh` —— ship-loop Stop hook 测试（bash）
- `npm run test:e2e` —— 完整的 tarball 安装 e2e 套件（~90-120s）。`npm pack` 打出真实 tarball，装到临时项目，对着 GitHub 上当前 HEAD SHA 对应的 content 跑 `auriga-cli install`。预检用 `git branch -r --contains HEAD`，纯本地、不发网络请求，因此 **HEAD 必须能被任何本地 remote ref 追溯到**（`git push` 成功时会同步更新本地 remote ref；如果是别人推的，先 `git fetch`）。`plugins` 和 `--all` 场景还要求 `claude` CLI 已在 PATH，否则这两条会优雅跳过。

## License

MIT
