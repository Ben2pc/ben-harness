import fs from "node:fs";
import path from "node:path";
import { checkbox, select } from "@inquirer/prompts";
import { exec, log, withEsc } from "./utils.js";
import type { InstallOpts, SkillEntry, SkillsLock } from "./utils.js";

// Curated default-on set: skills that the workflow in the root CLAUDE.md
// directly references. Anything else in skills-lock.json is surfaced via
// installRecommendedSkills as an opt-in utility.
const WORKFLOW_SKILLS = [
  "brainstorming",
  "deep-review",
  "parallel-implementation",
  "planning-with-files",
  "playwright-cli",
  "systematic-debugging",
  "test-designer",
  "test-driven-development",
  "ui-ux-pro-max",
  "verification-before-completion",
];

function loadLock(packageRoot: string): SkillsLock {
  return JSON.parse(
    fs.readFileSync(path.join(packageRoot, "skills-lock.json"), "utf-8"),
  );
}

// Deterministic: selection order is preserved; the first occurrence of
// each source fixes its position in the returned array.
export function planSkillInstallCommands(
  selected: string[],
  lock: SkillsLock["skills"],
  globalFlag: string,
): { source: string; skills: string[]; command: string }[] {
  const bySource = new Map<string, string[]>();
  for (const name of selected) {
    const entry = lock[name];
    if (!entry) continue;
    const bucket = bySource.get(entry.source);
    if (bucket) bucket.push(name);
    else bySource.set(entry.source, [name]);
  }

  return [...bySource].map(([source, skills]) => ({
    source,
    skills,
    command: `npx -y skills add ${source}${globalFlag} --skill ${skills.join(" ")} --agent claude-code codex --yes`,
  }));
}

async function installSelected(
  entries: [string, SkillEntry][],
  defaultChecked: boolean,
  opts: InstallOpts,
): Promise<void> {
  if (entries.length === 0) {
    log.warn("No skills found");
    return;
  }

  // scope mapping: spec §5.5 — outer `user` → internal `global`.
  type Scope = "project" | "global";
  const scope: Scope = opts.interactive
    ? await withEsc(select<Scope>({
      message: "Skills installation scope:",
      choices: [
        { name: "Project (current directory)", value: "project" },
        { name: "Global (user-level)", value: "global" },
      ],
    }))
    : opts.scope === "user" ? "global" : "project";

  const availableNames = entries.map(([name]) => name);
  const selected = opts.interactive
    ? await withEsc(checkbox({
      message: "Select skills to install:",
      choices: entries.map(([name, entry]) => ({
        name: `${name} (${entry.source})`,
        value: name,
        checked: defaultChecked,
      })),
    }))
    : resolveSelected(opts.selected, availableNames);

  if (selected.length === 0) {
    log.skip("No skills selected");
    return;
  }

  const globalFlag = scope === "global" ? " -g" : "";
  const lock = Object.fromEntries(entries);
  const batches = planSkillInstallCommands(selected, lock, globalFlag);

  for (const batch of batches) {
    console.log(`\nInstalling ${batch.skills.join(", ")} from ${batch.source}...`);
    try {
      exec(batch.command, { inherit: true });
      for (const name of batch.skills) log.ok(`${name}: installed`);
    } catch {
      log.error(`${batch.source}: failed to install (${batch.skills.join(", ")})`);
    }
  }
}

/**
 * Resolves the non-interactive `opts.selected` filter against the set
 * of names available in the current category. Semantics match spec
 * §3.2: `undefined` = all; `["*"]` = all; any other list = that list.
 * The CLI parser is responsible for rejecting unknown names up-front
 * (so installers can trust the list).
 */
function resolveSelected(
  selected: string[] | undefined,
  available: string[],
): string[] {
  if (!selected || (selected.length === 1 && selected[0] === "*")) {
    return available;
  }
  return selected;
}

export async function installSkills(
  packageRoot: string,
  opts: InstallOpts,
): Promise<void> {
  const lock = loadLock(packageRoot);
  const entries = Object.entries(lock.skills).filter(
    ([name]) => WORKFLOW_SKILLS.includes(name),
  );
  await installSelected(entries, true, opts);
}

export async function installRecommendedSkills(
  packageRoot: string,
  opts: InstallOpts,
): Promise<void> {
  const lock = loadLock(packageRoot);
  const entries = Object.entries(lock.skills).filter(
    ([name]) => !WORKFLOW_SKILLS.includes(name),
  );
  await installSelected(entries, false, opts);
}
