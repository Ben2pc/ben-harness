# auriga-cli Development Guide

> The root `CLAUDE.md` is the **product** (installed to user projects). This file guides development of auriga-cli itself.

## What This Is

Interactive CLI (`npx auriga-cli`) that modularly installs Claude Code harness components: Workflow, Skills, Recommended Skills, Plugins, Hooks.

## Architecture

```
src/
  cli.ts        — Entry point, main menu, module dispatch
  utils.ts      — Constants, remote fetch, exec, logging
  workflow.ts   — CLAUDE.md + AGENTS.md installation
  skills.ts     — Workflow skills + recommended skills installation
  plugins.ts    — Plugin + marketplace installation
  hooks.ts      — Per-hook directory copy + idempotent settings merge

.claude/hooks/
  hooks.json    — Hook registry (parallels .claude/plugins.json)
  notify/       — Self-contained notify hook (shipped to user projects)
                  index.mjs / config.json / icon.png / test.mjs / README.md
```

- No CLI framework — direct `@inquirer/prompts` (checkbox, select, input)
- Content fetched from GitHub at runtime (`fetchContentRoot()`)
- `withEsc()` wraps all prompts for ESC cancellation support

## Key Conventions

- **Skill categorization**: `WORKFLOW_SKILLS` in `skills.ts` lists standard workflow skills. Everything else in `skills-lock.json` is "recommended". Adding a recommended skill: `npx skills add <repo> --skill <name>` + add description to `RECOMMENDED_DESCRIPTIONS` in `skills.ts`.
- **Plugin config**: `.claude/plugins.json` defines available plugins. Marketplace sources auto-install.
- **Hook config**: `.claude/hooks/hooks.json` defines available hooks. Each hook is a self-contained directory under `.claude/hooks/<name>/`; the canonical entrypoint is `index.mjs` and the registry's `files[]` is the source of truth for what gets shipped (defaults: runtime + config + assets + README + an optional `test.mjs` smoke test). Adding a new hook: drop a new directory + add an entry to `hooks.json`. Any dev-only assets a hook needs (icon source files, generators, fonts) should live OUTSIDE `.claude/hooks/<name>/` so the installer can copy `.claude/hooks/<name>/` wholesale to user projects. Every value in `hooks.json` flows through `validateHookEntry` in `hooks.ts` at load time — `hook.name`, `hook.files[]`, `hook.preserveFiles[]`, and `dep.name` are all path/identifier validated before any filesystem touch, because the registry is fetched from raw GitHub at runtime and must be treated as untrusted input.
- **Hook payload fetch**: `hooks.json` is the only hook-related file in `CONTENT_FILES` (preloaded at startup). Each hook's individual files (`index.mjs`, `icon.png`, etc.) are lazy-fetched into the same `packageRoot` temp dir on demand by `ensureHookFilesFetched` — only when a user actually selects that hook. `installHooks` then copies from `packageRoot` into the user's target directory. In DEV mode `packageRoot` is the live repo, so the lazy fetch is a no-op.
- **Settings merge**: `addHookToSettings` (and its inverse `removeHookFromSettings`) in `hooks.ts` are the only places that mutate a settings JSON object. They are pure, idempotent (primary by `_marker` sentinel, secondary by command-string equality), throw on shape corruption rather than silently overwriting user data, and do not touch sibling keys. The atomic write helper uses a random tmp suffix + `O_CREAT | O_EXCL` to be safe against TOCTOU symlink races. All hook installs go through these primitives.
- **Subprocess calls**: Use `exec()` wrapper, `{ inherit: true }` for streaming output.
- **User-facing output**: Use `log.ok/warn/error/skip` for consistent colored output.

## Commands

```bash
npm run build    # tsc → dist/
npm run dev      # tsc --watch
npm start        # node dist/cli.js
DEV=1 npm start  # use local files instead of fetching from GitHub

npm test         # tsc -p tsconfig.test.json → dist-test/, then node --test
                 #   Hook installer unit + integration tests live in tests/.
                 #   Run before opening any PR that touches src/hooks.ts,
                 #   src/utils.ts, or .claude/hooks/.
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
