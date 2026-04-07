#!/usr/bin/env node

import { checkbox } from "@inquirer/prompts";
import { fetchContentRoot, withEsc } from "./utils.js";
import { installWorkflow } from "./workflow.js";
import { installSkills } from "./skills.js";
import { installPlugins } from "./plugins.js";

async function main(): Promise<void> {
  console.log("\nben-harness — Claude Code Harness Installer\n");

  console.log("Fetching latest content from GitHub...");
  const packageRoot = await fetchContentRoot();
  console.log("");

  const moduleTypes = await withEsc(checkbox({
    message: "Select module types to install:",
    choices: [
      {
        name: "Workflow — CLAUDE.md + AGENTS.md",
        value: "workflow" as const,
        checked: true,
      },
      {
        name: "Skills — Development process skills (brainstorming, TDD, debugging...)",
        value: "skills" as const,
        checked: true,
      },
      {
        name: "Plugins — Claude Code plugins (skill-creator, hookify, codex...)",
        value: "plugins" as const,
        checked: true,
      },
    ],
  }));

  if (moduleTypes.length === 0) {
    console.log("Nothing selected. Bye!");
    return;
  }

  if (moduleTypes.includes("workflow")) {
    console.log("\n--- Workflow ---\n");
    await installWorkflow(packageRoot);
  }

  if (moduleTypes.includes("skills")) {
    console.log("\n--- Skills ---\n");
    await installSkills(packageRoot);
  }

  if (moduleTypes.includes("plugins")) {
    console.log("\n--- Plugins ---\n");
    await installPlugins(packageRoot);
  }

  console.log("\n\u2728 Installation complete!\n");
}

main().catch((err) => {
  if (
    err instanceof Error &&
    ["ExitPromptError", "CancelPromptError"].includes(err.name)
  ) {
    console.log("\nCancelled.");
    process.exit(0);
  }
  console.error(err);
  process.exit(1);
});
