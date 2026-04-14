import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { checkbox, confirm, input, select } from "@inquirer/prompts";
import {
  exec,
  fetchExtraContentBinary,
  log,
  withEsc,
} from "./utils.js";

// --- Hook registry types ---

export interface HookDep {
  name: string;
  via: "brew";
  optional?: boolean;
}

export interface HookSettingsEvent {
  event: string;
  matcher?: string;
}

export interface HookDef {
  name: string;
  description: string;
  runtimePlatforms: string[];
  settingsEvents: HookSettingsEvent[];
  command: string;
  files: string[];
  preserveFiles?: string[];
  deps?: HookDep[];
  marker: string;
  /**
   * Per-hook customization hints rendered in the post-install summary.
   * The literal `{hookDir}` is substituted with the hook's resolved
   * install directory at print time. Empty / omitted → installer falls
   * back to a generic "see <dir>/README.md" pointer.
   */
  customizeHints?: string[];
}

export interface HooksConfig {
  hooks: HookDef[];
}

// --- Claude Code settings.json shape ---

export interface SettingsHookAction {
  type: "command";
  command: string;
  _marker?: string;
}

export interface SettingsHookGroup {
  matcher?: string;
  hooks: SettingsHookAction[];
}

export interface SettingsFile {
  hooks?: Record<string, SettingsHookGroup[]>;
  [key: string]: unknown;
}

// --- Registry validation ---
// hooks.json is fetched at runtime from raw.githubusercontent.com, so any
// downstream code that interpolates registry values into shell commands or
// filesystem paths is one force-push away from RCE / arbitrary-file-write
// for every user running `npx auriga-cli`. Validate every untrusted value
// once at load time, then trust it through the rest of the install flow.

const HOOK_NAME_RE = /^[a-z][a-z0-9-]*$/;
const DEP_NAME_RE = /^[a-z0-9][a-z0-9._+-]*$/;
const EVENT_NAME_RE = /^[A-Za-z][A-Za-z0-9_-]*$/;
// Whitelist for hook command templates. The registry is fetched from raw
// GitHub at runtime, and the command string is written verbatim into
// settings.json then executed by Claude Code on every hook fire — so an
// unconstrained string here is direct registry-RCE. We require:
//   <runtime> "$HOOK_DIR/<flat-basename>.<ext>"
// where runtime ∈ {node, python3, bash}, the path literal starts with
// $HOOK_DIR/, the basename is a flat alphanumeric identifier (no slashes,
// no dots — so no nested paths and no `..` traversal), the extension is
// alphanumeric, and there are no trailing arguments. Anything else is
// rejected at load time. Adding a runtime, allowing args, or relaxing
// the form requires a code change here, intentionally — see the security
// review trail in PR #7 for context.
const COMMAND_RE = /^(node|python3|bash) "\$HOOK_DIR\/[A-Za-z0-9_-]+\.[A-Za-z0-9]+"$/;

function isSafeRelativePath(file: unknown): boolean {
  if (typeof file !== "string" || file.length === 0) return false;
  if (file.startsWith("/") || file.startsWith("\\")) return false;
  if (file.includes("\0")) return false;
  const normalized = path.posix.normalize(file);
  if (normalized !== file) return false;
  if (normalized === ".." || normalized.startsWith("../") || normalized.includes("/../")) return false;
  return true;
}

function validateHookEntry(hook: unknown, idx: number): void {
  if (!hook || typeof hook !== "object") {
    throw new Error(`hooks.json: hooks[${idx}] is not an object`);
  }
  const h = hook as Record<string, unknown>;
  if (typeof h.name !== "string" || !HOOK_NAME_RE.test(h.name)) {
    throw new Error(
      `hooks.json: hooks[${idx}].name must match ${HOOK_NAME_RE} (got ${JSON.stringify(h.name)})`,
    );
  }
  if (!Array.isArray(h.files)) {
    throw new Error(`hooks.json: hooks[${idx}].files must be an array`);
  }
  for (const f of h.files) {
    if (!isSafeRelativePath(f)) {
      throw new Error(
        `hooks.json: hooks[${idx}].files contains unsafe path ${JSON.stringify(f)}`,
      );
    }
  }
  if (h.preserveFiles !== undefined) {
    if (!Array.isArray(h.preserveFiles)) {
      throw new Error(`hooks.json: hooks[${idx}].preserveFiles must be an array`);
    }
    for (const f of h.preserveFiles) {
      if (!isSafeRelativePath(f)) {
        throw new Error(
          `hooks.json: hooks[${idx}].preserveFiles contains unsafe path ${JSON.stringify(f)}`,
        );
      }
    }
  }
  if (h.deps !== undefined) {
    if (!Array.isArray(h.deps)) {
      throw new Error(`hooks.json: hooks[${idx}].deps must be an array`);
    }
    for (const d of h.deps) {
      if (!d || typeof d !== "object") {
        throw new Error(`hooks.json: hooks[${idx}].deps entry is not an object`);
      }
      const dn = (d as Record<string, unknown>).name;
      if (typeof dn !== "string" || !DEP_NAME_RE.test(dn)) {
        throw new Error(
          `hooks.json: hooks[${idx}].deps name must match ${DEP_NAME_RE} (got ${JSON.stringify(dn)})`,
        );
      }
    }
  }
  if (!Array.isArray(h.runtimePlatforms)) {
    throw new Error(`hooks.json: hooks[${idx}].runtimePlatforms must be an array`);
  }
  if (!Array.isArray(h.settingsEvents)) {
    throw new Error(`hooks.json: hooks[${idx}].settingsEvents must be an array`);
  }
  for (const evt of h.settingsEvents) {
    if (!evt || typeof evt !== "object") {
      throw new Error(`hooks.json: hooks[${idx}].settingsEvents entry is not an object`);
    }
    const en = (evt as Record<string, unknown>).event;
    if (typeof en !== "string" || !EVENT_NAME_RE.test(en)) {
      throw new Error(
        `hooks.json: hooks[${idx}].settingsEvents.event must match ${EVENT_NAME_RE} (got ${JSON.stringify(en)})`,
      );
    }
    const matcher = (evt as Record<string, unknown>).matcher;
    if (matcher !== undefined && (typeof matcher !== "string" || !EVENT_NAME_RE.test(matcher))) {
      throw new Error(
        `hooks.json: hooks[${idx}].settingsEvents.matcher must match ${EVENT_NAME_RE} (got ${JSON.stringify(matcher)})`,
      );
    }
  }
  if (typeof h.command !== "string" || !COMMAND_RE.test(h.command)) {
    throw new Error(
      `hooks.json: hooks[${idx}].command must match the safe template ${COMMAND_RE} (got ${JSON.stringify(h.command)})`,
    );
  }
  if (typeof h.marker !== "string" || h.marker.length === 0) {
    throw new Error(`hooks.json: hooks[${idx}].marker must be a non-empty string`);
  }
  if (h.customizeHints !== undefined) {
    if (!Array.isArray(h.customizeHints)) {
      throw new Error(`hooks.json: hooks[${idx}].customizeHints must be an array`);
    }
    for (const hint of h.customizeHints) {
      if (typeof hint !== "string" || hint.length === 0 || hint.length > 200) {
        throw new Error(
          `hooks.json: hooks[${idx}].customizeHints entries must be non-empty strings ≤200 chars`,
        );
      }
    }
  }
}

/**
 * Pure, idempotent settings merge. Deep-clones input, dedupes by two
 * checks in priority order:
 *
 *   1. sentinel `_marker` field — primary key. Survives path drift, lets
 *      a future uninstall command find our entries unambiguously.
 *   2. command-string equality — secondary, catches the case where the
 *      user (or another tool) already added an equivalent entry by hand
 *      and never wrote our marker. Without this fallback we would happily
 *      append a duplicate next to it and the hook would fire twice.
 *
 * Throws if `settings.hooks[event]` exists but is not an array — that
 * means the user has hand-edited their settings into a shape we do not
 * recognize, and silently replacing it with an empty array would lose
 * data. Callers should catch and surface the error to the user.
 */
export function addHookToSettings(
  settings: SettingsFile,
  event: string,
  command: string,
  marker: string,
): { settings: SettingsFile; mutated: boolean } {
  const next: SettingsFile = JSON.parse(JSON.stringify(settings ?? {}));
  if (next.hooks !== undefined && (typeof next.hooks !== "object" || Array.isArray(next.hooks))) {
    throw new Error(
      `settings.hooks exists but is not an object; refusing to clobber it`,
    );
  }
  if (!next.hooks) next.hooks = {};

  const existing = next.hooks[event];
  if (existing !== undefined && !Array.isArray(existing)) {
    throw new Error(
      `settings.hooks.${event} exists but is not an array; refusing to clobber it`,
    );
  }
  const list: SettingsHookGroup[] = (existing as SettingsHookGroup[] | undefined) ?? [];

  for (const group of list) {
    if (!group?.hooks || !Array.isArray(group.hooks)) continue;
    for (const action of group.hooks) {
      if (!action) continue;
      if (action._marker === marker) {
        next.hooks[event] = list;
        return { settings: next, mutated: false };
      }
      if (action.type === "command" && action.command === command) {
        // A pre-existing entry (manual or from another tool) already
        // points at the same command. Coexist with it; do not add a
        // duplicate. We deliberately do NOT stamp our marker onto someone
        // else's entry — that would silently take ownership of it.
        next.hooks[event] = list;
        return { settings: next, mutated: false };
      }
    }
  }

  list.push({
    hooks: [{ type: "command", command, _marker: marker }],
  });
  next.hooks[event] = list;
  return { settings: next, mutated: true };
}

/**
 * Pure inverse of addHookToSettings: removes every action carrying
 * `_marker` from every event in the settings tree. Returns the mutated
 * copy and the count of actions removed. If a group becomes empty after
 * removal, the whole group is dropped; if an event becomes empty, the
 * event key is dropped.
 */
export function removeHookFromSettings(
  settings: SettingsFile,
  marker: string,
): { settings: SettingsFile; removed: number } {
  const next: SettingsFile = JSON.parse(JSON.stringify(settings ?? {}));
  if (!next.hooks || typeof next.hooks !== "object" || Array.isArray(next.hooks)) {
    return { settings: next, removed: 0 };
  }

  let removed = 0;
  for (const event of Object.keys(next.hooks)) {
    const list = next.hooks[event];
    if (!Array.isArray(list)) continue;
    const newGroups: SettingsHookGroup[] = [];
    for (const group of list) {
      if (!group?.hooks || !Array.isArray(group.hooks)) {
        newGroups.push(group);
        continue;
      }
      const remainingActions = group.hooks.filter((action) => {
        if (action && action._marker === marker) {
          removed++;
          return false;
        }
        return true;
      });
      if (remainingActions.length > 0) {
        newGroups.push({ ...group, hooks: remainingActions });
      }
    }
    if (newGroups.length > 0) {
      next.hooks[event] = newGroups;
    } else {
      delete next.hooks[event];
    }
  }
  return { settings: next, removed };
}

type Scope = "project-local" | "project" | "user";

interface ScopeResolved {
  scope: Scope;
  hookDir: string;
  settingsPath: string;
  commandHookDir: string;
}

const settingsBackedUp = new Set<string>();

function resolveScope(scope: Scope, projectBase: string, hookName: string): ScopeResolved {
  if (scope === "user") {
    const home = os.homedir();
    const dir = path.join(home, ".claude", "hooks", hookName);
    return {
      scope,
      hookDir: dir,
      settingsPath: path.join(home, ".claude", "settings.json"),
      commandHookDir: dir,
    };
  }
  const projectClaude = path.join(projectBase, ".claude");
  return {
    scope,
    hookDir: path.join(projectClaude, "hooks", hookName),
    settingsPath:
      scope === "project-local"
        ? path.join(projectClaude, "settings.local.json")
        : path.join(projectClaude, "settings.json"),
    commandHookDir: `$CLAUDE_PROJECT_DIR/.claude/hooks/${hookName}`,
  };
}

function scopeChoices(): { name: string; value: Scope }[] {
  return [
    {
      name: "Project local — files in ./.claude/hooks/, settings in ./.claude/settings.local.json (per-developer, not committed)",
      value: "project-local",
    },
    {
      name: "Project — files in ./.claude/hooks/, settings in ./.claude/settings.json (committed, shared with team)",
      value: "project",
    },
    {
      name: "User — files in ~/.claude/hooks/, settings in ~/.claude/settings.json (global, all your projects)",
      value: "user",
    },
  ];
}

function depReady(dep: HookDep): boolean {
  try {
    exec(`which ${dep.name}`);
    return true;
  } catch {
    return false;
  }
}

function brewAvailable(): boolean {
  try {
    exec("which brew");
    return true;
  } catch {
    return false;
  }
}

function installDep(dep: HookDep): boolean {
  // Defense-in-depth: the registry validator already enforced this regex,
  // but re-check here so a future code path that constructs a HookDep
  // outside the validator still can't shell-inject through this function.
  if (!DEP_NAME_RE.test(dep.name)) {
    log.error(`refusing to install dep with unsafe name: ${JSON.stringify(dep.name)}`);
    return false;
  }
  console.log(`  Installing ${dep.name} via Homebrew (may prompt for password)...`);
  // argv form, NOT shell-interpolated — registry compromise can't escape into a shell command.
  const result = spawnSync("brew", ["install", dep.name], { stdio: "inherit" });
  return result.status === 0;
}

/**
 * Pre-flight: ensure all deps are present (or gracefully degraded) before
 * touching any files. Returns false to hard-abort the hook install.
 */
function preflightDeps(hook: HookDef): boolean {
  for (const dep of hook.deps ?? []) {
    if (depReady(dep)) {
      log.ok(`${dep.name} ready`);
      continue;
    }
    if (dep.via === "brew") {
      if (brewAvailable()) {
        if (installDep(dep)) {
          log.ok(`${dep.name} installed`);
          continue;
        }
        if (dep.optional) {
          log.warn(`${dep.name} install failed; runtime fallback will be used`);
          continue;
        }
        log.error(`${dep.name} install failed (required); aborting`);
        return false;
      }
      if (dep.optional) {
        log.warn(
          `Homebrew not found; ${dep.name} will be skipped. Runtime fallback will be used (no brand icon). Install brew at https://brew.sh and re-run for full features.`,
        );
        continue;
      }
      log.error(
        `Homebrew not found and ${dep.name} is required. Install brew at https://brew.sh, then re-run.`,
      );
      return false;
    }
  }
  return true;
}

/**
 * Lazy-fetch a hook's payload files into `packageRoot` so they can be
 * copied from there into the user's target directory.
 *
 * IMPORTANT: in production, `packageRoot` is the temp dir created by
 * `fetchContentRoot()` (utils.ts) — not the npm package install dir.
 * Only `.claude/hooks/hooks.json` is preloaded by `CONTENT_FILES`; we
 * fetch each hook's individual files on demand here so users who pick
 * no hooks pay no network cost. In DEV mode `packageRoot` is the live
 * repo root, so the files are already on disk and we skip the fetch.
 *
 * The hook payload list is owned by `hook.files` in `hooks.json`, which
 * loadHooksConfig already validated for path-traversal safety, so each
 * `file` here is a known-good relative path.
 */
async function ensureHookFilesFetched(hook: HookDef, packageRoot: string): Promise<void> {
  if (process.env.DEV === "1") return;
  for (const file of hook.files) {
    const repoPath = path.posix.join(".claude/hooks", hook.name, file);
    const localPath = path.join(packageRoot, repoPath);
    if (fs.existsSync(localPath)) continue;
    await fetchExtraContentBinary(packageRoot, repoPath);
  }
}

function copyHookFiles(
  hook: HookDef,
  packageRoot: string,
  destDir: string,
): { written: number; preserved: number } {
  fs.mkdirSync(destDir, { recursive: true });
  const preserve = new Set(hook.preserveFiles ?? []);
  let written = 0;
  let preserved = 0;
  for (const file of hook.files) {
    const dest = path.join(destDir, file);
    if (preserve.has(file) && fs.existsSync(dest)) {
      preserved++;
      continue;
    }
    const src = path.join(packageRoot, ".claude", "hooks", hook.name, file);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
    written++;
  }
  return { written, preserved };
}

/**
 * Snapshot a settings file to `.bak` before the first mutation in this
 * session. The naive `copyFileSync(src, dst)` follows symlinks, which
 * would let a local attacker pre-symlink `settings.json.bak` at, say,
 * `~/.ssh/authorized_keys` and have us clobber the target on the next
 * install — same threat class as the tmp-file TOCTOU that
 * `atomicWriteFile` plugs. We use the same defense: read the source,
 * write to a fresh fd opened with O_CREAT|O_EXCL|O_WRONLY (refuses any
 * pre-existing path, including a symlink), then rely on the no-op-if-
 * already-backed-up-this-session guard for re-runs.
 *
 * If the .bak already exists from a previous session, leave it alone —
 * the FIRST backup is the one that captures the user's pre-auriga state,
 * which is what they care about restoring to.
 */
function backupOnce(filePath: string): void {
  if (settingsBackedUp.has(filePath)) return;
  settingsBackedUp.add(filePath);
  if (!fs.existsSync(filePath)) return;
  const bakPath = filePath + ".bak";
  if (fs.existsSync(bakPath)) return;
  const data = fs.readFileSync(filePath);
  const fd = fs.openSync(
    bakPath,
    fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY,
    0o600,
  );
  try {
    fs.writeSync(fd, data);
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Read and JSON.parse a settings file. Returns {} for missing file.
 * Throws on parse error so the caller can abort cleanly *before* any
 * file copy, instead of leaving orphan hook files in the target after a
 * mid-flight failure.
 */
function readSettings(settingsPath: string): SettingsFile {
  if (!fs.existsSync(settingsPath)) return {};
  try {
    return JSON.parse(fs.readFileSync(settingsPath, "utf8")) as SettingsFile;
  } catch (e) {
    throw new Error(
      `${settingsPath} is not valid JSON: ${(e as Error).message}`,
    );
  }
}

/**
 * Apply a hook's settingsEvents to an already-parsed settings object,
 * write the result atomically if anything changed. The caller MUST have
 * pre-validated the file via readSettings() before any file copy.
 */
function writeMergedSettings(
  resolved: ScopeResolved,
  hook: HookDef,
  parsed: SettingsFile,
): { mutated: boolean } {
  let mutated = false;
  let next = parsed;
  for (const evt of hook.settingsEvents) {
    const cmd = hook.command.replace(/\$HOOK_DIR/g, resolved.commandHookDir);
    const result = addHookToSettings(next, evt.event, cmd, hook.marker);
    if (result.mutated) mutated = true;
    next = result.settings;
  }

  if (mutated) {
    backupOnce(resolved.settingsPath);
    fs.mkdirSync(path.dirname(resolved.settingsPath), { recursive: true });
    atomicWriteFile(resolved.settingsPath, JSON.stringify(next, null, 2) + "\n");
  }
  return { mutated };
}

/**
 * Write `content` to `filePath` atomically and TOCTOU-safely.
 *
 * A predictable tmp name like `settings.json.tmp` lets a local attacker
 * pre-create that path as a symlink pointing at, say, ~/.ssh/authorized_keys
 * — the next install would then clobber the link target. Defenses: random
 * suffix so the tmp name can't be predicted, plus O_CREAT|O_EXCL so we
 * refuse to open the path at all if anything (file or symlink) exists
 * there. Restrictive 0o600 perms in case the parent directory is
 * world-writable. Final rename(2) is the atomic step.
 */
function atomicWriteFile(filePath: string, content: string): void {
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  const suffix = crypto.randomBytes(8).toString("hex");
  const tmp = path.join(dir, `.${base}.${suffix}.tmp`);
  const fd = fs.openSync(
    tmp,
    fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY,
    0o600,
  );
  try {
    fs.writeSync(fd, content);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, filePath);
}

export function loadHooksConfig(packageRoot: string): HooksConfig {
  const configPath = path.join(packageRoot, ".claude", "hooks", "hooks.json");
  const raw = JSON.parse(fs.readFileSync(configPath, "utf-8")) as { hooks?: unknown };
  if (!raw || !Array.isArray(raw.hooks)) {
    throw new Error(`${configPath} must have a "hooks" array at the top level`);
  }
  raw.hooks.forEach((h, i) => validateHookEntry(h, i));
  return raw as HooksConfig;
}

function relativeFromCwd(absPath: string): string {
  const rel = path.relative(process.cwd(), absPath);
  return rel.startsWith("..") ? absPath : rel;
}

export interface InstallHookResult {
  hook: string;
  written: number;
  preserved: number;
  scope: Scope;
  hookDir: string;
  settingsPath: string;
  settingsMutated: boolean;
  settingsError?: string;
  aborted?: string;
}

/**
 * Non-interactive single-hook install. Driven by installHooks (which
 * collects user choices via prompts) and by tools/verify-hooks.mjs (which
 * exercises the install path end-to-end without prompts).
 *
 * Failure ordering matters: deps run first (no state changes), then
 * settings is read AND parsed (still no state changes), and only after
 * parsing succeeds do we touch the filesystem to copy hook files. A
 * malformed settings file therefore aborts cleanly and leaves nothing
 * behind.
 */
export async function installHook(
  hook: HookDef,
  scope: Scope,
  projectBase: string,
  packageRoot: string,
): Promise<InstallHookResult> {
  const resolved = resolveScope(scope, projectBase, hook.name);
  const base: InstallHookResult = {
    hook: hook.name,
    written: 0,
    preserved: 0,
    scope,
    hookDir: resolved.hookDir,
    settingsPath: resolved.settingsPath,
    settingsMutated: false,
  };

  if (!preflightDeps(hook)) {
    return { ...base, aborted: "deps preflight failed" };
  }

  // Pre-validate settings BEFORE any filesystem writes. If the file is
  // malformed we abort here, before copyHookFiles, so the caller never
  // ends up with orphan hook files in the target.
  let parsedSettings: SettingsFile;
  try {
    parsedSettings = readSettings(resolved.settingsPath);
  } catch (e) {
    return { ...base, aborted: (e as Error).message };
  }

  await ensureHookFilesFetched(hook, packageRoot);
  const { written, preserved } = copyHookFiles(hook, packageRoot, resolved.hookDir);

  let mutated = false;
  let settingsError: string | undefined;
  try {
    mutated = writeMergedSettings(resolved, hook, parsedSettings).mutated;
  } catch (e) {
    settingsError = (e as Error).message;
  }

  return {
    ...base,
    written,
    preserved,
    settingsMutated: mutated,
    settingsError,
  };
}

/**
 * Scan all 3 scope settings files for a hook's marker, returning every
 * scope where the marker is currently present and is NOT the scope the
 * caller is about to install into. Used by installHooks to detect
 * cross-scope leftovers from a previous install — which would cause the
 * hook to fire multiple times if not cleaned up.
 *
 * Pure-ish: reads files but does not mutate. Silently skips files that
 * fail to parse — surfacing those errors is the install path's job.
 */
export interface StaleScope {
  scope: Scope;
  settingsPath: string;
  count: number;
}

export function findStaleScopes(
  hook: HookDef,
  currentScope: Scope,
  projectBase: string,
): StaleScope[] {
  const all: Scope[] = ["project-local", "project", "user"];
  const stale: StaleScope[] = [];
  for (const s of all) {
    if (s === currentScope) continue;
    const r = resolveScope(s, projectBase, hook.name);
    if (!fs.existsSync(r.settingsPath)) continue;
    let parsed: SettingsFile;
    try {
      parsed = JSON.parse(fs.readFileSync(r.settingsPath, "utf8")) as SettingsFile;
    } catch {
      continue;
    }
    const removed = removeHookFromSettings(parsed, hook.marker).removed;
    if (removed > 0) {
      stale.push({ scope: s, settingsPath: r.settingsPath, count: removed });
    }
  }
  return stale;
}

/**
 * Remove every action carrying `hook.marker` from the given scope's
 * settings file. Atomic write, snapshot-once .bak. Returns the count of
 * actions removed (0 if nothing matched or file did not exist).
 */
export function cleanHookFromScope(
  hook: HookDef,
  scope: Scope,
  projectBase: string,
): { removed: number; settingsPath: string } {
  const r = resolveScope(scope, projectBase, hook.name);
  if (!fs.existsSync(r.settingsPath)) {
    return { removed: 0, settingsPath: r.settingsPath };
  }
  let parsed: SettingsFile;
  try {
    parsed = JSON.parse(fs.readFileSync(r.settingsPath, "utf8")) as SettingsFile;
  } catch {
    return { removed: 0, settingsPath: r.settingsPath };
  }
  const result = removeHookFromSettings(parsed, hook.marker);
  if (result.removed > 0) {
    backupOnce(r.settingsPath);
    atomicWriteFile(r.settingsPath, JSON.stringify(result.settings, null, 2) + "\n");
  }
  return { removed: result.removed, settingsPath: r.settingsPath };
}

export async function installHooks(packageRoot: string): Promise<void> {
  const config = loadHooksConfig(packageRoot);

  const compatible = config.hooks.filter((h) =>
    h.runtimePlatforms.includes(process.platform),
  );
  if (compatible.length === 0) {
    log.warn(
      `No hooks available for your platform (${process.platform}). Skipping.`,
    );
    return;
  }

  const selected = await withEsc(
    checkbox<HookDef>({
      message: "Select hooks to install:",
      choices: compatible.map((h) => ({
        name: `${h.name} — ${h.description}`,
        value: h,
        checked: true,
      })),
    }),
  );

  if (selected.length === 0) {
    log.skip("No hooks selected");
    return;
  }

  // Lazily prompted on the first project-scoped hook, then reused. Users
  // who pick only "user" scope are never asked about a project directory.
  let projectBaseResolved: string | null = null;
  async function ensureProjectBase(): Promise<string | null> {
    if (projectBaseResolved !== null) return projectBaseResolved;
    const projectBase = await withEsc(
      input({
        message: "Hooks install target directory:",
        default: process.cwd(),
      }),
    );
    const resolvedPath = path.resolve(projectBase);
    if (!fs.existsSync(resolvedPath) || !fs.statSync(resolvedPath).isDirectory()) {
      log.error(`Not a valid directory: ${resolvedPath}`);
      return null;
    }
    projectBaseResolved = resolvedPath;
    return projectBaseResolved;
  }

  for (const hook of selected) {
    console.log(`\n· ${hook.name}`);

    // Per-hook scope is intentional (not a single upfront prompt like
    // plugins.ts / skills.ts): a future user may want personal dev tools
    // at user level and project-specific hooks at project level. The
    // single-hook case is functionally identical to a single prompt.
    const scope = await withEsc(
      select<Scope>({
        message: `Where to install the ${hook.name} hook?`,
        choices: scopeChoices(),
        default: "project-local",
      }),
    );

    // User scope mutates ~/.claude/settings.json — global, affects every
    // project on this machine. A passive select label and a one-line warn
    // both scroll past quickly. Make the user explicitly opt in to the
    // global mutation; default to "no" so a missed Enter is the safe path.
    if (scope === "user") {
      const proceed = await withEsc(
        confirm({
          message: `Modify your global ~/.claude/settings.json? This affects every project on this machine. A .bak snapshot is taken before any change.`,
          default: false,
        }),
      );
      if (!proceed) {
        log.skip(`${hook.name} skipped (user cancelled global install)`);
        continue;
      }
    }

    // Project scopes need a target directory; user scope does not.
    let projectBaseForHook = "";
    if (scope !== "user") {
      const base = await ensureProjectBase();
      if (base === null) continue;
      projectBaseForHook = base;
    }

    // Cross-scope cleanup: if this hook's marker is already present in a
    // *different* scope's settings file, leaving it there means the hook
    // will fire from both scopes. Detect, prompt, clean before installing.
    const stale = findStaleScopes(hook, scope, projectBaseForHook);
    for (const entry of stale) {
      log.warn(
        `Found existing ${hook.name} hook in ${relativeFromCwd(entry.settingsPath)} (${entry.scope} scope, ${entry.count} entr${entry.count === 1 ? "y" : "ies"})`,
      );
      const remove = await withEsc(
        confirm({
          message: `Remove the stale registration so the hook only fires once?`,
          default: true,
        }),
      );
      if (remove) {
        const cleaned = cleanHookFromScope(hook, entry.scope, projectBaseForHook);
        log.ok(`removed ${cleaned.removed} from ${relativeFromCwd(cleaned.settingsPath)}`);
      } else {
        // The user explicitly chose not to clean — make the consequence
        // visible so it isn't a silent footgun. The hook will fire from
        // BOTH scopes on every Notification event.
        log.warn(
          `${hook.name} will fire from BOTH ${entry.scope} and ${scope} on every event. Run \`auriga-cli\` again or edit ${relativeFromCwd(entry.settingsPath)} to clean it up later.`,
        );
      }
    }

    let result: InstallHookResult;
    try {
      result = await installHook(hook, scope, projectBaseForHook, packageRoot);
    } catch (e) {
      log.error(`${hook.name}: ${(e as Error).message}`);
      continue;
    }

    if (result.aborted) {
      log.error(`${hook.name} aborted: ${result.aborted}`);
      continue;
    }

    const settingsRel = relativeFromCwd(result.settingsPath);
    const dirRel = relativeFromCwd(result.hookDir);
    const summary = result.preserved > 0
      ? `${hook.name} hook installed at ${dirRel} (${result.written} written, ${result.preserved} preserved)`
      : `${hook.name} hook installed at ${dirRel}`;
    log.ok(summary);

    if (result.settingsError) {
      log.error(`${hook.name}: ${result.settingsError}`);
      log.warn(`Files were copied to ${dirRel} but settings not updated. Add the hook entry manually if you want it active.`);
    } else if (result.settingsMutated) {
      log.ok(`registered in ${settingsRel}`);
    } else {
      log.skip(`already registered in ${settingsRel}`);
    }

    // Per-hook customize tips, sourced from registry metadata so adding a
    // new hook doesn't require touching the installer. `{hookDir}` is
    // substituted with the resolved install directory.
    const hints = hook.customizeHints ?? [];
    if (hints.length > 0) {
      console.log(`  Customize ${hook.name}:`);
      for (const hint of hints) {
        console.log(`    • ${hint.replace(/\{hookDir\}/g, dirRel)}`);
      }
    } else {
      console.log(`  See ${dirRel}/README.md for customization options.`);
    }
  }
}
