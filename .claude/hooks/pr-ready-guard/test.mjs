#!/usr/bin/env node
// Smoke + assertion tests for pr-ready-guard.
//
// Each case spawns index.mjs with a fake PreToolUse payload and controls
// the hook's cwd (so we can put stray planning docs into scratch dirs
// without polluting the real repo). Git/gh integration paths that need
// a live remote are exercised manually per README; the smoke cases
// cover the locally-observable branches.
//
//     node .claude/hooks/pr-ready-guard/test.mjs
//
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ENTRY = path.join(HERE, "index.mjs");

function run(command, cwd) {
  const payload = JSON.stringify({
    session_id: "test",
    hook_event_name: "PreToolUse",
    tool_name: "Bash",
    tool_input: { command, description: "test" },
  });
  const r = spawnSync("node", [ENTRY], {
    input: payload,
    encoding: "utf8",
    cwd,
    env: { ...process.env, PR_READY_GUARD_TEST: "1" },
  });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

// Makes a scratch dir that looks like a git repo (so upstream-diff
// commands in the hook short-circuit cleanly) but has no remote, no
// gh auth, nothing interesting.
function makeRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pr-ready-guard-test-"));
  spawnSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
  spawnSync("git", ["-C", dir, "config", "user.email", "test@test.invalid"]);
  spawnSync("git", ["-C", dir, "config", "user.name", "test"]);
  fs.writeFileSync(path.join(dir, "seed"), "x");
  spawnSync("git", ["-C", dir, "add", "."]);
  spawnSync("git", ["-C", dir, "commit", "-q", "-m", "seed"]);
  return dir;
}

const cleanupDirs = [];

const cases = [
  {
    name: "non-gh-pr-ready command passes through silently",
    setup: () => ({ cwd: makeRepo(), cmd: "ls -la" }),
    expect: { status: 0, stdoutEq: "" },
  },
  {
    name: "gh pr create (not ready) passes through",
    setup: () => ({ cwd: makeRepo(), cmd: 'gh pr create --body "x"' }),
    expect: { status: 0, stdoutEq: "" },
  },
  {
    name: "echo containing 'gh pr ready' does NOT trigger the hook",
    setup: () => ({ cwd: makeRepo(), cmd: `echo "don't run gh pr ready yet"` }),
    expect: { status: 0, stdoutEq: "" },
  },
  {
    name: "git commit -m containing 'gh pr ready' does NOT trigger the hook",
    setup: () => {
      const dir = makeRepo();
      // Also plant a stray findings.md to prove: if the hook DID
      // mistakenly trigger on this quoted command, it would block
      // on the stray doc. Since the quote-strip kicks in first, the
      // hook exits 0 silently despite the stray presence.
      fs.writeFileSync(path.join(dir, "findings.md"), "# would block if hook fired\n");
      return { cwd: dir, cmd: `git commit -m "note about gh pr ready workflow"` };
    },
    expect: { status: 0, stdoutEq: "" },
  },
  {
    name: "stray findings.md at repo root blocks",
    setup: () => {
      const dir = makeRepo();
      fs.writeFileSync(path.join(dir, "findings.md"), "# notes\n");
      return { cwd: dir, cmd: "gh pr ready" };
    },
    expect: { status: 2, stderrIncludes: "stray planning docs" },
  },
  {
    name: "stray progress.md + task_plan.md block (names reported)",
    setup: () => {
      const dir = makeRepo();
      fs.writeFileSync(path.join(dir, "progress.md"), "# log\n");
      fs.writeFileSync(path.join(dir, "task_plan.md"), "# plan\n");
      return { cwd: dir, cmd: "gh pr ready" };
    },
    expect: { status: 2, stderrIncludes: "progress.md" },
  },
  {
    name: "stray spec under docs/superpowers/specs/*.md blocks",
    setup: () => {
      const dir = makeRepo();
      const specDir = path.join(dir, "docs", "superpowers", "specs");
      fs.mkdirSync(specDir, { recursive: true });
      fs.writeFileSync(path.join(specDir, "2026-04-17-foo-design.md"), "# spec\n");
      return { cwd: dir, cmd: "gh pr ready" };
    },
    expect: { status: 2, stderrIncludes: "spec docs" },
  },
  {
    name: "active spec left in docs/specs/*.md blocks (B4)",
    setup: () => {
      const dir = makeRepo();
      const activeDir = path.join(dir, "docs", "specs");
      fs.mkdirSync(activeDir, { recursive: true });
      fs.writeFileSync(path.join(activeDir, "auriga-go-design.md"), "# active spec\n");
      return { cwd: dir, cmd: "gh pr ready" };
    },
    expect: { status: 2, stderrIncludes: "unfinalized active specs in docs/specs/" },
  },
  {
    name: "B4 message lists promote/archive/delete remediation",
    setup: () => {
      const dir = makeRepo();
      const activeDir = path.join(dir, "docs", "specs");
      fs.mkdirSync(activeDir, { recursive: true });
      fs.writeFileSync(path.join(activeDir, "feature-x-design.md"), "# spec\n");
      return { cwd: dir, cmd: "gh pr ready" };
    },
    expect: { status: 2, stderrIncludes: "promote to docs/architecture/" },
  },
  {
    name: "empty docs/specs/ does NOT block (B4 negative)",
    setup: () => {
      const dir = makeRepo();
      fs.mkdirSync(path.join(dir, "docs", "specs"), { recursive: true });
      // No .md files inside — directory exists but empty.
      return { cwd: dir, cmd: "gh pr ready" };
    },
    expect: { status: 0, stderrNotIncludes: "active specs" },
  },
  {
    name: "non-md files in docs/specs/ don't trigger B4",
    setup: () => {
      const dir = makeRepo();
      const activeDir = path.join(dir, "docs", "specs");
      fs.mkdirSync(activeDir, { recursive: true });
      fs.writeFileSync(path.join(activeDir, ".gitkeep"), "");
      fs.writeFileSync(path.join(activeDir, "draft.md.bak"), "old\n");
      return { cwd: dir, cmd: "gh pr ready" };
    },
    expect: { status: 0, stderrNotIncludes: "active specs" },
  },
  {
    name: "archived worklog copy does NOT count as stray",
    setup: () => {
      const dir = makeRepo();
      const worklogDir = path.join(dir, "docs", "worklog", "worklog-2026-04-17-foo");
      fs.mkdirSync(worklogDir, { recursive: true });
      fs.writeFileSync(path.join(worklogDir, "findings.md"), "archived\n");
      // No root-level copies; this one is archived.
      // Also need to ensure no unpushed commits — repo has no remote so
      // the upstream-diff branch will short-circuit.
      return { cwd: dir, cmd: "gh pr ready" };
    },
    // Without a git upstream or gh auth, the hook should proceed past
    // the blocks and into the filter path. We accept either silent pass
    // (if gh query fails silently) or an additionalContext injection;
    // what we're testing is that NO stray-doc block fired.
    expect: { status: 0, stderrNotIncludes: "stray" },
  },
  {
    name: "clean repo passes stray checks (may still fail filter if no gh)",
    setup: () => ({ cwd: makeRepo(), cmd: "gh pr ready" }),
    expect: { status: 0, stderrNotIncludes: "stray" },
  },
  {
    name: "stray-doc check uses git toplevel, not cwd (subdir invocation)",
    setup: () => {
      const dir = makeRepo();
      fs.writeFileSync(path.join(dir, "findings.md"), "# at root\n");
      const subdir = path.join(dir, "src");
      fs.mkdirSync(subdir, { recursive: true });
      // Agent fires the hook from inside src/ — must still see root findings.md
      return { cwd: subdir, cmd: "gh pr ready" };
    },
    expect: { status: 2, stderrIncludes: "findings.md" },
  },
  {
    name: "explicit PR ref skips unpushed-commit check on current branch",
    setup: () => {
      const dir = makeRepo();
      // Fake a scenario where current branch has "unpushed" commits by
      // just not having an upstream — countUnpushed would already return
      // 0 in that case, so this test primarily confirms that extractPRRef
      // returning a value doesn't break the stray-check flow.
      return { cwd: dir, cmd: "gh pr ready 15" };
    },
    // Clean repo + explicit ref → no block, filter path runs; gh may
    // fail in test env so we only assert: no block on unpushed.
    expect: { status: 0, stderrNotIncludes: "unpushed" },
  },
];

let failed = 0;
let passed = 0;
try {
  for (const c of cases) {
    const { cwd, cmd } = c.setup();
    cleanupDirs.push(cwd);
    const r = run(cmd, cwd);
    const checks = [];
    if (c.expect.status !== undefined)
      checks.push({ ok: r.status === c.expect.status, msg: `status=${r.status} (want ${c.expect.status})` });
    if (c.expect.stdoutEq !== undefined)
      checks.push({ ok: r.stdout === c.expect.stdoutEq, msg: `stdout exact "${c.expect.stdoutEq}" (got "${r.stdout.slice(0, 80)}")` });
    if (c.expect.stdoutIncludes !== undefined)
      checks.push({ ok: r.stdout.includes(c.expect.stdoutIncludes), msg: `stdout includes "${c.expect.stdoutIncludes}" (got "${r.stdout.slice(0, 120)}")` });
    if (c.expect.stderrIncludes !== undefined)
      checks.push({ ok: r.stderr.includes(c.expect.stderrIncludes), msg: `stderr includes "${c.expect.stderrIncludes}" (got "${r.stderr.slice(0, 120)}")` });
    if (c.expect.stderrNotIncludes !== undefined)
      checks.push({ ok: !r.stderr.includes(c.expect.stderrNotIncludes), msg: `stderr does NOT include "${c.expect.stderrNotIncludes}" (got "${r.stderr.slice(0, 120)}")` });

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
} finally {
  for (const d of cleanupDirs) {
    fs.rmSync(d, { recursive: true, force: true });
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
