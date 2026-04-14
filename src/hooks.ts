import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { checkbox, input, select } from "@inquirer/prompts";
import {
  addHookToSettings,
  exec,
  fetchExtraContentBinary,
  log,
  withEsc,
} from "./utils.js";
import type {
  HookDef,
  HookDep,
  HooksConfig,
  SettingsFile,
} from "./utils.js";

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
  console.log(`  Installing ${dep.name} via Homebrew (may prompt for password)...`);
  try {
    exec(`brew install ${dep.name}`, { inherit: true });
    return true;
  } catch {
    return false;
  }
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

function backupOnce(filePath: string): void {
  if (settingsBackedUp.has(filePath)) return;
  if (fs.existsSync(filePath)) {
    fs.copyFileSync(filePath, filePath + ".bak");
  }
  settingsBackedUp.add(filePath);
}

function mergeHookIntoSettings(
  resolved: ScopeResolved,
  hook: HookDef,
): { ok: boolean; mutated: boolean; reason?: string } {
  let settings: SettingsFile = {};
  if (fs.existsSync(resolved.settingsPath)) {
    try {
      settings = JSON.parse(fs.readFileSync(resolved.settingsPath, "utf8")) as SettingsFile;
    } catch (e) {
      return {
        ok: false,
        mutated: false,
        reason: `${resolved.settingsPath} is not valid JSON: ${(e as Error).message}`,
      };
    }
  }

  let mutated = false;
  let next = settings;
  for (const evt of hook.settingsEvents) {
    const cmd = hook.command.replace(/\$HOOK_DIR/g, resolved.commandHookDir);
    const result = addHookToSettings(next, evt.event, cmd, hook.marker);
    if (result.mutated) mutated = true;
    next = result.settings;
  }

  if (mutated) {
    backupOnce(resolved.settingsPath);
    fs.mkdirSync(path.dirname(resolved.settingsPath), { recursive: true });
    const tmp = resolved.settingsPath + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(next, null, 2) + "\n");
    fs.renameSync(tmp, resolved.settingsPath);
  }
  return { ok: true, mutated };
}

function loadHooksConfig(packageRoot: string): HooksConfig {
  const configPath = path.join(packageRoot, ".claude", "hooks", "hooks.json");
  return JSON.parse(fs.readFileSync(configPath, "utf-8")) as HooksConfig;
}

function relativeFromCwd(absPath: string): string {
  const rel = path.relative(process.cwd(), absPath);
  return rel.startsWith("..") ? absPath : rel;
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

  const projectBase = await withEsc(
    input({
      message: "Hooks install target directory (used for project-scoped hooks):",
      default: process.cwd(),
    }),
  );
  const projectBaseResolved = path.resolve(projectBase);
  if (
    !fs.existsSync(projectBaseResolved) ||
    !fs.statSync(projectBaseResolved).isDirectory()
  ) {
    log.error(`Not a valid directory: ${projectBaseResolved}`);
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

  for (const hook of selected) {
    console.log(`\n· ${hook.name}`);

    const scope = await withEsc(
      select<Scope>({
        message: `Where to install the ${hook.name} hook?`,
        choices: scopeChoices(),
        default: "project-local",
      }),
    );
    const resolved = resolveScope(scope, projectBaseResolved, hook.name);

    if (!preflightDeps(hook)) {
      log.error(`${hook.name} aborted`);
      continue;
    }

    try {
      await ensureHookFilesFetched(hook, packageRoot);
    } catch (e) {
      log.error(`${hook.name}: failed to fetch payload: ${(e as Error).message}`);
      continue;
    }

    const { written, preserved } = copyHookFiles(hook, packageRoot, resolved.hookDir);
    const merge = mergeHookIntoSettings(resolved, hook);
    if (!merge.ok) {
      log.error(`${hook.name}: ${merge.reason}`);
      log.warn(`Files were copied to ${relativeFromCwd(resolved.hookDir)} but settings not updated. Add the hook entry manually if you want it active.`);
      continue;
    }

    const settingsRel = relativeFromCwd(resolved.settingsPath);
    const dirRel = relativeFromCwd(resolved.hookDir);
    const summary = preserved > 0
      ? `${hook.name} hook installed at ${dirRel} (${written} written, ${preserved} preserved)`
      : `${hook.name} hook installed at ${dirRel}`;
    log.ok(summary);
    if (merge.mutated) {
      log.ok(`registered in ${settingsRel}`);
    } else {
      log.skip(`already registered in ${settingsRel}`);
    }
  }

  console.log("\nCustomize:");
  console.log("  • Sound  → edit <hook-dir>/config.json  (e.g. \"sound\": \"Submarine\")");
  console.log("  • Icon   → replace <hook-dir>/icon.png with your own 512×512 PNG");
  console.log("  • Docs   → see <hook-dir>/README.md");
}
