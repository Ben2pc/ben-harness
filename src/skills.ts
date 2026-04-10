import fs from "node:fs";
import path from "node:path";
import { checkbox, select } from "@inquirer/prompts";
import { exec, log, withEsc } from "./utils.js";
import type { SkillsLock } from "./utils.js";

const WORKFLOW_SKILLS = [
  "brainstorming",
  "planning-with-files",
  "playwright-cli",
  "systematic-debugging",
  "test-driven-development",
  "ui-ux-pro-max",
  "verification-before-completion",
];

const RECOMMENDED_DESCRIPTIONS: Record<string, string> = {
  "claude-code-agent": "Delegate tasks to another Claude Code CLI instance",
  "codex-agent": "Delegate tasks to Codex CLI",
};

function loadLock(packageRoot: string): SkillsLock {
  return JSON.parse(
    fs.readFileSync(path.join(packageRoot, "skills-lock.json"), "utf-8"),
  );
}

async function installSelected(
  entries: [string, { source: string }][],
  defaultChecked: boolean,
  descriptionMap?: Record<string, string>,
): Promise<void> {
  if (entries.length === 0) {
    log.warn("No skills found");
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
    choices: entries.map(([name, entry]) => {
      const desc = descriptionMap?.[name];
      const label = desc ? `${name} — ${desc}` : `${name} (${entry.source})`;
      return { name: label, value: name, checked: defaultChecked };
    }),
  }));

  if (selected.length === 0) {
    log.skip("No skills selected");
    return;
  }

  const globalFlag = scope === "global" ? " -g" : "";
  const lock = Object.fromEntries(entries);

  for (const name of selected) {
    const entry = lock[name];
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

export async function installSkills(packageRoot: string): Promise<void> {
  const lock = loadLock(packageRoot);
  const entries = Object.entries(lock.skills).filter(
    ([name]) => WORKFLOW_SKILLS.includes(name),
  );
  await installSelected(entries, true);
}

export async function installRecommendedSkills(
  packageRoot: string,
): Promise<void> {
  const lock = loadLock(packageRoot);
  const entries = Object.entries(lock.skills).filter(
    ([name]) => !WORKFLOW_SKILLS.includes(name),
  );
  await installSelected(entries, false, RECOMMENDED_DESCRIPTIONS);
}
