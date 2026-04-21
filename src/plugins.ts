import fs from "node:fs";
import path from "node:path";
import { checkbox, select } from "@inquirer/prompts";
import { exec, log, withEsc } from "./utils.js";
import type { InstallOpts, PluginsConfig, PluginDef } from "./utils.js";

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
    log.error("'claude' CLI not found. Please install Claude Code first.");
    return;
  }

  const configPath = path.join(packageRoot, ".claude", "plugins.json");
  if (!fs.existsSync(configPath)) {
    log.warn("No .claude/plugins.json found");
    return;
  }

  const config: PluginsConfig = JSON.parse(
    fs.readFileSync(configPath, "utf-8"),
  );

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

  for (const [name, source] of marketplacesToAdd) {
    console.log(`\nAdding marketplace: ${name}...`);
    try {
      exec(`claude plugins marketplace add ${source}`, { inherit: true });
      log.ok(`Marketplace ${name} added`);
    } catch {
      log.error(`Failed to add marketplace: ${name}`);
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
    }
  }
}
