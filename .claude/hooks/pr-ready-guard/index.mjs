#!/usr/bin/env node
// pr-ready-guard — PreToolUse hook for `gh pr ready`.
//
// Block only on structural signals that can't be reasonably debated:
//   B1  unpushed commits on the current branch
//   B2  stray planning docs at repo root (findings/progress/task_plan)
//   B3  stray spec docs under docs/superpowers/specs/
//
// Everything else is filter-only: we fetch the real PR body (best-effort
// via gh pr view), list ^## / ^### headings, count TODO checkboxes, and
// inject it as additionalContext for the Agent. No text-regex of body
// content is ever used as a block signal.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => (input += c));
process.stdin.on("end", () => {
  try {
    const data = JSON.parse(input);
    if (data?.tool_name !== "Bash") return exit0();

    const cmd = data?.tool_input?.command;
    if (typeof cmd !== "string") return exit0();
    // Strip simple quoted runs so mentions of "gh pr ready" inside
    // echo args, git commit messages, etc. don't trigger the hook.
    if (!/\bgh\s+pr\s+ready\b/.test(stripQuoted(cmd))) return exit0();

    // Block checks run in a fixed order so the reason the Agent sees
    // is the first unambiguous structural problem, not a grab-bag.

    // B2/B3: stray planning artifacts (repo-root files + spec glob).
    const stray = findStrayDocs();
    if (stray.root.length > 0 || stray.specs.length > 0) {
      const parts = [];
      if (stray.root.length > 0) {
        parts.push(
          `stray planning docs at repo root: [${stray.root.join(", ")}]`,
        );
      }
      if (stray.specs.length > 0) {
        parts.push(`stray spec docs: [${stray.specs.join(", ")}]`);
      }
      return block(
        `${parts.join("; ")}. Archive to docs/worklog-<YYYY-MM-DD>-<branch>/ or delete before marking ready.`,
      );
    }

    // B1: unpushed commits. Requires a valid git dir; if git exits with
    // any error we assume the branch isn't tracking a remote yet and
    // skip this check (a brand-new unpushed branch with no upstream
    // would fire it spuriously otherwise).
    const unpushed = countUnpushed();
    if (unpushed > 0) {
      return block(
        `${unpushed} unpushed commit${unpushed === 1 ? "" : "s"} on current branch. Push first so the PR reflects your local state.`,
      );
    }

    // Filter path: body snapshot. gh failures are non-fatal.
    const prRef = extractPRRef(cmd);
    const body = fetchBody(prRef);
    if (body === null) {
      // Nothing useful to say without a body; stay out of the way.
      return exit0();
    }
    inject(summarize(prRef ?? "(current branch)", body));
  } catch {
    exit0();
  }
});

// ---------------------------------------------------------------------

function findStrayDocs() {
  const cwd = process.cwd();
  const rootFiles = ["findings.md", "progress.md", "task_plan.md"];
  const root = rootFiles.filter((f) => {
    try {
      return fs.statSync(path.join(cwd, f)).isFile();
    } catch {
      return false;
    }
  });

  const specDir = path.join(cwd, "docs", "superpowers", "specs");
  let specs = [];
  try {
    const entries = fs.readdirSync(specDir);
    specs = entries
      .filter((e) => /\.md$/i.test(e))
      .filter((e) => !/\.bak$/i.test(e))
      .map((e) => `docs/superpowers/specs/${e}`);
  } catch {
    // dir doesn't exist — no spec docs. Not stray.
  }
  return { root, specs };
}

function countUnpushed() {
  // @{u} is the configured upstream of the current branch. If unset
  // (detached HEAD, no tracking), the rev-list call exits non-zero
  // and we return 0 to avoid blocking a branch that isn't even on a
  // remote yet.
  const r = spawnSync("git", ["rev-list", "--count", "@{u}..HEAD"], {
    encoding: "utf8",
    timeout: 3000,
  });
  if (r.status !== 0) return 0;
  const n = parseInt((r.stdout ?? "").trim(), 10);
  return Number.isFinite(n) ? n : 0;
}

function extractPRRef(cmd) {
  // `gh pr ready` optionally accepts a PR number or URL as its first
  // positional argument. When omitted, gh picks the PR for the current
  // branch. We don't need to resolve the current branch ourselves —
  // gh pr view with no ref does the same.
  const m = cmd.match(/\bgh\s+pr\s+ready\s+(\S+)/);
  if (!m) return null;
  const candidate = m[1];
  // Ignore flag-starting tokens (`--confirm`, etc.)
  if (candidate.startsWith("-")) return null;
  return candidate;
}

function fetchBody(prRef) {
  const args = ["pr", "view"];
  if (prRef) args.push(prRef);
  args.push("--json", "body", "-q", ".body");
  try {
    const r = spawnSync("gh", args, { encoding: "utf8", timeout: 5000 });
    if (r.status !== 0) return null;
    return typeof r.stdout === "string" ? r.stdout : null;
  } catch {
    return null;
  }
}

function summarize(ref, body) {
  const lines = body.split(/\r?\n/);
  const headings = lines
    .map((l) => l.trim())
    .filter((l) => /^#{2,3}\s+\S/.test(l));
  const unchecked = (body.match(/^\s*-\s+\[\s\]/gm) ?? []).length;
  const checked = (body.match(/^\s*-\s+\[[xX]\]/gm) ?? []).length;

  const head = `[pr-ready-guard] PR ${ref} body snapshot (${body.length} chars):`;
  const headingLine =
    headings.length === 0
      ? "  Headings: (none found)"
      : "  Headings:\n" + headings.map((h) => `    - ${h}`).join("\n");
  const todoLine = `  TODO checkboxes: ${unchecked} unchecked, ${checked} checked`;
  const tail =
    "Confirm acceptance criteria are met and the body reflects the final commits. Use `gh pr edit` to sync anything drifted.";
  return [head, headingLine, todoLine, tail].join("\n");
}

// Minimal quote-stripper so mentions of our match phrase inside quoted
// args (echo, git commit -m, etc.) don't false-positive the hook.
// Handles '...' and "..." with backslash escapes inside double quotes;
// unclosed quote → return input unchanged (upstream regex decides).
function stripQuoted(cmd) {
  let out = "";
  let quote = null;
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i];
    if (quote) {
      if (c === quote) quote = null;
      else if (c === "\\" && quote === '"' && i + 1 < cmd.length) i++;
      continue;
    }
    if (c === "'" || c === '"') {
      quote = c;
      continue;
    }
    out += c;
  }
  return quote === null ? out : cmd;
}

function block(reason) {
  process.stderr.write(`pr-ready-guard: ${reason}\n`);
  process.exit(2);
}

function inject(message) {
  const out = {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      additionalContext: message,
    },
  };
  process.stdout.write(JSON.stringify(out));
  process.exit(0);
}

function exit0() {
  process.exit(0);
}
