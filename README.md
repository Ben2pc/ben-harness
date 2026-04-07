# ben-harness

模块化的 Claude Code harness —— 按需选装你需要的部分。

这个仓库本身就是一个完整配置好的 harness 项目。可以直接 clone 查看完整配置，也可以用 CLI 把各模块安装到你自己的项目中。

## 包含什么

| 模块 | 说明 |
|---|---|
| **Workflow** | `CLAUDE.md` 开发工作流：需求澄清 → TDD → Review，Harness 原则，Subagent 使用指南 |
| **Skills** | 开发流程 skills —— brainstorming、systematic-debugging、TDD、verification、planning、playwright |
| **Plugins** | 推荐的 Claude Code 插件 —— skill-creator、claude-md-management、hookify、codex |

## 快速开始

```bash
npx ben-harness
```

交互式菜单，按需选择安装：

```
? 选择要安装的模块类型：
  ◉ Workflow — CLAUDE.md + AGENTS.md
  ◉ Skills — 开发流程 skills
  ◉ Plugins — Claude Code 插件
```

每个模块支持作用域选择（Skills: project/global，Plugins: user/project）。

## 模块详情

### Workflow

将 `CLAUDE.md` 复制到目标项目，并创建 `AGENTS.md` 软链接以兼容不同 Agent 框架。

- 目标已有 `CLAUDE.md` 时会提示确认是否覆盖
- 涵盖：需求澄清、TDD、代码 Review、分支工作流、Subagent 编排

### Skills

将选中的 skills 合并到目标项目的 `skills-lock.json`，然后执行 `npx skills experimental_install`。

| Skill | 来源 | 说明 |
|---|---|---|
| brainstorming | [obra/superpowers](https://github.com/obra/superpowers) | 需求澄清与设计探索 |
| systematic-debugging | [obra/superpowers](https://github.com/obra/superpowers) | 系统化调试，先找根因再修复 |
| test-driven-development | [obra/superpowers](https://github.com/obra/superpowers) | 测试驱动开发流程 |
| verification-before-completion | [obra/superpowers](https://github.com/obra/superpowers) | 完成前验证，用证据说话 |
| planning-with-files | [OthmanAdi/planning-with-files](https://github.com/OthmanAdi/planning-with-files) | 文件化任务计划与进度跟踪 |
| playwright-cli | [microsoft/playwright-cli](https://github.com/microsoft/playwright-cli) | 浏览器自动化与测试 |

智能合并：hash 相同跳过，hash 不同提示更新，新 skill 直接添加。

### Plugins

通过 `claude plugins install` 安装选中的插件，自动添加所需的 marketplace。

| 插件 | 说明 |
|---|---|
| skill-creator | 创建和管理自定义 skills |
| claude-md-management | 审计和改进 CLAUDE.md |
| hookify | 从对话分析创建 hooks |
| codex | Codex 跨模型协作 |

## 环境要求

- Node.js >= 18
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code)（Plugins 模块需要）

## License

MIT
