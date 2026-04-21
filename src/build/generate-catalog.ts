import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";

import type { Catalog, CatalogEntry } from "../catalog.js";
import type { PluginsConfig, SkillsLock } from "../utils.js";
import { WORKFLOW_SKILLS as WORKFLOW_SKILL_LIST } from "../skills.js";

const WORKFLOW_SKILLS = new Set(WORKFLOW_SKILL_LIST);

interface HookEntry {
  name: string;
  description: string;
  defaultOn?: boolean;
}

interface HooksConfig {
  hooks: HookEntry[];
}

/**
 * English `--help` summaries for skills whose authoritative upstream
 * SKILL.md is non-English. The SKILL.md still drives runtime behavior;
 * this override only affects the one-line entry in `--help` so CI /
 * English-speaking Agents get a consistent reading experience.
 * Keep summaries ≤140 chars so the truncated help column stays tidy.
 */
const CATALOG_OVERRIDES: Record<string, string> = {
  "claude-code-agent":
    "Delegate coding, review, diagnosis, planning, and structured-output tasks to an independent Claude Code session via `claude -p` (Agent SDK).",
  "codex-agent":
    "Delegate coding, review, diagnosis, planning, and browser tasks to an independent Codex session via `codex exec` / resume / review.",
};

function readSkillDescription(repoRoot: string, name: string): string {
  const override = CATALOG_OVERRIDES[name];
  if (override) return override;
  const skillMd = path.join(repoRoot, ".agents", "skills", name, "SKILL.md");
  if (!fs.existsSync(skillMd)) {
    throw new Error(`generate-catalog: SKILL.md not found for '${name}' at ${skillMd}`);
  }
  const { data } = matter(fs.readFileSync(skillMd, "utf-8"));
  const desc = data.description;
  if (typeof desc !== "string" || desc.length === 0) {
    throw new Error(
      `generate-catalog: '${name}' has missing or non-string description frontmatter`,
    );
  }
  return desc;
}

export function generateCatalog(repoRoot: string): Catalog {
  const lockPath = path.join(repoRoot, "skills-lock.json");
  const lock = JSON.parse(fs.readFileSync(lockPath, "utf-8")) as SkillsLock;

  const workflowSkills: CatalogEntry[] = [];
  const recommendedSkills: CatalogEntry[] = [];
  for (const name of Object.keys(lock.skills).sort()) {
    const entry: CatalogEntry = { name, description: readSkillDescription(repoRoot, name) };
    if (WORKFLOW_SKILLS.has(name)) workflowSkills.push(entry);
    else recommendedSkills.push(entry);
  }

  const pluginsPath = path.join(repoRoot, ".claude", "plugins.json");
  const pluginsCfg = JSON.parse(fs.readFileSync(pluginsPath, "utf-8")) as PluginsConfig;
  const plugins: CatalogEntry[] = pluginsCfg.plugins.map((p) => ({
    name: p.name,
    description: p.description,
  }));

  const hooksPath = path.join(repoRoot, ".claude", "hooks", "hooks.json");
  const hooksCfg = JSON.parse(fs.readFileSync(hooksPath, "utf-8")) as HooksConfig;
  const hooks: CatalogEntry[] = hooksCfg.hooks.map((h) => ({
    name: h.name,
    description: h.defaultOn === false ? `(opt-in) ${h.description}` : h.description,
  }));

  return {
    generatedAt: new Date().toISOString(),
    workflowSkills,
    recommendedSkills,
    plugins,
    hooks,
  };
}

function main(): void {
  const here = path.dirname(new URL(import.meta.url).pathname);
  // Script lives at dist/build/generate-catalog.js; repo root is two levels up.
  const repoRoot = path.resolve(here, "..", "..");
  const catalog = generateCatalog(repoRoot);
  const outPath = path.join(repoRoot, "dist", "catalog.json");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(catalog, null, 2) + "\n");
  console.log(
    `✓ catalog.json: ${catalog.workflowSkills.length} workflow / ${catalog.recommendedSkills.length} recommended / ${catalog.plugins.length} plugins / ${catalog.hooks.length} hooks`,
  );
}

// Execute when invoked as a script (not when imported by tests).
// Compare resolved paths so symlinks don't break the guard.
const invokedAsScript =
  process.argv[1] &&
  fs.realpathSync(process.argv[1]) === fs.realpathSync(new URL(import.meta.url).pathname);

if (invokedAsScript) {
  main();
}
