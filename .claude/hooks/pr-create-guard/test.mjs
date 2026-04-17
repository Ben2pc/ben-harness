#!/usr/bin/env node
// Smoke tests for pr-create-guard (PostToolUse).
//
// Locally-observable paths only: pass-through for non-matching commands
// and graceful fallback when the PR cannot be fetched via gh. The
// happy-path body snapshot is exercised by worktree-isolated subagent
// verification against a real gh session.
//
//     node .claude/hooks/pr-create-guard/test.mjs

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ENTRY = path.join(HERE, "index.mjs");

function run(payload) {
  const r = spawnSync("node", [ENTRY], {
    input: JSON.stringify(payload),
    encoding: "utf8",
  });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

const cases = [
  {
    name: "non-Bash tool is ignored",
    payload: {
      hook_event_name: "PostToolUse",
      tool_name: "Read",
      tool_input: {},
      tool_response: {},
    },
    expect: { status: 0, stdoutEq: "" },
  },
  {
    name: "non-gh-pr-create command passes through silently",
    payload: {
      hook_event_name: "PostToolUse",
      tool_name: "Bash",
      tool_input: { command: "ls -la" },
      tool_response: { stdout: "", exit_code: 0 },
    },
    expect: { status: 0, stdoutEq: "" },
  },
  {
    name: "gh pr view (not create) passes through",
    payload: {
      hook_event_name: "PostToolUse",
      tool_name: "Bash",
      tool_input: { command: "gh pr view 14 --json body" },
      tool_response: { stdout: '{"body":"x"}', exit_code: 0 },
    },
    expect: { status: 0, stdoutEq: "" },
  },
  {
    name: "echo containing 'gh pr create' does NOT trigger the hook",
    payload: {
      hook_event_name: "PostToolUse",
      tool_name: "Bash",
      tool_input: { command: `echo "don't run gh pr create yet"` },
      tool_response: { stdout: "don't run gh pr create yet\n", exit_code: 0 },
    },
    expect: { status: 0, stdoutEq: "" },
  },
  {
    name: "git commit -m containing 'gh pr create' does NOT trigger the hook",
    payload: {
      hook_event_name: "PostToolUse",
      tool_name: "Bash",
      tool_input: { command: `git commit -m "note about gh pr create workflow"` },
      tool_response: { stdout: "", exit_code: 0 },
    },
    expect: { status: 0, stdoutEq: "" },
  },
  {
    name: "gh pr create failure (non-zero exit) is ignored",
    payload: {
      hook_event_name: "PostToolUse",
      tool_name: "Bash",
      tool_input: { command: 'gh pr create --title foo --body "x"' },
      tool_response: { stderr: "auth failed", exit_code: 1, isError: true },
    },
    expect: { status: 0, stdoutEq: "" },
  },
  {
    name: "gh pr create success without URL falls back to passive nudge",
    payload: {
      hook_event_name: "PostToolUse",
      tool_name: "Bash",
      tool_input: { command: 'gh pr create --title foo --body "x"' },
      tool_response: { stdout: "some output without url", exit_code: 0 },
    },
    expect: { status: 0, stdoutIncludes: "could not identify" },
  },
  {
    name: "gh pr create with URL in response attempts body fetch",
    payload: {
      hook_event_name: "PostToolUse",
      tool_name: "Bash",
      tool_input: { command: 'gh pr create --title foo --body "x"' },
      tool_response: {
        stdout: "https://github.com/no-such-owner/no-such-repo/pull/999999\n",
        exit_code: 0,
      },
    },
    // The fetch will fail (no auth / no such repo). The hook should
    // gracefully inject the fallback message — not crash, not block.
    expect: { status: 0, stdoutIncludes: "pr-create-guard" },
  },
];

let failed = 0;
let passed = 0;
for (const c of cases) {
  const r = run(c.payload);
  const checks = [];
  if (c.expect.status !== undefined)
    checks.push({ ok: r.status === c.expect.status, msg: `status=${r.status} (want ${c.expect.status})` });
  if (c.expect.stdoutEq !== undefined)
    checks.push({
      ok: r.stdout === c.expect.stdoutEq,
      msg: `stdout exact match (got "${r.stdout.slice(0, 80)}")`,
    });
  if (c.expect.stdoutIncludes !== undefined)
    checks.push({
      ok: r.stdout.includes(c.expect.stdoutIncludes),
      msg: `stdout includes "${c.expect.stdoutIncludes}" (got "${r.stdout.slice(0, 120)}")`,
    });

  const allOk = checks.every((x) => x.ok);
  if (allOk) {
    passed++;
    console.log(`  ✓ ${c.name}`);
  } else {
    failed++;
    console.error(`  ✗ ${c.name}`);
    for (const ch of checks) console.error(`      ${ch.ok ? "ok  " : "fail"}  ${ch.msg}`);
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
