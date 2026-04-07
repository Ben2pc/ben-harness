import fs from "node:fs";
import path from "node:path";
import { checkbox, select } from "@inquirer/prompts";
import { exec, log, withEsc } from "./utils.js";
import type { SkillsLock } from "./utils.js";

export async function installSkills(packageRoot: string): Promise<void> {
  const sourceLock: SkillsLock = JSON.parse(
    fs.readFileSync(path.join(packageRoot, "skills-lock.json"), "utf-8"),
  );

  const sourceEntries = Object.entries(sourceLock.skills);
  if (sourceEntries.length === 0) {
    log.warn("No skills found in skills-lock.json");
    return;
  }

  const scope = await withEsc(select({
    message: "Skills installation scope:",
    choices: [
      { name: "Project (current directory)", value: "project" as const },
      { name: "Global (user-level)", value: "global" as const },
    ],
  }));

  const selected = await withEsc(checkbox({
    message: "Select skills to install:",
    choices: sourceEntries.map(([name, entry]) => ({
      name: `${name} (${entry.source})`,
      value: name,
      checked: true,
    })),
  }));

  if (selected.length === 0) {
    log.skip("No skills selected");
    return;
  }

  const globalFlag = scope === "global" ? " -g" : "";

  for (const name of selected) {
    const entry = sourceLock.skills[name];
    console.log(`\nInstalling ${name}...`);
    try {
      exec(
        `npx skills add ${entry.source}${globalFlag} --skill ${name} --agent claude-code codex --yes`,
        { inherit: true },
      );
      log.ok(`${name}: installed`);
    } catch {
      log.error(`${name}: failed to install`);
    }
  }
}
