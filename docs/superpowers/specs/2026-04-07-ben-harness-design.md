# ben-harness Design Spec

## Overview

ben-harness 是一个公开的 GitHub 仓库，用于将个人的 Claude Code harness engineering（Workflow、Skills、Plugins）模块化共享给团队和社区。

仓库本身就是一个完整安装好 harness 的参考项目（所见即所得），同时内置 CLI 安装器，支持 `npx ben-harness` 交互式按需安装到任意目标项目。

## 核心设计决策

1. **仓库即参考项目**：根目录的 CLAUDE.md、skills-lock.json、.agents/、.claude/ 就是一个可用的 harness，不需要 modules/ 子目录间接层。
2. **模块化菜单**：同事按需 pick & choose，不强制全套安装。
3. **Copy 模式 + 标准工具链**：Workflow 用 copy，Skills 走 `npx skills experimental_install`，Plugins 走 `claude plugins install`。
4. **只共享 Workspace 级指令**：不含 `~/.claude/CLAUDE.md` 中的个人 profile。

## 仓库结构

```
ben-harness/
├── package.json               # name: "ben-harness", bin: "ben-harness"
├── tsconfig.json
├── src/
│   └── cli.ts                 # CLI 安装器入口
├── CLAUDE.md                  # Workspace 级指令（Workflow + Harness 原则 + Subagent 原则）
├── AGENTS.md -> CLAUDE.md     # 软链接，兼容不同 Agent 框架
├── skills-lock.json           # Skills 清单，npx skills experimental_install 消费
├── .agents/
│   └── skills/
│       ├── brainstorming/
│       ├── systematic-debugging/
│       ├── test-driven-development/
│       ├── verification-before-completion/
│       ├── planning-with-files/
│       └── playwright-cli/
├── .claude/
│   ├── settings.json          # 项目级 Claude Code 配置
│   └── plugins.json           # 推荐 plugin 清单（CLI 消费）
└── README.md
```

## 模块定义

### Workflow

- **内容**：根目录的 `CLAUDE.md`（通用 Workflow、Harness 原则、Subagent 使用原则等）
- **安装方式**：copy 到目标目录
- **额外操作**：在目标目录创建 `AGENTS.md -> CLAUDE.md` 软链接
- **冲突处理**：目标已有 CLAUDE.md 时提示用户确认是否覆盖

### Skills

- **内容**：根目录的 `skills-lock.json`
- **安装方式**：merge 到目标项目的 `skills-lock.json`，然后执行 `npx skills experimental_install`
- **Scope 选择**：project（默认）或 global
- **Merge 策略**：
  - 目标项目无同名 skill → 直接新增
  - 同名 skill，hash 相同 → 跳过（已是最新）
  - 同名 skill，hash 不同 → 提示用户是否更新
- **交互**：展示 skill 列表（名称 + 描述），用户 checkbox 多选

### Plugins

- **内容**：`.claude/plugins.json` 中的推荐列表
- **安装方式**：`claude plugins install <package> --scope <user|project>`
- **Scope 选择**：user（默认）或 project
- **Marketplace 处理**：如果 plugin 需要额外 marketplace，先自动执行 `claude plugins marketplace add`
- **冲突处理**：通过 `claude plugins list` 检查，已安装的跳过
- **交互**：展示 plugin 列表（名称 + 描述），用户 checkbox 多选

## plugins.json 格式

```json
{
  "plugins": [
    {
      "name": "skill-creator",
      "package": "skill-creator@claude-plugins-official",
      "description": "创建和管理自定义 skills"
    },
    {
      "name": "codex",
      "package": "codex@openai-codex",
      "description": "Codex 跨模型协作",
      "marketplace": {
        "name": "openai-codex",
        "source": "openai/codex-plugin-cc"
      }
    }
  ]
}
```

## CLI 交互流程

```
$ npx ben-harness

? 选择要安装的模块类型：（多选）
  ◉ Workflow — 通用 Workflow + Harness 原则 + Subagent 原则
  ◉ Skills — 开发流程 skills（brainstorming, TDD, debugging 等）
  ◉ Plugins — Claude Code 插件（skill-creator, hookify, codex 等）

--- Workflow ---
? 安装目标目录：（默认当前目录）
  > .
  → 检测到目标已有 CLAUDE.md，是否覆盖？[y/N]
  → Copy CLAUDE.md ✓
  → 创建 AGENTS.md -> CLAUDE.md 软链接 ✓

--- Skills ---
? Skills 安装范围：
  ○ Project（当前项目）
  ○ Global（用户级）

? 选择要安装的 Skills：（多选）
  ◉ brainstorming — 需求澄清与设计探索
  ◉ systematic-debugging — 系统化调试
  ◉ test-driven-development — 测试驱动开发
  ...

  → brainstorming: hash 一致，跳过
  → systematic-debugging: 有更新，是否更新？[Y/n]
  → test-driven-development: 新增
  → 合并 skills-lock.json ✓
  → 执行 npx skills experimental_install ✓

--- Plugins ---
? Plugins 安装范围：
  ○ User（用户级）
  ○ Project（当前项目）

? 选择要安装的 Plugins：（多选）
  ◉ skill-creator — 创建和管理自定义 skills
  ◉ hookify — 从对话分析创建 hooks
  ...

  → 添加 marketplace: openai-codex ✓
  → 安装 codex@openai-codex --scope user ✓
  → skill-creator: 已存在，跳过

✨ 安装完成！
```

## 技术栈

- **语言**：TypeScript
- **运行方式**：`npx ben-harness`（免安装）
- **交互库**：@inquirer/prompts（checkbox, select, confirm, input）
- **子进程调用**：Node.js child_process.execSync（调用 npx skills、claude plugins 等）
- **文件操作**：Node.js fs 模块

## 验收标准

1. `npx ben-harness` 可以正常运行，展示交互式菜单
2. Workflow 模块可以 copy CLAUDE.md 到指定目录，并创建 AGENTS.md 软链接
3. Skills 模块可以 merge skills-lock.json 并执行 `npx skills experimental_install`
4. Plugins 模块可以安装 marketplace（如需要）并执行 `claude plugins install`
5. 已存在的 skill（hash 相同）正确跳过，hash 不同时提示更新
6. 已安装的 plugin 正确跳过
7. 目标已有 CLAUDE.md 时正确提示覆盖确认
