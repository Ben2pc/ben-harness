#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import {
  exec,
  fetchContentRoot,
  getPackageRoot,
  isNonInteractive,
  LANGUAGES,
  type InstallOpts,
} from "./utils.js";
import { installWorkflow } from "./workflow.js";
import { installSkills, installRecommendedSkills } from "./skills.js";
import { installPlugins } from "./plugins.js";
import { installHooks } from "./hooks.js";
import { loadCatalog } from "./catalog.js";
import { renderHelp } from "./help.js";
import { renderGuide } from "./guide.js";

const RELOAD_REMINDER =
  "\n⚠ Reload your Claude Code session to pick up the new harness (CLAUDE.md / skills / plugins are loaded at session startup).\n";

// ---------------------------------------------------------------------------
// parseArgs — pure argv parser (spec §3.5 / §5.2)
// ---------------------------------------------------------------------------

export type CategoryName = "workflow" | "skills" | "recommended" | "plugins" | "hooks";

export interface InstallParsed {
  all: boolean;
  type?: CategoryName;
  filter?: string[];
  lang?: string;
  cwd?: string;
  scope?: "project" | "user";
}

export type ParsedArgs =
  | { command: "help" }
  | { command: "version" }
  | { command: "guide" }
  | { command: "install"; install: InstallParsed };

const CATEGORY_SET = new Set<CategoryName>([
  "workflow",
  "skills",
  "recommended",
  "plugins",
  "hooks",
]);

const TYPE_FOR_FILTER = {
  "--skill": "skills",
  "--recommended-skill": "recommended",
  "--plugin": "plugins",
  "--hook": "hooks",
} as const;

function parseErr(msg: string): never {
  throw new Error(msg);
}

function requireValue(argv: string[], i: number, flag: string): string {
  const v = argv[i + 1];
  if (v === undefined || v.startsWith("-")) {
    parseErr(`${flag} requires a value.`);
  }
  return v;
}

// Consume values for a filter flag until the next flag-like token
// ("--..." / "-..."), the explicit "--" terminator, or end-of-argv.
// Returns [values, nextIndex].
function consumeFilter(argv: string[], start: number): [string[], number] {
  const values: string[] = [];
  let i = start;
  while (i < argv.length) {
    const t = argv[i];
    if (t === "--") { i += 1; break; }
    if (t.startsWith("-")) break;
    values.push(t);
    i += 1;
  }
  return [values, i];
}

export function parseArgs(argv: string[]): ParsedArgs {
  // Top-level verb / flag dispatch.
  //
  // Bare `npx auriga-cli` (empty argv) dispatches to the install bare
  // form, NOT to help — runInstall then picks TTY legacy-menu vs
  // non-TTY error hint. Routing here to help would break the documented
  // zero-arg entrypoint used by the interactive menu.
  if (argv.length === 0) return { command: "install", install: { all: false } };
  const head = argv[0];
  if (head === "--help" || head === "-h" || head === "help") return { command: "help" };
  if (head === "--version" || head === "-v") return { command: "version" };
  if (head === "guide") {
    if (argv.length > 1) {
      parseErr("guide takes no arguments. Run 'npx auriga-cli --help' for usage.");
    }
    return { command: "guide" };
  }
  if (head !== "install") {
    parseErr(`unknown argument '${head}'. Run 'npx auriga-cli --help' for usage.`);
  }

  return { command: "install", install: parseInstall(argv.slice(1)) };
}

function parseInstall(argv: string[]): InstallParsed {
  const out: InstallParsed = { all: false };
  let filterFlag: keyof typeof TYPE_FOR_FILTER | null = null;

  let i = 0;
  while (i < argv.length) {
    const t = argv[i];

    if (t === "--all") {
      out.all = true;
      i += 1;
      continue;
    }

    if (t === "--lang") {
      out.lang = requireValue(argv, i, "--lang");
      i += 2;
      continue;
    }
    if (t === "--cwd") {
      out.cwd = requireValue(argv, i, "--cwd");
      i += 2;
      continue;
    }
    if (t === "--scope") {
      out.scope = requireValue(argv, i, "--scope") as "project" | "user";
      i += 2;
      continue;
    }

    if (t in TYPE_FOR_FILTER) {
      const [values, next] = consumeFilter(argv, i + 1);
      if (values.length === 0) {
        parseErr(`${t} requires at least one name (or '*' for all).`);
      }
      out.filter = values;
      filterFlag = t as keyof typeof TYPE_FOR_FILTER;
      i = next;
      continue;
    }

    if (CATEGORY_SET.has(t as CategoryName)) {
      if (out.type) parseErr("install takes one <type> at a time.");
      out.type = t as CategoryName;
      i += 1;
      continue;
    }

    // Any other positional (non-flag) while a type is already set is
    // the user trying to pass a second type or stray filter value — spec
    // §3.5 rule 1: one type at a time.
    if (!t.startsWith("-") && out.type) {
      parseErr("install takes one <type> at a time.");
    }

    parseErr(`unknown argument '${t}'. Run 'npx auriga-cli --help' for usage.`);
  }

  validateInstall(out, filterFlag);
  return out;
}

function validateInstall(out: InstallParsed, filterFlag: string | null): void {
  // Rule 2: --all is atomic.
  if (out.all) {
    if (out.type || out.filter || out.lang !== undefined || out.cwd !== undefined) {
      parseErr("--all is atomic; no extra types or filters allowed.");
    }
    // --all may combine with --scope.
    if (out.scope !== undefined) validateScopeValue(out.scope);
    return;
  }

  // Rule 3: filter flag requires matching type.
  if (filterFlag) {
    const requiredType = TYPE_FOR_FILTER[filterFlag as keyof typeof TYPE_FOR_FILTER];
    if (out.type !== requiredType) {
      parseErr(`${filterFlag} requires 'install ${requiredType}'.`);
    }
  }

  // Rule 5: --lang / --cwd only for workflow.
  if ((out.lang !== undefined || out.cwd !== undefined) && out.type !== "workflow") {
    parseErr("--lang/--cwd only apply to workflow.");
  }

  // Rule 6: --scope only for skills / recommended / plugins.
  if (out.scope !== undefined) {
    if (out.type === "workflow" || out.type === "hooks") {
      parseErr("--scope only applies to skills / recommended / plugins.");
    }
    validateScopeValue(out.scope);
  }

  // Value validation for workflow.
  if (out.type === "workflow" && out.lang !== undefined) {
    const valid = LANGUAGES.map((l) => l.value);
    if (!valid.includes(out.lang)) {
      parseErr(`unknown language '${out.lang}'; available: ${valid.join(", ")}`);
    }
  }
  if (out.type === "workflow" && out.cwd !== undefined) {
    if (!fs.existsSync(out.cwd)) {
      parseErr(`--cwd directory does not exist: ${out.cwd}`);
    }
  }

  // Catalog-backed filter name validation (spec §7).
  if (out.filter && out.type) {
    validateFilterAgainstCatalog(out.type, out.filter);
  }
}

function validateFilterAgainstCatalog(type: CategoryName, filter: string[]): void {
  if (filter.length === 1 && filter[0] === "*") return;
  const catalogPath = path.join(getPackageRoot(), "dist", "catalog.json");
  if (!fs.existsSync(catalogPath)) return;
  const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf-8"));
  const bucket =
    type === "skills" ? catalog.workflowSkills
    : type === "recommended" ? catalog.recommendedSkills
    : type === "plugins" ? catalog.plugins
    : type === "hooks" ? catalog.hooks
    : null;
  if (!bucket) return;
  const available = bucket.map((e: { name: string }) => e.name);
  const singular = categorySingular(type);
  for (const name of filter) {
    if (!available.includes(name)) {
      parseErr(`unknown ${singular} '${name}'; available: ${available.join(", ")}`);
    }
  }
}

function categorySingular(type: CategoryName): string {
  return type === "recommended" ? "recommended skill"
    : type === "skills" ? "skill"
    : type.replace(/s$/, "");
}

function validateScopeValue(scope: string): void {
  if (scope !== "project" && scope !== "user") {
    parseErr(`unknown --scope value '${scope}'; expected 'project' or 'user'.`);
  }
}

// ---------------------------------------------------------------------------
// main — returns exit code (spec §5.3.1 / §7)
// ---------------------------------------------------------------------------

// --all excludes `recommended` (per spec §3.2) — they're opt-in utilities.
const ALL_CATEGORIES: CategoryName[] = ["workflow", "skills", "plugins", "hooks"];

function readVersion(): string {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(getPackageRoot(), "package.json"), "utf-8"),
  );
  return pkg.version as string;
}

export async function main(argv: string[]): Promise<number> {
  let parsed: ParsedArgs;
  try {
    parsed = parseArgs(argv);
  } catch (e) {
    process.stderr.write(`${(e as Error).message}\n`);
    return 1;
  }

  const version = readVersion();

  if (parsed.command === "help") {
    try {
      const catalog = loadCatalog(getPackageRoot());
      process.stdout.write(renderHelp(catalog, version));
      return 0;
    } catch (e) {
      process.stderr.write(`${(e as Error).message}\n`);
      return 1;
    }
  }

  if (parsed.command === "version") {
    process.stdout.write(`${version}\n`);
    return 0;
  }

  if (parsed.command === "guide") {
    const color = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
    process.stdout.write(renderGuide({ color, version }));
    return 0;
  }

  // install
  return runInstall(parsed.install);
}

async function runInstall(p: InstallParsed): Promise<number> {
  // Bare `install` (no type, no --all, no filter): TTY → menu, non-TTY → exit 1.
  if (!p.all && !p.type) {
    if (isNonInteractive()) {
      process.stderr.write(
        "Interactive mode requires a TTY. Run 'npx auriga-cli --help' for non-interactive options.\n",
      );
      return 1;
    }
    return runLegacyMenu();
  }

  // --all: precheck + fan-out.
  if (p.all) {
    return runAll(p);
  }

  // Single-category install.
  return runSingle(p);
}

/**
 * Precheck external prerequisites before touching any files.
 * Returns null if OK, or an error message.
 */
function precheckExternal(need: CategoryName[]): string | null {
  if (need.includes("plugins")) {
    try { exec("which claude"); }
    catch { return "'claude' CLI not in PATH. Install Claude Code first (https://docs.claude.com/claude-code), then re-run."; }
  }
  return null;
}

async function safeFetchContentRoot(): Promise<{ root?: string; err?: string }> {
  try {
    return { root: await fetchContentRoot() };
  } catch (e) {
    return {
      err: `fetch failed: ${(e as Error).message}. Check network and retry; if persistent, the GitHub raw endpoint may be blocked in your region.`,
    };
  }
}

async function runAll(p: InstallParsed): Promise<number> {
  const pre = precheckExternal(["plugins"]);
  if (pre) {
    process.stderr.write(`${pre}\n`);
    return 1;
  }

  const fetched = await safeFetchContentRoot();
  if (fetched.err) {
    process.stderr.write(`${fetched.err}\n`);
    return 1;
  }
  const packageRoot = fetched.root!;

  const status: { category: CategoryName; ok: boolean; err?: string }[] = [];
  for (const category of ALL_CATEGORIES) {
    const opts: InstallOpts = {
      interactive: false,
      scope: p.scope ?? "project",
    };
    try {
      await dispatchInstaller(category, packageRoot, opts);
      status.push({ category, ok: true });
    } catch (e) {
      status.push({ category, ok: false, err: (e as Error).message });
    }
  }

  for (const s of status) {
    if (s.ok) {
      process.stderr.write(`[OK]   ${s.category}\n`);
    } else {
      process.stderr.write(`[FAIL] ${s.category} — ${s.err}\n`);
    }
  }

  const failed = status.filter((s) => !s.ok);
  if (failed.length === 0) {
    process.stderr.write(RELOAD_REMINDER);
    return 0;
  }

  // Retry hint must carry `--scope` forward for any category where the
  // spec-mapped flag applies (skills / recommended / plugins — see §3.2
  // / §5.5). Dropping it silently retries into the default project
  // scope and leaves the intended user-scope install incomplete.
  const scopeSuffix = p.scope ? ` --scope ${p.scope}` : "";
  process.stderr.write("\nRetry:\n");
  for (const s of failed) {
    const suffix = scopeCategory(s.category) ? scopeSuffix : "";
    process.stderr.write(`  npx auriga-cli install ${s.category}${suffix}\n`);
  }
  return 2;
}

function scopeCategory(c: CategoryName): boolean {
  // Categories where `--scope` is a real flag (spec §3.2). workflow
  // and hooks ignore it; don't bolt it onto their retry lines.
  return c === "skills" || c === "recommended" || c === "plugins";
}

async function runSingle(p: InstallParsed): Promise<number> {
  const category = p.type as CategoryName;
  const pre = precheckExternal(category === "plugins" ? ["plugins"] : []);
  if (pre) {
    process.stderr.write(`${pre}\n`);
    return 1;
  }

  const fetched = await safeFetchContentRoot();
  if (fetched.err) {
    process.stderr.write(`${fetched.err}\n`);
    return 1;
  }
  const packageRoot = fetched.root!;

  const opts: InstallOpts = {
    interactive: false,
    lang: p.lang,
    cwd: p.cwd,
    scope: p.scope ?? "project",
    selected: p.filter,
  };

  try {
    await dispatchInstaller(category, packageRoot, opts);
    process.stderr.write(RELOAD_REMINDER);
    return 0;
  } catch (e) {
    process.stderr.write(`${(e as Error).message}\n`);
    return 1;
  }
}

async function dispatchInstaller(
  category: CategoryName,
  packageRoot: string,
  opts: InstallOpts,
): Promise<void> {
  switch (category) {
    case "workflow": return installWorkflow(packageRoot, opts);
    case "skills": return installSkills(packageRoot, opts);
    case "recommended": return installRecommendedSkills(packageRoot, opts);
    case "plugins": return installPlugins(packageRoot, opts);
    case "hooks": return installHooks(packageRoot, opts);
  }
}

// ---------------------------------------------------------------------------
// Legacy checkbox menu — preserved for `npx auriga-cli install` in TTY
// and `npx auriga-cli` with no args.
// ---------------------------------------------------------------------------

async function runLegacyMenu(): Promise<number> {
  // Lazy-load TTY-only deps so the non-interactive code path doesn't
  // force inquirer / printBanner / withEsc into the module graph.
  const { checkbox } = await import("@inquirer/prompts");
  const { printBanner, withEsc } = await import("./utils.js");

  const version = readVersion();
  printBanner(version);
  console.log("");

  if (process.env.DEV === "1") {
    console.log("Using local content (DEV mode)\n");
  } else {
    console.log("Fetching latest content from GitHub...");
  }
  const packageRoot = await fetchContentRoot();
  if (process.env.DEV !== "1") console.log("");

  const moduleTypes = await withEsc(checkbox({
    message: "Select module types to install:",
    choices: [
      { name: "Workflow — CLAUDE.md + AGENTS.md", value: "workflow" as const, checked: true },
      { name: "Skills — Development process skills (brainstorming, TDD, debugging...)", value: "skills" as const, checked: true },
      { name: "Recommended Skills — Extra utility skills (claude-code-agent, codex-agent...)", value: "recommended" as const, checked: true },
      { name: "Plugins — Claude Code plugins (skill-creator, claude-md-management, codex...)", value: "plugins" as const, checked: true },
      { name: "Hooks — Claude Code hooks (notifications, etc.)", value: "hooks" as const, checked: true },
    ],
  }));

  if (moduleTypes.length === 0) {
    console.log("Nothing selected. Bye!");
    return 0;
  }

  const interactiveOpts: InstallOpts = { interactive: true };

  if (moduleTypes.includes("workflow")) {
    console.log("\n--- Workflow ---\n");
    await installWorkflow(packageRoot, interactiveOpts);
  }
  if (moduleTypes.includes("skills")) {
    console.log("\n--- Skills ---\n");
    await installSkills(packageRoot, interactiveOpts);
  }
  if (moduleTypes.includes("recommended")) {
    console.log("\n--- Recommended Skills ---\n");
    await installRecommendedSkills(packageRoot, interactiveOpts);
  }
  if (moduleTypes.includes("plugins")) {
    console.log("\n--- Plugins ---\n");
    await installPlugins(packageRoot, interactiveOpts);
  }
  if (moduleTypes.includes("hooks")) {
    console.log("\n--- Hooks ---\n");
    await installHooks(packageRoot, interactiveOpts);
  }

  console.log("\n✨ Installation complete!\n");
  return 0;
}

// ---------------------------------------------------------------------------
// Script entrypoint
// ---------------------------------------------------------------------------

const invokedAsScript = process.argv[1]
  && process.argv[1].endsWith("cli.js");

if (invokedAsScript) {
  main(process.argv.slice(2))
    .then((code) => { if (code !== 0) process.exit(code); })
    .catch((err) => {
      if (err instanceof Error && ["ExitPromptError", "CancelPromptError"].includes(err.name)) {
        console.log("\nCancelled.");
        process.exit(0);
      }
      console.error(err);
      process.exit(1);
    });
}
