import fs from "node:fs";
import path from "node:path";
import { input, select } from "@inquirer/prompts";
import { LANGUAGES, fetchExtraContent, log, withEsc } from "./utils.js";

export async function installWorkflow(packageRoot: string): Promise<void> {
  const lang = await withEsc(select({
    message: "CLAUDE.md language:",
    choices: LANGUAGES.map((l) => ({ name: l.label, value: l.value })),
    default: "en",
  }));

  const targetDir = await withEsc(input({
    message: "Workflow install target directory:",
    default: process.cwd(),
  }));

  const resolved = path.resolve(targetDir);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    log.error(`Not a valid directory: ${resolved}`);
    return;
  }

  const langOpt = LANGUAGES.find((l) => l.value === lang)!;

  // Lazy fetch: only download non-default language file when needed
  if (langOpt.file !== "CLAUDE.md") {
    console.log(`Fetching ${langOpt.label} template...`);
    await fetchExtraContent(packageRoot, langOpt.file);
  }

  const sourceClaude = path.join(packageRoot, langOpt.file);
  const targetClaude = path.join(resolved, "CLAUDE.md");
  const targetAgents = path.join(resolved, "AGENTS.md");

  // Copy CLAUDE.md
  if (fs.existsSync(targetClaude)) {
    const bakPath = targetClaude + ".bak";
    fs.copyFileSync(targetClaude, bakPath);
    log.warn(`Existing CLAUDE.md backed up to CLAUDE.md.bak`);
  }

  fs.copyFileSync(sourceClaude, targetClaude);
  log.ok(`CLAUDE.md copied (${langOpt.label})`);

  // Create AGENTS.md symlink
  try {
    fs.lstatSync(targetAgents);
    fs.unlinkSync(targetAgents);
  } catch {
    // does not exist, proceed
  }
  fs.symlinkSync("CLAUDE.md", targetAgents);
  log.ok("AGENTS.md -> CLAUDE.md symlink created");
}
