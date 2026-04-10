import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
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

// --- Skill categories ---

export const WORKFLOW_SKILLS = [
  "brainstorming",
  "planning-with-files",
  "playwright-cli",
  "systematic-debugging",
  "test-driven-development",
  "ui-ux-pro-max",
  "verification-before-completion",
];

export const RECOMMENDED_DESCRIPTIONS: Record<string, string> = {
  "claude-code-agent": "Delegate tasks to another Claude Code CLI instance",
  "codex-agent": "Delegate tasks to Codex CLI",
};

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

// --- Language config ---

export interface LangOption {
  value: string;
  label: string;
  file: string;
}

export const LANGUAGES: LangOption[] = [
  { value: "en", label: "English", file: "CLAUDE.md" },
  { value: "zh-CN", label: "中文", file: "CLAUDE.zh-CN.md" },
];

// --- Remote content ---

const REPO = "Ben2pc/ben-harness";
const BRANCH = "main";
const CONTENT_FILES = [
  "CLAUDE.md",
  "skills-lock.json",
  ".claude/plugins.json",
];

async function fetchFile(file: string): Promise<string> {
  const url = `https://raw.githubusercontent.com/${REPO}/${BRANCH}/${file}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  return res.text();
}

export async function fetchContentRoot(): Promise<string> {
  if (process.env.DEV) {
    return getPackageRoot();
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ben-harness-"));

  for (const file of CONTENT_FILES) {
    const content = await fetchFile(file);
    const dest = path.join(tmpDir, file);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, content);
  }

  return tmpDir;
}

export async function fetchExtraContent(
  tmpDir: string,
  file: string,
): Promise<void> {
  const content = await fetchFile(file);
  const dest = path.join(tmpDir, file);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, content);
}

// --- ESC support ---

export function withEsc<T>(
  prompt: Promise<T> & { cancel?: () => void },
): Promise<T> {
  const onKeypress = (_: unknown, key: { name: string }) => {
    if (key.name === "escape") {
      prompt.cancel?.();
    }
  };
  process.stdin.on("keypress", onKeypress);
  return prompt.finally(() => {
    process.stdin.removeListener("keypress", onKeypress);
  });
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
