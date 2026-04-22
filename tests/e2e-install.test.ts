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
// network access. A follow-up release workflow will wire the same test
// into a tag-push publish gate.

// `npm run test:e2e` always runs from the repo root (same contract as
// `npm test`). We rely on this to resolve relative npm/git commands.
const REPO_ROOT = process.cwd();

function run(cmd: string, args: string[], opts: { cwd?: string; env?: NodeJS.ProcessEnv } = {}) {
  return spawnSync(cmd, args, {
    cwd: opts.cwd ?? REPO_ROOT,
    env: opts.env ?? process.env,
    encoding: "utf-8",
  });
}

// Lazy: running `git rev-parse HEAD` at module import would crash the
// entire test process if the file were ever imported from a non-git
// checkout (e.g. a tarball). Defer until describe evaluation so the
// suite-level skip can still fire with a clean message.
let _gitState: { headSha: string; onOrigin: boolean; skipReason: string | undefined } | null = null;
function gitState() {
  if (_gitState) return _gitState;
  const headResult = run("git", ["rev-parse", "HEAD"]);
  if (headResult.status !== 0) {
    _gitState = {
      headSha: "",
      onOrigin: false,
      skipReason: `not in a git repo (git rev-parse HEAD failed): ${headResult.stderr.trim()}`,
    };
    return _gitState;
  }
  const headSha = headResult.stdout.trim();
  // `git branch -r --contains <sha>` prints remote branches that reach
  // the SHA. Empty stdout means the commit isn't pushed to a remote
  // that the local checkout knows about. Uses local refs only — no
  // network round-trip. The caller should have recently pushed so that
  // `push` (which updates local remote refs synchronously) made the
  // SHA reachable; or have `git fetch`-ed if someone else pushed it.
  const reachResult = run("git", ["branch", "-r", "--contains", headSha]);
  const onOrigin = reachResult.status === 0 && reachResult.stdout.trim().length > 0;
  _gitState = {
    headSha,
    onOrigin,
    skipReason: onOrigin
      ? undefined
      : `HEAD ${headSha.slice(0, 8)} is not reachable from any remote ref known locally — push first (a successful push updates local remote refs) or fetch if someone else pushed it.`,
  };
  return _gitState;
}

// Cache so scenarios consulting this don't spawn `which claude` N times.
// Plugins install shells out to `claude plugins install`, unavailable
// in stripped environments; scenarios that depend on it skip rather
// than fail hard.
const CLAUDE_AVAILABLE = (() => {
  const r = spawnSync("which", ["claude"], { encoding: "utf-8" });
  return r.status === 0 && r.stdout.trim().length > 0;
})();

describe(
  "e2e install — tarball → npm install → auriga-cli install",
  { skip: gitState().skipReason },
  () => {
    const scratchDirs: string[] = [];
    let tarballPath: string | null = null;

    function makeScratch(label: string): string {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), `auriga-e2e-${label}-`));
      scratchDirs.push(dir);
      return dir;
    }

    function packTarball(): string {
      const dest = makeScratch("pack");
      // `npm pack --json` is structured and version-proof: stdout is a
      // JSON array with `.filename` on each entry. Parsing the last
      // line of human-readable output is fragile across npm versions.
      const r = run("npm", ["pack", "--pack-destination", dest, "--json"]);
      if (r.status !== 0) {
        throw new Error(`npm pack failed (exit ${r.status}): ${r.stderr || r.stdout || "(no output)"}`);
      }
      const parsed = JSON.parse(r.stdout) as Array<{ filename?: string }>;
      const filename = parsed?.[0]?.filename;
      if (!filename) {
        throw new Error(`npm pack --json returned unexpected shape: ${r.stdout.slice(0, 200)}`);
      }
      const tarball = path.join(dest, filename);
      if (!fs.existsSync(tarball)) {
        throw new Error(`npm pack claimed to emit ${filename} but it does not exist in ${dest}`);
      }
      return tarball;
    }

    // Set up a fresh scratch project and install the just-packed
    // tarball into it. Returns the project dir. Registry deps
    // (@inquirer/prompts, gray-matter) still fetch from npmjs.com —
    // this assumes the dev machine has network.
    function setupProject(tarball: string): string {
      const proj = makeScratch("proj");
      fs.writeFileSync(
        path.join(proj, "package.json"),
        JSON.stringify({ name: "scratch", version: "0.0.0", private: true }),
      );
      const r = run("npm", ["install", tarball, "--no-audit", "--no-fund", "--silent"], {
        cwd: proj,
      });
      if (r.status !== 0) {
        throw new Error(
          `npm install <tarball> failed (exit ${r.status}): ${r.stderr || r.stdout || "(no output)"}`,
        );
      }
      return proj;
    }

    function runCli(proj: string, args: string[], envExtra: Record<string, string> = {}) {
      const bin = path.join(proj, "node_modules", ".bin", "auriga-cli");
      if (!fs.existsSync(bin)) {
        throw new Error(`auriga-cli bin not found at ${bin}`);
      }
      // Scrub DEV from the inherited env: a dev shell with `DEV=1`
      // exported (documented in README as the dev flow) would make
      // `fetchContentRoot` short-circuit to `getPackageRoot()`. The
      // installed tarball's package root does not carry CLAUDE.md /
      // skills-lock.json / .claude/*.json (those are excluded from
      // the `files` manifest on purpose — they live on GitHub), so
      // every scenario would fail with a misleading "file missing"
      // error. The e2e's whole point is to exercise the real fetch
      // path, so DEV must be explicitly off.
      const env: NodeJS.ProcessEnv = { ...process.env, AURIGA_CONTENT_REF: gitState().headSha, ...envExtra };
      delete env.DEV;
      return spawnSync(bin, args, { cwd: proj, encoding: "utf-8", env });
    }

    // Skills materialize at `.agents/skills/<name>` OR `.claude/skills/<name>`
    // depending on the upstream `skills` CLI's convention. Check both
    // so the assertion survives a benign path-convention bump.
    function findSkillDir(proj: string, name: string): string | undefined {
      const candidates = [
        path.join(proj, ".agents", "skills", name),
        path.join(proj, ".claude", "skills", name),
      ];
      return candidates.find((p) => fs.existsSync(p));
    }
    function findSkillFile(proj: string, name: string): string | undefined {
      const dir = findSkillDir(proj, name);
      if (!dir) return undefined;
      const f = path.join(dir, "SKILL.md");
      return fs.existsSync(f) ? f : undefined;
    }

    // Any test calling an installer that shells out to the npm
    // registry or GitHub can in principle hang (registry slow-lane,
    // `claude plugins install` waiting on auth prompt on some CLI
    // versions). Without a timeout the suite hangs indefinitely,
    // which is nasty for a release gate. 180s per test is generous
    // for the 30-40s `install skills` / `install --all` scenarios.
    const TIMEOUT = 180_000;

    before(() => {
      tarballPath = packTarball();
    });

    after(() => {
      for (const d of scratchDirs) {
        try { fs.rmSync(d, { recursive: true, force: true }); } catch {}
      }
    });

    test("preflight: HEAD is reachable from origin", { timeout: TIMEOUT }, () => {
      // Tautological given the suite-level skip, but surfaces the state
      // explicitly in test output so a green run confirms we DID verify
      // the push — not that we silently skipped.
      assert.ok(gitState().onOrigin, gitState().skipReason);
      assert.ok(tarballPath && fs.existsSync(tarballPath), "tarball not packed");
    });

    test("install workflow → CLAUDE.md + AGENTS.md symlink land in the project", { timeout: TIMEOUT }, () => {
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

    test("install skills → WORKFLOW_SKILLS materialize under .agents/skills/", { timeout: TIMEOUT }, () => {
      const proj = setupProject(tarballPath!);
      const r = runCli(proj, ["install", "skills"]);
      assert.equal(
        r.status,
        0,
        `install skills exited ${r.status}.\nstdout: ${r.stdout}\nstderr: ${r.stderr}`,
      );
      assert.ok(findSkillFile(proj, "brainstorming"), "brainstorming SKILL.md missing");
    });

    test("install recommended --recommended-skill codex-agent → only codex-agent lands", { timeout: TIMEOUT }, () => {
      const proj = setupProject(tarballPath!);
      const r = runCli(proj, ["install", "recommended", "--recommended-skill", "codex-agent"]);
      assert.equal(
        r.status,
        0,
        `install recommended exited ${r.status}.\nstdout: ${r.stdout}\nstderr: ${r.stderr}`,
      );
      assert.ok(findSkillFile(proj, "codex-agent"), "codex-agent SKILL.md missing");
    });

    test(
      "install plugins --plugin auriga-go → plugin registered in .claude/settings.json",
      { skip: CLAUDE_AVAILABLE ? undefined : "requires 'claude' CLI", timeout: TIMEOUT },
      () => {
        const proj = setupProject(tarballPath!);
        const r = runCli(proj, ["install", "plugins", "--plugin", "auriga-go"]);
        assert.equal(
          r.status,
          0,
          `install plugins exited ${r.status}.\nstdout: ${r.stdout}\nstderr: ${r.stderr}`,
        );
        const settings = path.join(proj, ".claude", "settings.json");
        assert.ok(fs.existsSync(settings), `.claude/settings.json missing at ${settings}`);
        const content = fs.readFileSync(settings, "utf-8");
        assert.match(content, /auriga-go/, "auriga-go not mentioned in .claude/settings.json");
      },
    );

    test(
      "install hooks --hook notify → notify dir + settings entry",
      { skip: process.platform === "darwin" ? undefined : "notify hook is darwin-only", timeout: TIMEOUT },
      () => {
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
        // addHookToSettings uses for idempotency, so its presence means
        // the registry merge actually ran end-to-end.
        const markers = Object.values(parsed.hooks ?? {})
          .flatMap((events) => events.flatMap((e) => e.hooks.map((h) => h._marker)));
        assert.ok(
          markers.some((m) => typeof m === "string" && m.includes("notify")),
          `expected an auriga:notify marker in settings.hooks, got ${JSON.stringify(markers)}`,
        );
      },
    );

    test("install skills --skill brainstorming → filter actually filters (other skills absent)", { timeout: TIMEOUT }, () => {
      const proj = setupProject(tarballPath!);
      const r = runCli(proj, ["install", "skills", "--skill", "brainstorming"]);
      assert.equal(
        r.status,
        0,
        `install skills --skill brainstorming exited ${r.status}.\nstdout: ${r.stdout}\nstderr: ${r.stderr}`,
      );
      // brainstorming must be present — otherwise the filter-leak
      // check below would pass vacuously if the whole install silently
      // errored out and produced no skills dir at all.
      assert.ok(findSkillDir(proj, "brainstorming"), "brainstorming dir missing (filter test would be vacuous)");
      // A random non-selected workflow skill must NOT be present —
      // proves the filter isn't a silent no-op that installs everything.
      assert.ok(
        !findSkillDir(proj, "test-driven-development"),
        "non-selected skill leaked through filter: test-driven-development",
      );
    });

    test(
      "install --all → workflow + skills + plugins + hooks all present",
      { skip: CLAUDE_AVAILABLE ? undefined : "requires 'claude' CLI", timeout: TIMEOUT },
      () => {
        const proj = setupProject(tarballPath!);
        const r = runCli(proj, ["install", "--all"]);
        // `install --all` may exit 2 on partial success. Accept 0 as
        // strict pass, 2 as soft pass only if every must-have category
        // artifact landed — per-category assertions below catch the
        // silent-failure regression where one category errors inside
        // the loop and the test otherwise accepts "mostly green".
        if (r.status !== 0 && r.status !== 2) {
          assert.fail(`install --all exited ${r.status}.\nstdout: ${r.stdout}\nstderr: ${r.stderr}`);
        }

        const claudeMd = path.join(proj, "CLAUDE.md");
        assert.ok(fs.existsSync(claudeMd) && fs.statSync(claudeMd).size > 0, "CLAUDE.md missing/empty (workflow category)");

        assert.ok(findSkillFile(proj, "brainstorming"), "brainstorming SKILL.md missing (skills category)");

        // Plugins category: `.claude/settings.json` exists AND mentions
        // auriga-go. Gated above by CLAUDE_AVAILABLE so claude plugins
        // install can actually write it.
        const settings = path.join(proj, ".claude", "settings.json");
        assert.ok(fs.existsSync(settings), ".claude/settings.json missing (plugins category)");
        assert.match(
          fs.readFileSync(settings, "utf-8"),
          /auriga-go/,
          "auriga-go plugin not registered in settings.json (plugins category silent-failed)",
        );

        // Hooks category: `install --all` only installs hooks with
        // `defaultOn: true` in the registry (notify is opt-in on
        // purpose — macOS-only, requires brew dep). Don't assert a
        // specific hook; instead assert at least one auriga:* marker
        // landed, proving the hooks installer ran and merged settings.
        // A silent hooks-category failure would leave settings.json
        // with only the plugins marker from `claude plugins install`,
        // which is not auriga-prefixed.
        const settingsParsed = JSON.parse(fs.readFileSync(settings, "utf-8")) as {
          hooks?: Record<string, Array<{ hooks: Array<{ _marker?: string }> }>>;
        };
        const aurigaMarkers = Object.values(settingsParsed.hooks ?? {})
          .flatMap((events) => events.flatMap((e) => e.hooks.map((h) => h._marker)))
          .filter((m): m is string => typeof m === "string" && m.startsWith("auriga:"));
        assert.ok(
          aurigaMarkers.length > 0,
          `no auriga:* hook markers in settings.json — hooks category likely silent-failed. Got markers: ${JSON.stringify(aurigaMarkers)}`,
        );
      },
    );
  },
);
