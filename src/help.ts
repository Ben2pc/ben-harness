import type { Catalog, CatalogEntry } from "./catalog.js";
import type { CategoryName } from "./types.js";

/**
 * Renders the detailed `--help` output per spec §4. Agent-readable
 * catalog of every installable: Agent can decide what to pass to
 * `install <type>` without a second round-trip.
 */
export function renderHelp(catalog: Catalog, version: string): string {
  const col = (entries: CatalogEntry[]): string =>
    entries.map((e) => `  ${padRight(e.name, 30)} ${truncate(e.description, 50)}`).join("\n");

  return `auriga-cli v${version} — install Claude Code harness modules

USAGE
  npx auriga-cli guide                                   Agent bootstrap SOP (start here)
  npx auriga-cli install                                 (TTY only) checkbox menu
  npx auriga-cli install --all [--scope <s>]             workflow + skills + plugins + hooks
                                                         (excludes recommended — install separately)
  npx auriga-cli install <type> [type-specific flags]    single category
  npx auriga-cli install <type> --help                   per-category help + catalog subset
  npx auriga-cli --help

  For non-interactive (Agent) use, prepend npx's own -y flag:
    npx -y auriga-cli guide
    npx -y auriga-cli install --all

TYPES (exactly one with <type> form)
  workflow       CLAUDE.md + AGENTS.md (workflow manifesto)
  skills         Default-on workflow skills (listed below)
  recommended    Opt-in utility skills (listed below)
  plugins        Claude Code plugins (listed below)
  hooks          Project-level hooks for Claude Code (listed below)

TYPE-SPECIFIC FLAGS
  workflow:       --lang <code>                  default en; available: en, zh-CN
                  --cwd <dir>                    default current working directory
  skills:         --skill <names...>             space-separated; '*' = all
                  --scope <project|user>         default project
  recommended:    --recommended-skill <names...>
                  --scope <project|user>         default project
  plugins:        --plugin <names...>
                  --scope <project|user>         default project
  hooks:          --hook <names...>              non-interactive default installs every
                                                 hook with defaultOn != false
                  --scope <project|user>         default project

TOP-LEVEL OPTIONS
  -h, --help                     show this help
  -v, --version                  show version

──────────────────────────────────────────────────────
CATALOG (what each category contains)
──────────────────────────────────────────────────────

Workflow skills (category: skills)  ← installed by --all
${col(catalog.workflowSkills)}

Recommended skills (category: recommended)  ← NOT installed by --all
${col(catalog.recommendedSkills)}

Plugins (category: plugins)
${col(catalog.plugins)}

Hooks (category: hooks)
${col(catalog.hooks)}

More: https://github.com/Ben2pc/auriga-cli
`;
}

/**
 * Per-type help (`install <type> --help`). Shows just the flags and
 * the matching catalog slice so an Agent can make a precise pick
 * without scrolling past unrelated categories.
 */
export function renderTypeHelp(
  catalog: Catalog,
  type: CategoryName,
  version: string,
): string {
  const col = (entries: CatalogEntry[]): string =>
    entries.map((e) => `  ${padRight(e.name, 30)} ${truncate(e.description, 50)}`).join("\n");

  const header = `auriga-cli v${version} — install ${type}`;
  switch (type) {
    case "workflow":
      return `${header}

USAGE
  npx auriga-cli install workflow [--lang <code>] [--cwd <dir>]

FLAGS
  --lang <code>   default en; available: en, zh-CN
  --cwd <dir>     default current working directory

NOTE
  workflow has no --scope flag (single file + AGENTS.md symlink).
`;

    case "skills":
      return `${header}

USAGE
  npx auriga-cli install skills [--skill <names...>] [--scope <project|user>]

FLAGS
  --skill <names...>       space-separated; '*' = all
                           omit → install every workflow skill listed below
  --scope <project|user>   default project

CATALOG (workflow skills — default-on set)
${col(catalog.workflowSkills)}
`;

    case "recommended":
      return `${header}

USAGE
  npx auriga-cli install recommended [--recommended-skill <names...>] [--scope <project|user>]

FLAGS
  --recommended-skill <names...>   space-separated; '*' = all
                                   omit → install every recommended skill listed below
  --scope <project|user>           default project

CATALOG (recommended skills — opt-in, NOT installed by --all)
${col(catalog.recommendedSkills)}
`;

    case "plugins":
      return `${header}

USAGE
  npx auriga-cli install plugins [--plugin <names...>] [--scope <project|user>]

FLAGS
  --plugin <names...>      space-separated; '*' = all
                           omit → install every plugin listed below
  --scope <project|user>   default project

CATALOG (plugins)
${col(catalog.plugins)}
`;

    case "hooks":
      return `${header}

USAGE
  npx auriga-cli install hooks [--hook <names...>] [--scope <project|user>]

FLAGS
  --hook <names...>        space-separated; '*' = every compatible hook
                           omit → install every hook with defaultOn != false
  --scope <project|user>   default project
                           (project-local is only reachable via the TTY menu)

CATALOG (hooks — entries flagged "(opt-in)" require explicit --hook)
${col(catalog.hooks)}
`;
  }
}

function padRight(s: string, width: number): string {
  return s.length >= width ? s : s + " ".repeat(width - s.length);
}

function truncate(s: string, width: number): string {
  return s.length <= width ? s : s.slice(0, width - 1) + "…";
}
