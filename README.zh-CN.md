[English](README.md) | 中文

# auriga-cli

模块化的 Claude Code harness —— 按需选装你需要的部分。

这个仓库本身就是一个完整配置好的 harness 项目。可以直接 clone 查看完整配置，也可以用 CLI 把各模块安装到你自己的项目中。

## 包含什么

| 模块 | 说明 |
|---|---|
| **Workflow** | `CLAUDE.md` 开发工作流：需求澄清 → TDD → Review，Harness 原则，Subagent 使用指南 |
| **Skills** | 开发流程 skills —— brainstorming、systematic-debugging、TDD、verification、planning、playwright |
| **Recommended Skills** | 可选的工具类 skills（如 `ui-ux-pro-max`），在 workflow skills 之外按需追加 |
| **Plugins** | 推荐的 Claude Code 插件 —— skill-creator、claude-md-management、codex |
| **Hooks** | Claude Code hooks：`notify`（macOS 通知）、`pr-create-guard`（`gh pr create` 后注入 PR body 快照的 PostToolUse）、`pr-ready-guard`（`gh pr ready` 前按游离 planning 文档 / 未 push commits 拦截的 PreToolUse） |

## 快速开始

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

通过 `npx skills add` 逐个安装选中的 skills，同时安装到 Claude Code 和 Codex。

| Skill | 来源 | 说明 |
|---|---|---|
| brainstorming | [obra/superpowers](https://github.com/obra/superpowers) | 需求澄清与设计探索 |
| systematic-debugging | [obra/superpowers](https://github.com/obra/superpowers) | 系统化调试，先找根因再修复 |
| test-driven-development | [obra/superpowers](https://github.com/obra/superpowers) | 测试驱动开发流程 |
| verification-before-completion | [obra/superpowers](https://github.com/obra/superpowers) | 完成前验证，用证据说话 |
| planning-with-files | [OthmanAdi/planning-with-files](https://github.com/OthmanAdi/planning-with-files) | 文件化任务计划与进度跟踪 |
| playwright-cli | [microsoft/playwright-cli](https://github.com/microsoft/playwright-cli) | 浏览器自动化与测试 |
| ui-ux-pro-max | [nextlevelbuilder/ui-ux-pro-max-skill](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) | UI/UX 设计与开发增强 |
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

### Hooks

把 Claude Code hooks 安装到选定的作用域。每个 hook 都是 `.claude/hooks/<name>/` 下一个自包含目录，可以**不改代码**自定义。

| Hook | 说明 |
|---|---|
| notify | 当 Claude 需要你关注时弹一条原生 macOS 通知。在通知小图标位显示品牌图，点击通知可把发起 Claude 的终端拉回前台。会自动通过 Homebrew 安装 `alerter`（`vjeantet/tap/alerter`）。改 `.claude/hooks/notify/config.json` 即可换提示音、替换 `.claude/hooks/notify/icon.png` 即可换图标。仅 macOS 运行时生效，其它平台静默 no-op。 |
| pr-create-guard | `gh pr create` 的 PostToolUse hook。创建成功后通过 `gh pr view` 拉真实 PR body，扫 `^##` / `^###` headings 并统计 `- [ ]` / `- [x]`，通过 `additionalContext` 注入快照让 Agent 对照 step 10 的"范围 / 验收标准 / 风险 / 剩余 TODO"四要素。不 block——PostToolUse 发生在动作之后。gh 不可用时静默降级。 |
| pr-ready-guard | `gh pr ready` 的 PreToolUse hook。**只按结构信号**拦截：仓库根存在游离 planning 文档（`findings.md` / `progress.md` / `task_plan.md`），或 `docs/superpowers/specs/*.md` 未归档——这些必须按 CLAUDE.md 的"文档规范"迁到 `docs/worklog/worklog-<date>-<branch>/`；或者本地有未 push commits。**不做 PR 正文文本 regex 匹配**。放行时注入 PR body 快照。 |

作用域选择：

- **Project local**（推荐给跨平台团队）：文件落在 `./.claude/hooks/`，注册到 `./.claude/settings.local.json` —— 每个开发者各自安装，不进 git。
- **Project**：同样的文件，注册到 `./.claude/settings.json` —— 整个团队共享。
- **User**：文件落在 `~/.claude/hooks/`，注册到 `~/.claude/settings.json` —— 全局生效。

重新跑安装器时会保留你修改过的 `config.json` 和 `icon.png`，覆盖运行时本身，并通过 marker 字段幂等去重，绝不会产生重复的 hook 条目。

## 环境要求

- Node.js >= 18
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code)（Plugins 和 Hooks 模块需要）
- [Homebrew](https://brew.sh)（`notify` hook 用来安装 `alerter`，可选）

## License

MIT
