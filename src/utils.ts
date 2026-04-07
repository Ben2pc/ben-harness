import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

// --- Types ---

export interface SkillEntry {
  source: string;
  sourceType: string;
  computedHash: string;
}

export interface SkillsLock {
  version: number;
  skills: Record<string, SkillEntry>;
}

export interface PluginDef {
  name: string;
  package: string;
  description: string;
  marketplace?: {
    name: string;
    source: string;
  };
}

export interface PluginsConfig {
  plugins: PluginDef[];
}

// --- Package root ---

export function getPackageRoot(): string {
  const __filename = fileURLToPath(import.meta.url);
  // dist/utils.js -> package root
  return path.resolve(path.dirname(__filename), "..");
}

// --- Exec ---

export function exec(
  cmd: string,
  opts?: { cwd?: string; inherit?: boolean },
): string {
  return execSync(cmd, {
    cwd: opts?.cwd,
    stdio: opts?.inherit ? "inherit" : "pipe",
    encoding: "utf-8",
  }) as string;
}

// --- Log ---

const reset = "\x1b[0m";
const green = "\x1b[32m";
const yellow = "\x1b[33m";
const red = "\x1b[31m";
const dim = "\x1b[2m";

export const log = {
  ok: (msg: string) => console.log(`${green}\u2713${reset} ${msg}`),
  warn: (msg: string) => console.log(`${yellow}\u26a0${reset} ${msg}`),
  error: (msg: string) => console.log(`${red}\u2717${reset} ${msg}`),
  skip: (msg: string) => console.log(`${dim}  skip: ${msg}${reset}`),
};
