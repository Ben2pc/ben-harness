import fs from "node:fs";
import path from "node:path";
import { checkbox, select } from "@inquirer/prompts";
import { exec, log, withEsc } from "./utils.js";
import type { InstallOpts, PluginsConfig, PluginDef } from "./utils.js";

// Plugin names, marketplace names/sources, and plugin-package names all
// end up in `claude plugins ...` shell commands via string interpolation.
// .claude/plugins.json is fetched from raw GitHub at runtime, so every
// value must pass a conservative whitelist before composing the command.
// Without this a compromised plugins.json would execute arbitrary
// commands via shell metachar injection.
const PLUGIN_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const PLUGIN_SOURCE_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,255}$/;
const MARKETPLACE_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const PLUGIN_PACKAGE_RE = /^[A-Za-z0-9][A-Za-z0-9._@/-]{0,255}$/;

export function validatePluginsConfig(raw: unknown): asserts raw is PluginsConfig {
  if (!raw || typeof raw !== "object") {
    throw new Error("plugins.json: root must be an object");
  }
  const cfg = raw as Record<string, unknown>;
  if (!Array.isArray(cfg.plugins)) {
    throw new Error("plugins.json: .plugins must be an array");
  }
  cfg.plugins.forEach((p, i) => {
    if (!p || typeof p !== "object") {
      throw new Error(`plugins.json: plugins[${i}] must be an object`);
    }
    const plugin = p as Record<string, unknown>;
    if (typeof plugin.name !== "string" || !PLUGIN_NAME_RE.test(plugin.name)) {
      throw new Error(
        `plugins.json: plugins[${i}].name ${JSON.stringify(plugin.name)} does not match ${PLUGIN_NAME_RE}`,
      );
    }
    if (typeof plugin.package !== "string" || !PLUGIN_PACKAGE_RE.test(plugin.package)) {
      throw new Error(
        `plugins.json: plugins[${i}].package ${JSON.stringify(plugin.package)} does not match ${PLUGIN_PACKAGE_RE}`,
      );
    }
    if (plugin.marketplace !== undefined) {
      if (!plugin.marketplace || typeof plugin.marketplace !== "object") {
        throw new Error(`plugins.json: plugins[${i}].marketplace must be an object`);
      }
      const mp = plugin.marketplace as Record<string, unknown>;
      if (typeof mp.name !== "string" || !MARKETPLACE_NAME_RE.test(mp.name)) {
        throw new Error(
          `plugins.json: plugins[${i}].marketplace.name ${JSON.stringify(mp.name)} does not match ${MARKETPLACE_NAME_RE}`,
        );
      }
      if (typeof mp.source !== "string" || !PLUGIN_SOURCE_RE.test(mp.source)) {
        throw new Error(
          `plugins.json: plugins[${i}].marketplace.source ${JSON.stringify(mp.source)} does not match ${PLUGIN_SOURCE_RE}`,
        );
      }
    }
  });
}

interface PluginInfo {
  id: string;
  scope: string;
  projectPath?: string;
}

function getInstalledPlugins(): Map<string, string[]> {
  try {
    const output = exec("claude plugins list --json");
    const plugins: PluginInfo[] = JSON.parse(output);
    const cwd = process.cwd();
    const installed = new Map<string, string[]>();

    for (const p of plugins) {
      // project scope 只匹配当前目录
      if (p.scope === "project" && p.projectPath !== cwd) continue;

      const scopes = installed.get(p.id) || [];
      scopes.push(p.scope);
      installed.set(p.id, scopes);
    }

    return installed;
  } catch {
    return new Map();
  }
}

/**
 * Non-interactive selection resolver for plugins. Mirrors the skills
 * resolveSelected: `undefined` / `["*"]` = full set; explicit names =
 * filter. CLI parser validates names up-front.
 */
function resolvePluginSelection(
  all: PluginDef[],
  selected: string[] | undefined,
): PluginDef[] {
  if (!selected || (selected.length === 1 && selected[0] === "*")) return all;
  const wanted = new Set(selected);
  return all.filter((p) => wanted.has(p.name));
}

function getInstalledMarketplaces(): Set<string> {
  try {
    const output = exec("claude plugins marketplace list");
    const names = new Set<string>();
    for (const match of output.matchAll(/❯\s+(\S+)/g)) {
      names.add(match[1]);
    }
    return names;
  } catch {
    return new Set();
  }
}

export async function installPlugins(
  packageRoot: string,
  opts: InstallOpts,
): Promise<void> {
  // Check claude CLI availability
  try {
    exec("which claude");
  } catch {
    const msg = "'claude' CLI not found. Please install Claude Code first.";
    if (opts.interactive) { log.error(msg); return; }
    throw new Error(msg);
  }

  const configPath = path.join(packageRoot, ".claude", "plugins.json");
  if (!fs.existsSync(configPath)) {
    log.warn("No .claude/plugins.json found");
    return;
  }

  const raw: unknown = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  validatePluginsConfig(raw);
  const config: PluginsConfig = raw;

  if (config.plugins.length === 0) {
    log.warn("No plugins defined in plugins.json");
    return;
  }

  type Scope = "project" | "user";
  const scope: Scope = opts.interactive
    ? await withEsc(select<Scope>({
      message: "Plugins installation scope:",
      choices: [
        { name: "User (user-level)", value: "user" },
        { name: "Project (current project)", value: "project" },
      ],
    }))
    : opts.scope ?? "project";

  const installed = getInstalledPlugins();

  const selected = opts.interactive
    ? await withEsc(checkbox({
      message: "Select plugins to install:",
      choices: config.plugins.map((p) => {
        const scopes = installed.get(p.package);
        const suffix = scopes ? ` (installed: ${scopes.join(", ")})` : "";
        return {
          name: `${p.name} — ${p.description}${suffix}`,
          value: p,
          checked: !scopes || !(scopes.includes("user") && scopes.includes("project")),
        };
      }),
    }))
    : resolvePluginSelection(config.plugins, opts.selected);

  if (selected.length === 0) {
    log.skip("No plugins selected");
    return;
  }

  // Install required marketplaces
  const existingMarketplaces = getInstalledMarketplaces();
  const marketplacesToAdd = new Map<string, string>();

  for (const plugin of selected) {
    if (plugin.marketplace && !existingMarketplaces.has(plugin.marketplace.name)) {
      marketplacesToAdd.set(plugin.marketplace.name, plugin.marketplace.source);
    }
  }

  const failures: string[] = [];

  for (const [name, source] of marketplacesToAdd) {
    console.log(`\nAdding marketplace: ${name}...`);
    try {
      exec(`claude plugins marketplace add ${source}`, { inherit: true });
      log.ok(`Marketplace ${name} added`);
    } catch {
      log.error(`Failed to add marketplace: ${name}`);
      failures.push(`marketplace ${name}`);
    }
  }

  // Install plugins
  for (const plugin of selected) {
    console.log(`\nInstalling ${plugin.name}...`);
    try {
      exec(`claude plugins install ${plugin.package} --scope ${scope}`, {
        inherit: true,
      });
      log.ok(`${plugin.name} installed`);
    } catch {
      log.error(`Failed to install: ${plugin.name}`);
      failures.push(plugin.name);
    }
  }

  if (failures.length > 0 && !opts.interactive) {
    throw new Error(
      `${failures.length} plugin operation(s) failed: ${failures.join(", ")}`,
    );
  }
}
