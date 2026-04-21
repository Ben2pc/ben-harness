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

// --- Install options (spec §5.3) ---

/**
 * Shared install function argument shape. Each installer consumes the
 * subset of fields meaningful to its category; irrelevant fields are
 * ignored (e.g. `lang` / `cwd` only apply to workflow).
 *
 * `interactive` is required (no default) to force callers to be
 * explicit — silently falling back to prompts in a piped Agent session
 * was the original bug this spec closes.
 */
export interface InstallOpts {
  /** workflow only — language code from `LANGUAGES`. */
  lang?: string;
  /** workflow only — install target directory (absolute or cwd-relative). */
  cwd?: string;
  /** skills / recommended / plugins — `"user"` means install globally. */
  scope?: "project" | "user";
  /**
   * sub-item filter. `undefined` = full set of this category.
   * Names are validated against the catalog by the CLI layer; installers
   * take the list as authoritative.
   */
  selected?: string[];
  /** `true` = drive via inquirer prompts (existing interactive UX);
   *  `false` = non-interactive, use only the fields above. */
  interactive: boolean;
}

/**
 * Whether the current process should be treated as non-interactive.
 * Used by the top-level CLI dispatcher to pick the interactive vs
 * non-interactive code path when only the verb was supplied with no
 * positional types / flags.
 */
export function isNonInteractive(): boolean {
  return !process.stdin.isTTY;
}

// --- Package root ---

// Walks up from the current module file until it finds the auriga-cli
// package.json. Handles both `dist/utils.js` (production) and
// `dist-test/src/utils.js` (test compile output) uniformly — a plain
// `path.resolve(..., "..")` works for the first but not the second.
export function getPackageRoot(): string {
  const __filename = fileURLToPath(import.meta.url);
  let dir = path.dirname(__filename);
  while (dir !== path.dirname(dir)) {
    const pkgPath = path.join(dir, "package.json");
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
        if (pkg.name === "auriga-cli") return dir;
      } catch { /* malformed parent package.json — keep walking */ }
    }
    dir = path.dirname(dir);
  }
  return process.cwd();
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

const REPO = "Ben2pc/auriga-cli";
const BRANCH = "main";
const CONTENT_FILES = [
  "CLAUDE.md",
  "skills-lock.json",
  ".claude/plugins.json",
  ".claude/hooks/hooks.json",
];

async function fetchFile(file: string): Promise<string> {
  const url = `https://raw.githubusercontent.com/${REPO}/${BRANCH}/${file}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  return res.text();
}

async function fetchFileBinary(file: string): Promise<Buffer> {
  const url = `https://raw.githubusercontent.com/${REPO}/${BRANCH}/${file}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

export async function fetchContentRoot(): Promise<string> {
  if (process.env.DEV === "1") {
    return getPackageRoot();
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "auriga-cli-"));

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

export async function fetchExtraContentBinary(
  tmpDir: string,
  file: string,
): Promise<void> {
  const buf = await fetchFileBinary(file);
  const dest = path.join(tmpDir, file);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, buf);
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

// --- ANSI ---

const reset = "\x1b[0m";
const green = "\x1b[32m";
const yellow = "\x1b[33m";
const red = "\x1b[31m";
const dim = "\x1b[2m";

// --- Banner ---

const ORIGINAL_ART = [
  "  ▄▀█ █ █ █▀█ █ █▀▀ ▄▀█",
  "  █▀█ █▄█ █▀▄ █ █▄█ █▀█",
];

// Winter Sky: #2C3E6B (靛蓝) → #5B7EA1 (钢蓝) → #D4A84B (暖金)
const GRADIENT_STOPS: [number, number, number][] = [
  [0x2C, 0x3E, 0x6B],
  [0x5B, 0x7E, 0xA1],
  [0xD4, 0xA8, 0x4B],
];
const SHADOW_COLOR = "\x1b[38;5;238m";
const SHADOW_DX = 1;
const SHADOW_DY = 1;
const SCALE = 2;

function decodeBanner(lines: string[]): number[][] {
  const width = Math.max(...lines.map((l) => l.length));
  const pixels: number[][] = [];
  for (const line of lines) {
    const topRow: number[] = [];
    const botRow: number[] = [];
    for (let i = 0; i < width; i++) {
      const ch = line[i] || " ";
      if (ch === "█") { topRow.push(1); botRow.push(1); }
      else if (ch === "▀") { topRow.push(1); botRow.push(0); }
      else if (ch === "▄") { topRow.push(0); botRow.push(1); }
      else { topRow.push(0); botRow.push(0); }
    }
    pixels.push(topRow, botRow);
  }
  return pixels;
}

function scaleBanner(pixels: number[][], n: number): number[][] {
  const result: number[][] = [];
  for (const row of pixels) {
    const scaledRow = row.flatMap((px) => Array(n).fill(px) as number[]);
    for (let i = 0; i < n; i++) result.push([...scaledRow]);
  }
  return result;
}

function renderBannerWithShadow(pixels: number[][], dx: number, dy: number): string {
  const h = pixels.length;
  const w = pixels[0].length;
  // Build composite: 1=main, 2=shadow, 0=empty
  const comp: number[][] = pixels.map((r) => [...r]);
  for (let i = 0; i < dy; i++) comp.push(new Array(w + dx).fill(0));
  for (const row of comp) while (row.length < w + dx) row.push(0);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (pixels[y][x] === 1) {
        const sy = y + dy, sx = x + dx;
        if (sy < comp.length && sx < comp[0].length && comp[sy][sx] === 0) {
          comp[sy][sx] = 2;
        }
      }
    }
  }
  // Render with per-character coloring
  const totalW = comp[0].length;
  const lines: string[] = [];
  for (let y = 0; y < comp.length; y += 2) {
    const top = comp[y];
    const bot = y + 1 < comp.length ? comp[y + 1] : new Array(totalW).fill(0);
    let line = "";
    for (let x = 0; x < totalW; x++) {
      const t = top[x], b = bot[x];
      const tFill = t > 0, bFill = b > 0;
      let ch: string;
      if (tFill && bFill) ch = "█";
      else if (tFill && !bFill) ch = "▀";
      else if (!tFill && bFill) ch = "▄";
      else ch = " ";
      if (ch === " ") { line += " "; continue; }
      if (t === 1 || b === 1) {
        const ratio = totalW <= 1 ? 0 : x / (totalW - 1);
        const seg = ratio < 0.5 ? 0 : 1;
        const localT = seg === 0 ? ratio * 2 : (ratio - 0.5) * 2;
        const from = GRADIENT_STOPS[seg], to = GRADIENT_STOPS[seg + 1];
        const r = Math.round(from[0] + localT * (to[0] - from[0]));
        const g = Math.round(from[1] + localT * (to[1] - from[1]));
        const bv = Math.round(from[2] + localT * (to[2] - from[2]));
        line += `\x1b[38;2;${r};${g};${bv}m${ch}${reset}`;
      } else {
        line += `${SHADOW_COLOR}${ch}${reset}`;
      }
    }
    lines.push(line);
  }
  return lines.join("\n");
}

function renderBannerPlain(pixels: number[][]): string {
  const lines: string[] = [];
  for (let y = 0; y < pixels.length; y += 2) {
    const top = pixels[y];
    const bot = y + 1 < pixels.length ? pixels[y + 1] : top.map(() => 0);
    let line = "";
    for (let x = 0; x < top.length; x++) {
      const t = top[x], b = bot[x];
      if (t && b) line += "█";
      else if (t && !b) line += "▀";
      else if (!t && b) line += "▄";
      else line += " ";
    }
    lines.push(line);
  }
  return lines.join("\n");
}

export function printBanner(version: string): void {
  const noColor = process.env.NO_COLOR !== undefined;
  const pixels = scaleBanner(decodeBanner(ORIGINAL_ART), SCALE);
  const art = noColor
    ? renderBannerPlain(pixels)
    : renderBannerWithShadow(pixels, SHADOW_DX, SHADOW_DY);
  const subtitle = noColor
    ? `  Claude Code Harness Installer  v${version}`
    : `${dim}  Claude Code Harness Installer  v${version}${reset}`;
  console.log("");
  console.log(art);
  console.log(subtitle);
}

// --- Log ---

export const log = {
  ok: (msg: string) => console.log(`${green}\u2713${reset} ${msg}`),
  // warn / error go to stderr so shell redirection (and non-interactive
  // agents) can separate diagnostics from normal CLI output. Earlier
  // both wrote to stdout via console.log, which collapsed the two
  // streams and forced callers to re-parse mixed output.
  warn: (msg: string) => console.error(`${yellow}\u26a0${reset} ${msg}`),
  error: (msg: string) => console.error(`${red}\u2717${reset} ${msg}`),
  skip: (msg: string) => console.log(`${dim}  skip: ${msg}${reset}`),
};
