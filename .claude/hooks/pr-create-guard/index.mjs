#!/usr/bin/env node
// pr-create-guard — PostToolUse hook for `gh pr create`.
//
// Fires AFTER the tool runs so we can query the real created PR and
// report its actual body — no command-line regex, no heredoc parsing.
//
// If gh pr create succeeded:
//   - extract the PR URL/number from the tool_response
//   - gh pr view --json body to get the real body
//   - scan ^## / ^### headings, count TODO checkboxes
//   - inject `hookSpecificOutput.additionalContext` with the snapshot
//
// If gh pr create failed, or we can't determine the PR, or gh is
// unavailable: exit 0 silent. PostToolUse never blocks — the tool
// already ran, so the value is informational only.

import { spawnSync } from "node:child_process";

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => (input += c));
process.stdin.on("end", () => {
  try {
    const data = JSON.parse(input);
    if (data?.tool_name !== "Bash") return exit0();

    const cmd = data?.tool_input?.command;
    if (typeof cmd !== "string") return exit0();
    // Strip simple quoted runs so mentions of "gh pr create" inside
    // echo args, git commit messages, etc. don't trigger the hook.
    if (!/\bgh\s+pr\s+create\b/.test(stripQuoted(cmd))) return exit0();

    // Avoid injecting when the tool reported an error — PR wasn't
    // created, so there's nothing to snapshot.
    if (looksLikeFailure(data?.tool_response)) return exit0();

    const prRef = extractPRRef(data?.tool_response, cmd);
    if (!prRef) {
      // Can't identify which PR was created (unusual — gh pr create
      // normally prints the URL). Fall back to a passive nudge.
      return inject(
        "[pr-create-guard] PR created, but could not identify it from gh output. Verify the body covers scope / acceptance criteria / risks / remaining TODO.",
      );
    }

    const body = fetchBody(prRef);
    if (body === null) {
      // gh unavailable or not authenticated. Don't pretend to know
      // anything; remind the Agent to self-verify.
      return inject(
        `[pr-create-guard] PR ${prRef} created (body could not be fetched via gh). Verify scope / acceptance criteria / risks / remaining TODO.`,
      );
    }

    inject(summarize(prRef, body));
  } catch {
    // Never block on our own parse errors.
    exit0();
  }
});

// ---------------------------------------------------------------------

function looksLikeFailure(resp) {
  if (!resp || typeof resp !== "object") return false;
  if (resp.isError === true) return true;
  if (typeof resp.exit_code === "number" && resp.exit_code !== 0) return true;
  if (typeof resp.exitCode === "number" && resp.exitCode !== 0) return true;
  return false;
}

// Pull a PR reference out of the tool_response. gh pr create prints the
// URL on success; we look for github.com/.../pull/N. If no URL is in
// the response, we return null and the caller falls back to a passive
// nudge — we don't try to reconstruct the ref from the command.
function extractPRRef(resp, cmd) {
  const haystack = stringifyResponse(resp) + "\n" + cmd;
  const m = haystack.match(/https?:\/\/[^\s"]+\/pull\/(\d+)/);
  if (m) return m[0]; // use the full URL — gh pr view accepts it
  return null;
}

function stringifyResponse(resp) {
  if (!resp) return "";
  if (typeof resp === "string") return resp;
  if (typeof resp !== "object") return String(resp);
  // Walk known fields — different Claude Code versions use different
  // shapes (stdout/output/text/content). Collect all string-valued
  // leaves. Track seen objects to short-circuit cycles; also cap
  // depth so a pathological payload can't blow the stack.
  const parts = [];
  const seen = new WeakSet();
  const visit = (v, depth) => {
    if (depth > 16) return;
    if (typeof v === "string") parts.push(v);
    else if (Array.isArray(v)) {
      if (seen.has(v)) return;
      seen.add(v);
      v.forEach((x) => visit(x, depth + 1));
    } else if (v && typeof v === "object") {
      if (seen.has(v)) return;
      seen.add(v);
      Object.values(v).forEach((x) => visit(x, depth + 1));
    }
  };
  visit(resp, 0);
  return parts.join("\n");
}

// Minimal quote-stripper so mentions of our match phrase inside quoted
// args (echo, git commit -m, heredoc-ish strings) don't false-positive
// the hook. Handles '...' and "..." with backslash escapes inside
// double quotes; unclosed quote → return input unchanged (upstream
// regex decides).
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

function fetchBody(prRef) {
  try {
    const r = spawnSync("gh", ["pr", "view", prRef, "--json", "body", "-q", ".body"], {
      encoding: "utf8",
      timeout: 5000,
    });
    if (r.status !== 0) return null;
    return typeof r.stdout === "string" ? r.stdout : null;
  } catch {
    return null;
  }
}

function summarize(prRef, body) {
  const lines = body.split(/\r?\n/);
  const headings = lines
    .map((l) => l.trim())
    .filter((l) => /^#{2,3}\s+\S/.test(l));
  const unchecked = (body.match(/^\s*-\s+\[\s\]/gm) ?? []).length;
  const checked = (body.match(/^\s*-\s+\[[xX]\]/gm) ?? []).length;
  const bodyLen = body.length;

  const head =
    `[pr-create-guard] PR ${prRef} body snapshot (${bodyLen} chars):`;
  const headingLine =
    headings.length === 0
      ? "  Headings: (none found)"
      : "  Headings:\n" + headings.map((h) => `    - ${h}`).join("\n");
  const todoLine = `  TODO checkboxes: ${unchecked} unchecked, ${checked} checked`;
  const tail =
    "Verify scope / acceptance criteria / risks / remaining TODO are covered, and edit via `gh pr edit` if anything is missing.";

  return [head, headingLine, todoLine, tail].join("\n");
}

function inject(message) {
  const out = {
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      additionalContext: message,
    },
  };
  process.stdout.write(JSON.stringify(out));
  process.exit(0);
}

function exit0() {
  process.exit(0);
}
