import fs from "node:fs";
import path from "node:path";
import { checkbox, select } from "@inquirer/prompts";
import { exec, log, withEsc } from "./utils.js";
import type { PluginsConfig, PluginDef } from "./utils.js";

function getInstalledPlugins(): Map<string, string[]> {
  try {
    const output = exec("claude plugins list");
    const installed = new Map<string, string[]>();
    let currentPlugin = "";
    for (const line of output.split("\n")) {
      const pluginMatch = line.match(/❯\s+(\S+)/);
      if (pluginMatch) {
        currentPlugin = pluginMatch[1];
      }
      const scopeMatch = line.match(/Scope:\s+(\w+)/);
      if (scopeMatch && currentPlugin) {
        const scopes = installed.get(currentPlugin) || [];
        scopes.push(scopeMatch[1]);
        installed.set(currentPlugin, scopes);
      }
    }
    return installed;
  } catch {
    return new Map();
  }
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

export async function installPlugins(packageRoot: string): Promise<void> {
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

  const scope = await withEsc(select({
    message: "Plugins installation scope:",
    choices: [
      { name: "User (user-level)", value: "user" as const },
      { name: "Project (current project)", value: "project" as const },
    ],
  }));

  const installed = getInstalledPlugins();

  const selected = await withEsc(checkbox({
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
  }));

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
