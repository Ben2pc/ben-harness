# auriga-cli Development Guide

> The root `CLAUDE.md` is the **product** (installed to user projects). This file guides development of auriga-cli itself.

## What This Is

Interactive CLI (`npx auriga-cli`) that modularly installs Claude Code harness components: Workflow, Skills, Recommended Skills, Plugins, Hooks.

## Architecture

```
src/
  cli.ts        — Entry point, main menu, module dispatch
  utils.ts      — Types, constants, remote fetch, exec, logging, settings merge
  workflow.ts   — CLAUDE.md + AGENTS.md installation
  skills.ts     — Workflow skills + recommended skills installation
  plugins.ts    — Plugin + marketplace installation
  hooks.ts      — Per-hook directory copy + idempotent settings merge

.claude/hooks/
  hooks.json    — Hook registry (parallels .claude/plugins.json)
  notify/       — Self-contained notify hook (shipped to user projects)
                  index.mjs / config.json / icon.png / README.md

tools/notify-icon/  — Dev-only assets for regenerating notify/icon.png
                      (font + SIL OFL + Python+PIL generator + design.md)
```

- No CLI framework — direct `@inquirer/prompts` (checkbox, select, input)
- Content fetched from GitHub at runtime (`fetchContentRoot()`)
- `withEsc()` wraps all prompts for ESC cancellation support

## Key Conventions

- **Skill categorization**: `WORKFLOW_SKILLS` in `skills.ts` lists standard workflow skills. Everything else in `skills-lock.json` is "recommended". Adding a recommended skill: `npx skills add <repo> --skill <name>` + add description to `RECOMMENDED_DESCRIPTIONS` in `skills.ts`.
- **Plugin config**: `.claude/plugins.json` defines available plugins. Marketplace sources auto-install.
- **Hook config**: `.claude/hooks/hooks.json` defines available hooks. Each hook is a self-contained directory under `.claude/hooks/<name>/` containing `index.mjs`, `config.json`, `icon.png`, `README.md` (or whatever the hook needs). Adding a new hook: drop a new directory + add an entry to `hooks.json`. Dev-only assets (fonts, generators) live OUTSIDE `.claude/hooks/` (e.g. `tools/notify-icon/`) so the installer can copy `.claude/hooks/<name>/` wholesale.
- **Settings merge**: `addHookToSettings` in `utils.ts` is the only place that mutates a settings JSON object. It is pure, idempotent via the `marker` field (NOT command-string equality), and does not touch sibling keys. All hook installs go through it.
- **Subprocess calls**: Use `exec()` wrapper, `{ inherit: true }` for streaming output.
- **User-facing output**: Use `log.ok/warn/error/skip` for consistent colored output.

## Commands

```bash
npm run build    # tsc
npm run dev      # tsc --watch
npm start        # node dist/cli.js
DEV=1 npm start  # use local files instead of fetching from GitHub
```

## Data Sources

| File | Maintained by | Purpose |
|------|--------------|---------|
| `skills-lock.json` | `npx skills` CLI | Skill registry (do NOT edit structure manually) |
| `.claude/plugins.json` | Manual | Plugin definitions |
| `.claude/hooks/hooks.json` | Manual | Hook definitions (one entry per hook directory) |
| `CLAUDE.md` / `CLAUDE.zh-CN.md` | Manual | Workflow templates (the product). **Must be edited in tandem** — both languages must stay in sync |
| `README.md` / `README.zh-CN.md` | Manual | Public docs. **Must be edited in tandem** — both languages must stay in sync |

## Versioning & Release

- Version in `package.json` follows semver: patch for bugfixes, minor for new features, major for breaking changes.
- Bump version before merging feature PRs. Publish: `npm publish`.

## Principles

- Keep it simple — no abstractions for one-time operations.
- Main menu order = execution order: Workflow -> Skills -> Recommended Skills -> Plugins -> Hooks.
- ESM throughout (`"type": "module"`, `.js` extensions in imports).
