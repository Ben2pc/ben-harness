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
});
