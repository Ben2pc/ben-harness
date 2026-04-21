English | [中文](README.zh-CN.md)

# auriga-cli

A modular Claude Code harness — install only the parts you need.

This repo itself is a fully configured harness project. You can clone it to see the full setup, or use the CLI to install individual modules into your own project.

## What's Included

| Module | Description |
|---|---|
| **Workflow** | `CLAUDE.md` auriga workflow: requirement clarification -> TDD -> Review, Harness principles, Subagent usage guide |
| **Skills** | Development process skills — brainstorming, systematic-debugging, TDD, verification, planning, playwright |
| **Recommended Skills** | Optional utility skills (e.g. `codex-agent`) you can add on top of the workflow skills |
| **Plugins** | Recommended Claude Code plugins — skill-creator, claude-md-management, codex |
| **Hooks** | Claude Code hooks: `notify` (macOS notification, focus-aware sound-only when terminal is frontmost), `pr-create-guard` (PostToolUse body snapshot after `gh pr create`), `pr-ready-guard` (PreToolUse block on stray planning docs / active specs in `docs/specs/` / unpushed commits before `gh pr ready`) |

## Quick Start

### Agent Bootstrap (non-TTY)

Running inside `claude -p`, `claude -p --worktree`, or any non-interactive Agent session? Start here:

```bash
npx -y auriga-cli guide
```

This prints a 5-step SOP (prerequisite check → `install --all` → optional recommended skills → session reload → verify). Follow it top-to-bottom and the Agent can install the full harness without any human prompt.

The leading `-y` belongs to `npx` (it auto-confirms package installation), **not** to `auriga-cli`.

Non-interactive install commands:

```bash
npx -y auriga-cli install --all              # workflow + skills + plugins + hooks (atomic)
npx -y auriga-cli install recommended        # opt-in utility skills (not in --all)
npx -y auriga-cli install <type> [--flags]   # one of: workflow | skills | recommended | plugins | hooks
npx -y auriga-cli --help                     # full catalog + flags
```

Exit codes: `0` success, `1` fatal (precheck / parse / fetch), `2` partial success — `stderr` lists per-category `[OK]/[FAIL]` and a `Retry:` hint. After install, reload the Claude Code session so the new `CLAUDE.md` / skills / plugins are picked up.

### Interactive menu

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
| deep-review | [Ben2pc/g-claude-code-plugins](https://github.com/Ben2pc/g-claude-code-plugins) | Multi-dimensional PR review orchestrator (required + conditional reviewers + punch list) |
| test-designer | [Ben2pc/g-claude-code-plugins](https://github.com/Ben2pc/g-claude-code-plugins) | Independent-Evaluation test designer for TDD red phase |
| parallel-implementation | [Ben2pc/g-claude-code-plugins](https://github.com/Ben2pc/g-claude-code-plugins) | Slice planner for parallel multi-subagent code writing |

Supports both project and global installation scopes.

### Plugins

Installs selected plugins via `claude plugins install`, automatically adding required marketplaces.

| Plugin | Description |
|---|---|
| skill-creator | Create and manage custom skills |
| claude-md-management | Audit and improve CLAUDE.md |
| codex | Codex cross-model collaboration |
| auriga-go | Workflow autopilot for the auriga workflow. Reminder-based navigation across the 12 `CLAUDE.md` phases with an Experimental hook-backed `ship` mode. Bundles a skill (description-based NL trigger + `/auriga-go`) plus a plugin-level Stop hook for ship mode. |

### Hooks

Installs Claude Code hooks into a chosen scope. Each hook is self-contained under `.claude/hooks/<name>/` and can be customized without editing code.

| Hook | Description |
|---|---|
| notify | Native macOS notification when Claude needs your attention. Shows the brand mark in the small app-icon position; click brings the originating terminal back to focus. **Focus-aware**: when the launching terminal is already frontmost, drops the banner and plays the sound only (toggle via `soundOnlyWhenFocused` in `config.json`). **Per-project group ID**: new notifications cleanly replace older ones in Notification Center, no process accumulation, no cross-project interference. Auto-installs `alerter` via Homebrew (`vjeantet/tap/alerter`). Customize sound and icon by editing `.claude/hooks/notify/config.json` and `.claude/hooks/notify/icon.png`. macOS-only at runtime; silent no-op on other platforms. |
| pr-create-guard | PostToolUse hook for `gh pr create`. Queries the newly-created PR via `gh pr view` and injects a body snapshot (headings found + TODO-checkbox counts) as `additionalContext` for the Agent to self-verify against the PR-readiness scope / acceptance / risks / TODO contract. Never blocks — PostToolUse runs after the fact. Graceful degradation when gh is unavailable. |
| pr-ready-guard | PreToolUse hook for `gh pr ready`. Blocks on structural signals only: (1) stray planning docs at `findings.md` / `progress.md` / `task_plan.md` / `docs/superpowers/specs/*.md` — must be archived to `docs/worklog/worklog-<date>-<branch>/` (or deleted) per CLAUDE.md `Document Conventions`; (2) unfinalized active specs at `docs/specs/*.md` — must be promoted to `docs/architecture/`, archived, or deleted; (3) unpushed commits on the current branch. No text regex of PR content is ever used as a block signal. On pass, injects a PR body snapshot as `additionalContext`. |

Scope choices:

- **Project local** (recommended for cross-platform teams): files under `./.claude/hooks/`, registered in `./.claude/settings.local.json` — per-developer, not committed.
- **Project**: same files, registered in `./.claude/settings.json` — shared with the team via git.
- **User**: files under `~/.claude/hooks/`, registered in `~/.claude/settings.json` — global across all your projects.

Re-running the installer preserves your customized `config.json` and `icon.png`, overwrites the runtime, and never produces duplicate hook entries (idempotent merge by sentinel marker).

## Requirements

- Node.js >= 18
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) (required for Plugins and Hooks modules)
- [Homebrew](https://brew.sh) (recommended for the `notify` hook to install `alerter`)

## License

MIT
