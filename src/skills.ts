import fs from "node:fs";
import path from "node:path";
import { checkbox, select, confirm, input } from "@inquirer/prompts";
import { exec, log } from "./utils.js";
import type { SkillsLock, SkillEntry } from "./utils.js";

export async function installSkills(packageRoot: string): Promise<void> {
  const sourceLock: SkillsLock = JSON.parse(
    fs.readFileSync(path.join(packageRoot, "skills-lock.json"), "utf-8"),
  );

  const sourceEntries = Object.entries(sourceLock.skills);
  if (sourceEntries.length === 0) {
    log.warn("No skills found in skills-lock.json");
    return;
  }

  const scope = await select({
    message: "Skills installation scope:",
    choices: [
      { name: "Project (current directory)", value: "project" as const },
      { name: "Global (user-level)", value: "global" as const },
    ],
  });

  const selected = await checkbox({
    message: "Select skills to install:",
    choices: sourceEntries.map(([name, entry]) => ({
      name: `${name} (${entry.source})`,
      value: name,
      checked: true,
    })),
  });

  if (selected.length === 0) {
    log.skip("No skills selected");
    return;
  }

  if (scope === "project") {
    await installProjectSkills(packageRoot, sourceLock, selected);
  } else {
    await installGlobalSkills(sourceLock, selected);
  }
}

async function installProjectSkills(
  packageRoot: string,
  sourceLock: SkillsLock,
  selected: string[],
): Promise<void> {
  const targetDir = await input({
    message: "Skills target directory:",
    default: process.cwd(),
  });

  const resolved = path.resolve(targetDir);
  const targetLockPath = path.join(resolved, "skills-lock.json");

  // Read existing or create empty
  let targetLock: SkillsLock = { version: 1, skills: {} };
  if (fs.existsSync(targetLockPath)) {
    targetLock = JSON.parse(fs.readFileSync(targetLockPath, "utf-8"));
  }

  let changed = false;

  for (const name of selected) {
    const sourceEntry = sourceLock.skills[name];
    const targetEntry = targetLock.skills[name];

    if (!targetEntry) {
      // New skill
      targetLock.skills[name] = sourceEntry;
      changed = true;
      log.ok(`${name}: added`);
    } else if (targetEntry.computedHash === sourceEntry.computedHash) {
      // Same version
      log.skip(`${name} (up to date)`);
    } else {
      // Different hash — prompt update
      const update = await confirm({
        message: `${name}: hash differs. Update?`,
        default: true,
      });
      if (update) {
        targetLock.skills[name] = sourceEntry;
        changed = true;
        log.ok(`${name}: updated`);
      } else {
        log.skip(`${name} (kept existing)`);
      }
    }
  }

  if (changed) {
    fs.writeFileSync(targetLockPath, JSON.stringify(targetLock, null, 2) + "\n");
    log.ok("skills-lock.json merged");
  }

  console.log("\nRunning npx skills experimental_install...\n");
  exec("npx skills experimental_install", { cwd: resolved, inherit: true });
  log.ok("Skills installed");
}

async function installGlobalSkills(
  sourceLock: SkillsLock,
  selected: string[],
): Promise<void> {
  for (const name of selected) {
    const entry = sourceLock.skills[name];
    console.log(`\nInstalling ${name} globally...`);
    try {
      exec(
        `npx skills add ${entry.source} -g --skill ${name} --yes`,
        { inherit: true },
      );
      log.ok(`${name}: installed globally`);
    } catch {
      log.error(`${name}: failed to install`);
    }
  }
}
