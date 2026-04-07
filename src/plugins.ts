import fs from "node:fs";
import path from "node:path";
import { checkbox, select } from "@inquirer/prompts";
import { exec, log } from "./utils.js";
import type { PluginsConfig, PluginDef } from "./utils.js";

function getInstalledPlugins(): Set<string> {
  try {
    const output = exec("claude plugins list");
    const installed = new Set<string>();
    for (const match of output.matchAll(/❯\s+(\S+)/g)) {
      installed.add(match[1]);
    }
    return installed;
  } catch {
    return new Set();
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

  const scope = await select({
    message: "Plugins installation scope:",
    choices: [
      { name: "User (user-level)", value: "user" as const },
      { name: "Project (current project)", value: "project" as const },
    ],
  });

  const installed = getInstalledPlugins();

  const selected = await checkbox({
    message: "Select plugins to install:",
    choices: config.plugins.map((p) => {
      const isInstalled = installed.has(p.package);
      return {
        name: isInstalled
          ? `${p.name} — ${p.description} (already installed)`
          : `${p.name} — ${p.description}`,
        value: p,
        disabled: isInstalled ? "(already installed)" : false,
        checked: !isInstalled,
      };
    }),
  });

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
