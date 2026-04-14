English | [中文](README.zh-CN.md)

# auriga-cli

A modular Claude Code harness — install only the parts you need.

This repo itself is a fully configured harness project. You can clone it to see the full setup, or use the CLI to install individual modules into your own project.

## What's Included

| Module | Description |
|---|---|
| **Workflow** | `CLAUDE.md` development workflow: requirement clarification -> TDD -> Review, Harness principles, Subagent usage guide |
| **Skills** | Development process skills — brainstorming, systematic-debugging, TDD, verification, planning, playwright |
| **Recommended Skills** | Optional utility skills (e.g. `ui-ux-pro-max`) you can add on top of the workflow skills |
| **Plugins** | Recommended Claude Code plugins — skill-creator, claude-md-management, codex |
| **Hooks** | Claude Code hooks (currently: `notify` — native macOS notification with brand icon + sound) |

## Quick Start

```bash
npx auriga-cli
```

Interactive menu — select what to install:

```
? Select module types to install:
  ◉ Workflow — CLAUDE.md + AGENTS.md
  ◉ Skills — Development process skills
  ◉ Recommended Skills — Extra utility skills
  ◉ Plugins — Claude Code plugins
  ◉ Hooks — Claude Code hooks
```

Each module supports scope selection (Skills: project/global, Plugins: user/project, Hooks: project local / project / user).

## Module Details

### Workflow

Copies `CLAUDE.md` to the target project and creates an `AGENTS.md` symlink for compatibility with different Agent frameworks. Supports English and Chinese — you choose during installation.

- Backs up existing `CLAUDE.md` before overwriting
- Covers: requirement clarification, TDD, code review, branch workflow, subagent orchestration

### Skills

Installs selected skills via `npx skills add`, targeting both Claude Code and Codex.

| Skill | Source | Description |
|---|---|---|
| brainstorming | [obra/superpowers](https://github.com/obra/superpowers) | Requirement clarification and design exploration |
| systematic-debugging | [obra/superpowers](https://github.com/obra/superpowers) | Systematic debugging — find root cause before fixing |
| test-driven-development | [obra/superpowers](https://github.com/obra/superpowers) | Test-driven development workflow |
| verification-before-completion | [obra/superpowers](https://github.com/obra/superpowers) | Pre-completion verification — evidence before assertions |
| planning-with-files | [OthmanAdi/planning-with-files](https://github.com/OthmanAdi/planning-with-files) | File-based task planning and progress tracking |
| playwright-cli | [microsoft/playwright-cli](https://github.com/microsoft/playwright-cli) | Browser automation and testing |
| ui-ux-pro-max | [nextlevelbuilder/ui-ux-pro-max-skill](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) | UI/UX design and development enhancement |

Supports both project and global installation scopes.

### Plugins

Installs selected plugins via `claude plugins install`, automatically adding required marketplaces.

| Plugin | Description |
|---|---|
| skill-creator | Create and manage custom skills |
| claude-md-management | Audit and improve CLAUDE.md |
| codex | Codex cross-model collaboration |

### Hooks

Installs Claude Code hooks into a chosen scope. Each hook is self-contained under `.claude/hooks/<name>/` and can be customized without editing code.

| Hook | Description |
|---|---|
| notify | Native macOS notification when Claude needs your attention. Auto-installs `terminal-notifier` via Homebrew. Customize sound and icon by editing `.claude/hooks/notify/config.json` and replacing `.claude/hooks/notify/icon.png`. macOS-only at runtime; silent no-op on other platforms. |

Scope choices:

- **Project local** (recommended for cross-platform teams): files under `./.claude/hooks/`, registered in `./.claude/settings.local.json` — per-developer, not committed.
- **Project**: same files, registered in `./.claude/settings.json` — shared with the team via git.
- **User**: files under `~/.claude/hooks/`, registered in `~/.claude/settings.json` — global across all your projects.

Re-running the installer preserves your customized `config.json` and `icon.png`, overwrites the runtime, and never produces duplicate hook entries (idempotent merge by sentinel marker).

## Requirements

- Node.js >= 18
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) (required for Plugins and Hooks modules)
- [Homebrew](https://brew.sh) (recommended for the `notify` hook to install `terminal-notifier`)

## License

MIT
