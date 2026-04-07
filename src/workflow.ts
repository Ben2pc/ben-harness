import fs from "node:fs";
import path from "node:path";
import { input, confirm } from "@inquirer/prompts";
import { log } from "./utils.js";

export async function installWorkflow(packageRoot: string): Promise<void> {
  const targetDir = await input({
    message: "Workflow install target directory:",
    default: process.cwd(),
  });

  const resolved = path.resolve(targetDir);
  if (!fs.existsSync(resolved)) {
    log.error(`Directory does not exist: ${resolved}`);
    return;
  }

  const sourceClaude = path.join(packageRoot, "CLAUDE.md");
  const targetClaude = path.join(resolved, "CLAUDE.md");
  const targetAgents = path.join(resolved, "AGENTS.md");

  // Copy CLAUDE.md
  if (fs.existsSync(targetClaude)) {
    const overwrite = await confirm({
      message: "Target already has CLAUDE.md. Overwrite?",
      default: false,
    });
    if (!overwrite) {
      log.skip("CLAUDE.md (kept existing)");
      return;
    }
  }

  fs.copyFileSync(sourceClaude, targetClaude);
  log.ok("CLAUDE.md copied");

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
