# ben-harness Development Guide

> The root `CLAUDE.md` is the **product** (installed to user projects). This file guides development of ben-harness itself.

## What This Is

Interactive CLI (`npx ben-harness`) that modularly installs Claude Code harness components: Workflow, Skills, Recommended Skills, Plugins.

## Architecture

```
src/
  cli.ts        — Entry point, main menu, module dispatch
  utils.ts      — Types, constants, remote fetch, exec, logging
  workflow.ts   — CLAUDE.md + AGENTS.md installation
  skills.ts     — Workflow skills + recommended skills installation
  plugins.ts    — Plugin + marketplace installation
```

- No CLI framework — direct `@inquirer/prompts` (checkbox, select, input)
- Content fetched from GitHub at runtime (`fetchContentRoot()`)
- `withEsc()` wraps all prompts for ESC cancellation support

## Key Conventions

- **Skill categorization**: `WORKFLOW_SKILLS` in `skills.ts` lists standard workflow skills. Everything else in `skills-lock.json` is "recommended". Adding a recommended skill: `npx skills add <repo> --skill <name>` + add description to `RECOMMENDED_DESCRIPTIONS` in `skills.ts`.
- **Plugin config**: `.claude/plugins.json` defines available plugins. Marketplace sources auto-install.
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
| `CLAUDE.md` / `CLAUDE.zh-CN.md` | Manual | Workflow templates (the product) |

## Versioning & Release

- Version in `package.json` follows semver: patch for bugfixes, minor for new features, major for breaking changes.
- Bump version before merging feature PRs. Publish: `npm publish`.

## Principles

- This is a ~500-line tool. Keep it simple — no abstractions for one-time operations.
- Main menu order = execution order: Workflow -> Skills -> Recommended Skills -> Plugins.
- ESM throughout (`"type": "module"`, `.js` extensions in imports).
