# auriga-go

Workflow autopilot for the [auriga workflow](https://github.com/Ben2pc/auriga-cli). Reminder-based navigation across the 12 phases in `CLAUDE.md`, with an Experimental `ship` mode that drives a small-scope spec to a PR Ready candidate autonomously.

## What it does

Invoke `/auriga-go` (or say "按照工作流继续" / "drive the workflow forward"). It inspects repo state, identifies the next workflow phase, records the step in your Agent's native task tracker, then either proceeds (`auto`, default) or proposes one step (`step`). It tells the main Agent which skill to invoke next — it does not dispatch skills itself.

Experimental `ship` mode (`/auriga-go ship [max-iter]`) runs a Stop-hook-backed loop until the Agent emits `<ship-done>Ready</ship-done>` or `<ship-done>Blocked</ship-done>`, applying strictest defaults at every decision point. See `skills/auriga-go/references/ship.md`.

## Structure

- `skills/auriga-go/` — the skill (autoloaded by description + `/auriga-go` slash command).
- `hooks/hooks.json` + `scripts/ship-loop.sh` — Stop hook bundled at the plugin level (uses `${CLAUDE_PLUGIN_ROOT}` for a reliable substitution). Gated by the state file `.claude/auriga-go-ship.local.md` — no-op outside `ship` mode.

## Why a plugin

This used to be a pure skill with a `hooks:` block in its SKILL.md frontmatter. Claude Code's `${CLAUDE_SKILL_DIR}` substitution does not currently expand inside skill-bundled hook commands (empirically tested in both `claude -p` and interactive mode), and the hook's cwd is the project root rather than the skill dir, so the documented `./scripts/...` form also fails. Plugins use `${CLAUDE_PLUGIN_ROOT}` which works in both modes, so the hook was lifted to the plugin level; the skill keeps its description-based natural-language trigger.

## Install

Installed automatically by `npx auriga-cli` — this plugin is registered in the auriga-cli marketplace. Manual install:

```bash
claude plugins marketplace add Ben2pc/auriga-cli
claude plugins install auriga-go@auriga-cli
```
