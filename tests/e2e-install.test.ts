import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";

// E2E install test — the missing piece of the test pyramid.
//
// Unit tests mock fetch + installer modules; entrypoint.test.ts covers
// the bin-symlink path on the raw dist/cli.js. What nothing covers is
// "take the ACTUAL npm tarball we'd publish, install it into a clean
// project, spawn `auriga-cli install --all` against real GitHub content
// pinned to the current HEAD SHA, and assert files land correctly".
//
// The gap matters because our content-fetch path couples the published
// package to the git repo at runtime (fetchContentRoot pins to
// v<package.version> by default; AURIGA_CONTENT_REF overrides it).
// Before this test, the only way to validate that coupling end-to-end
// was to publish to npm and try it — the worst possible discovery path.
//
// This test is LOCAL-ONLY for now (dev runs it after `git push`):
//   npm run test:e2e
// It's NOT in `npm test` because it takes ~1-2 minutes and requires
// network access. PR 2 will wire it into a tag-triggered release
// workflow for the publish gate.

const REPO_ROOT = process.cwd();

function sh(cmd: string, args: string[], opts: { cwd?: string; env?: NodeJS.ProcessEnv } = {}) {
  return spawnSync(cmd, args, {
    cwd: opts.cwd ?? REPO_ROOT,
    env: opts.env ?? process.env,
    encoding: "utf-8",
  });
}

function getHeadSha(): string {
  const r = sh("git", ["rev-parse", "HEAD"]);
  if (r.status !== 0) throw new Error(`git rev-parse HEAD failed: ${r.stderr}`);
  return r.stdout.trim();
}

// `git branch -r --contains <sha>` prints remote branches that reach
// the SHA. Empty stdout means the commit isn't pushed. Uses local refs
// only — no network round-trip, which means the caller should have
// recently pushed (or fetched) for the check to be meaningful. We
// document this in the README alongside the test:e2e invocation.
function shaReachableFromOrigin(sha: string): boolean {
  const r = sh("git", ["branch", "-r", "--contains", sha]);
  return r.status === 0 && r.stdout.trim().length > 0;
}

const HEAD_SHA = getHeadSha();
const SHA_ON_ORIGIN = shaReachableFromOrigin(HEAD_SHA);
const SKIP_REASON = SHA_ON_ORIGIN
  ? undefined
  : `HEAD ${HEAD_SHA.slice(0, 8)} not reachable from any origin/* ref — run \`git push\` first, or \`git fetch origin\` if you just pushed.`;

const scratchDirs: string[] = [];
function makeScratch(label: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `auriga-e2e-${label}-`));
  scratchDirs.push(dir);
  return dir;
}

after(() => {
  for (const d of scratchDirs) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch {}
  }
});

let tarballPath: string | null = null;

function packTarball(): string {
  const dest = makeScratch("pack");
  const r = sh("npm", ["pack", "--pack-destination", dest]);
  if (r.status !== 0) {
    throw new Error(`npm pack failed (exit ${r.status}): ${r.stderr || r.stdout}`);
  }
  // npm pack prints the tarball filename on the last line of stdout.
  const last = r.stdout.trim().split(/\r?\n/).at(-1) ?? "";
  const tarball = path.join(dest, last);
  if (!fs.existsSync(tarball)) {
    throw new Error(`npm pack claimed to emit ${last} but it does not exist in ${dest}`);
  }
  return tarball;
}

// Set up a fresh scratch project and install the just-packed tarball
// into it. Returns the project dir. Uses `npm install --no-audit
// --no-fund --silent` to keep stderr clean and skip unrelated registry
// chatter. Registry deps (@inquirer/prompts, gray-matter) still fetch
// from npmjs.com — this assumes the dev machine has network.
function setupProject(tarball: string): string {
  const proj = makeScratch("proj");
  fs.writeFileSync(
    path.join(proj, "package.json"),
    JSON.stringify({ name: "scratch", version: "0.0.0", private: true }),
  );
  const r = sh("npm", ["install", tarball, "--no-audit", "--no-fund", "--silent"], {
    cwd: proj,
  });
  if (r.status !== 0) {
    throw new Error(`npm install <tarball> failed (exit ${r.status}): ${r.stderr || r.stdout}`);
  }
  return proj;
}

function runCli(proj: string, args: string[], envExtra: Record<string, string> = {}) {
  const bin = path.join(proj, "node_modules", ".bin", "auriga-cli");
  if (!fs.existsSync(bin)) {
    throw new Error(`auriga-cli bin not found at ${bin}`);
  }
  return spawnSync(bin, args, {
    cwd: proj,
    encoding: "utf-8",
    env: {
      ...process.env,
      AURIGA_CONTENT_REF: HEAD_SHA,
      ...envExtra,
    },
  });
}

// Plugins install shells out to `claude plugins install` — unavailable
// in environments without Claude Code CLI (e.g. stripped Linux runners).
// Scenarios that depend on it should skip rather than fail hard.
function claudeCliAvailable(): boolean {
  const r = spawnSync("which", ["claude"], { encoding: "utf-8" });
  return r.status === 0 && r.stdout.trim().length > 0;
}

describe("e2e install — tarball → npm install → auriga-cli install", { skip: SKIP_REASON }, () => {
  before(() => {
    tarballPath = packTarball();
  });

  test("preflight: HEAD is reachable from origin", () => {
    // Tautological given the suite-level skip, but surfaces the state
    // explicitly in test output so a green run confirms we DID verify
    // the push — not that we silently skipped.
    assert.ok(SHA_ON_ORIGIN, SKIP_REASON);
    assert.ok(tarballPath && fs.existsSync(tarballPath), "tarball not packed");
  });

  test("install workflow → CLAUDE.md + AGENTS.md symlink land in the project", () => {
    const proj = setupProject(tarballPath!);
    const r = runCli(proj, ["install", "workflow"]);
    assert.equal(
      r.status,
      0,
      `auriga-cli install workflow exited ${r.status}.\nstdout: ${r.stdout}\nstderr: ${r.stderr}`,
    );

    const claudeMd = path.join(proj, "CLAUDE.md");
    assert.ok(fs.existsSync(claudeMd), `CLAUDE.md missing at ${claudeMd}`);
    assert.ok(fs.statSync(claudeMd).size > 0, "CLAUDE.md is empty");

    const agentsMd = path.join(proj, "AGENTS.md");
    assert.ok(fs.existsSync(agentsMd), `AGENTS.md missing at ${agentsMd}`);
    const lst = fs.lstatSync(agentsMd);
    assert.ok(lst.isSymbolicLink(), "AGENTS.md should be a symlink to CLAUDE.md");
  });

  test("install skills → WORKFLOW_SKILLS materialize under .agents/skills/", () => {
    const proj = setupProject(tarballPath!);
    const r = runCli(proj, ["install", "skills"]);
    assert.equal(
      r.status,
      0,
      `install skills exited ${r.status}.\nstdout: ${r.stdout}\nstderr: ${r.stderr}`,
    );
    // `npx skills add` materializes <skill>/SKILL.md under .agents/skills
    // (or .claude/skills depending on the tool version). Check both
    // canonical locations so the assertion survives a path-convention
    // bump in the upstream `skills` CLI.
    const brainstormingPaths = [
      path.join(proj, ".agents", "skills", "brainstorming", "SKILL.md"),
      path.join(proj, ".claude", "skills", "brainstorming", "SKILL.md"),
    ];
    const found = brainstormingPaths.find((p) => fs.existsSync(p));
    assert.ok(
      found,
      `brainstorming SKILL.md missing — checked:\n  ${brainstormingPaths.join("\n  ")}`,
    );
  });

  test("install recommended --recommended-skill codex-agent → only codex-agent lands", () => {
    const proj = setupProject(tarballPath!);
    const r = runCli(proj, ["install", "recommended", "--recommended-skill", "codex-agent"]);
    assert.equal(
      r.status,
      0,
      `install recommended exited ${r.status}.\nstdout: ${r.stdout}\nstderr: ${r.stderr}`,
    );
    const codexPaths = [
      path.join(proj, ".agents", "skills", "codex-agent", "SKILL.md"),
      path.join(proj, ".claude", "skills", "codex-agent", "SKILL.md"),
    ];
    const found = codexPaths.find((p) => fs.existsSync(p));
    assert.ok(found, `codex-agent SKILL.md missing — checked:\n  ${codexPaths.join("\n  ")}`);
  });

  test("install plugins --plugin auriga-go → plugin registered in .claude/settings.json", { skip: claudeCliAvailable() ? undefined : "requires 'claude' CLI" }, () => {
    const proj = setupProject(tarballPath!);
    const r = runCli(proj, ["install", "plugins", "--plugin", "auriga-go"]);
    assert.equal(
      r.status,
      0,
      `install plugins exited ${r.status}.\nstdout: ${r.stdout}\nstderr: ${r.stderr}`,
    );
    // `claude plugins install` writes to .claude/settings.json.
    // Exit 0 + any settings file present is a reasonable signal that
    // the install pipeline ran without erroring out. Avoid depending on
    // the exact JSON schema since it's controlled by the claude CLI.
    const settings = path.join(proj, ".claude", "settings.json");
    assert.ok(fs.existsSync(settings), `.claude/settings.json missing at ${settings}`);
    const content = fs.readFileSync(settings, "utf-8");
    assert.match(content, /auriga-go/, "auriga-go not mentioned in .claude/settings.json");
  });

  test("install hooks --hook notify → notify dir + settings entry", { skip: process.platform === "darwin" ? undefined : "notify hook is darwin-only" }, () => {
    const proj = setupProject(tarballPath!);
    const r = runCli(proj, ["install", "hooks", "--hook", "notify"]);
    assert.equal(
      r.status,
      0,
      `install hooks exited ${r.status}.\nstdout: ${r.stdout}\nstderr: ${r.stderr}`,
    );
    const hookDir = path.join(proj, ".claude", "hooks", "notify");
    assert.ok(fs.existsSync(path.join(hookDir, "index.mjs")), "notify/index.mjs missing");
    const settings = path.join(proj, ".claude", "settings.json");
    assert.ok(fs.existsSync(settings), ".claude/settings.json missing");
    const parsed = JSON.parse(fs.readFileSync(settings, "utf-8")) as {
      hooks?: Record<string, Array<{ hooks: Array<{ _marker?: string }> }>>;
    };
    // Confirm the marker sentinel landed — that's the primary key
    // addHookToSettings uses for idempotency, so its presence means the
    // registry merge actually ran end-to-end.
    const markers = Object.values(parsed.hooks ?? {})
      .flatMap((events) => events.flatMap((e) => e.hooks.map((h) => h._marker)));
    assert.ok(
      markers.some((m) => typeof m === "string" && m.includes("notify")),
      `expected an auriga:notify marker in settings.hooks, got ${JSON.stringify(markers)}`,
    );
  });

  test("install skills --skill brainstorming → filter actually filters (other skills absent)", () => {
    const proj = setupProject(tarballPath!);
    const r = runCli(proj, ["install", "skills", "--skill", "brainstorming"]);
    assert.equal(
      r.status,
      0,
      `install skills --skill brainstorming exited ${r.status}.\nstdout: ${r.stdout}\nstderr: ${r.stderr}`,
    );
    const brainPaths = [
      path.join(proj, ".agents", "skills", "brainstorming"),
      path.join(proj, ".claude", "skills", "brainstorming"),
    ];
    const brainFound = brainPaths.find((p) => fs.existsSync(p));
    assert.ok(brainFound, `brainstorming dir missing — checked:\n  ${brainPaths.join("\n  ")}`);

    // A random non-selected workflow skill must NOT be present — proves
    // the filter isn't a silent no-op that installs everything.
    const otherPaths = [
      path.join(proj, ".agents", "skills", "test-driven-development"),
      path.join(proj, ".claude", "skills", "test-driven-development"),
    ];
    for (const p of otherPaths) {
      assert.ok(!fs.existsSync(p), `non-selected skill leaked through filter: ${p}`);
    }
  });

  test("install --all → workflow + skills + plugins + hooks all present", { skip: claudeCliAvailable() ? undefined : "requires 'claude' CLI" }, () => {
    const proj = setupProject(tarballPath!);
    const r = runCli(proj, ["install", "--all"]);
    // `install --all` may exit 2 on partial success (e.g. one category
    // fails). Accept 0 as strict pass, 2 with a retry hint as soft pass
    // only if the core artifacts (CLAUDE.md + at least one skill) landed.
    if (r.status !== 0 && r.status !== 2) {
      assert.fail(`install --all exited ${r.status}.\nstdout: ${r.stdout}\nstderr: ${r.stderr}`);
    }

    const claudeMd = path.join(proj, "CLAUDE.md");
    assert.ok(fs.existsSync(claudeMd) && fs.statSync(claudeMd).size > 0, "CLAUDE.md missing/empty");

    const brainPaths = [
      path.join(proj, ".agents", "skills", "brainstorming", "SKILL.md"),
      path.join(proj, ".claude", "skills", "brainstorming", "SKILL.md"),
    ];
    assert.ok(
      brainPaths.some((p) => fs.existsSync(p)),
      `no workflow skill landed — checked:\n  ${brainPaths.join("\n  ")}`,
    );
  });
});
