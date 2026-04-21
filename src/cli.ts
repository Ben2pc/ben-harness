#!/usr/bin/env node

import { createRequire } from "node:module";
import { checkbox } from "@inquirer/prompts";
import { fetchContentRoot, printBanner, withEsc } from "./utils.js";
import { installWorkflow } from "./workflow.js";
import { installSkills, installRecommendedSkills } from "./skills.js";
import { installPlugins } from "./plugins.js";
import { installHooks } from "./hooks.js";

const require = createRequire(import.meta.url);
const { version } = require("../package.json");

async function main(): Promise<void> {
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
        name: "Recommended Skills — Extra utility skills (claude-code-agent, codex-agent...)",
        value: "recommended" as const,
        checked: true,
      },
      {
        name: "Plugins — Claude Code plugins (skill-creator, claude-md-management, codex...)",
        value: "plugins" as const,
        checked: true,
      },
      {
        name: "Hooks — Claude Code hooks (notifications, etc.)",
        value: "hooks" as const,
        checked: true,
      },
    ],
  }));

  if (moduleTypes.length === 0) {
    console.log("Nothing selected. Bye!");
    return;
  }

  const interactiveOpts = { interactive: true as const };

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
