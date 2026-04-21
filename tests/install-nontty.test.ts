import assert from "node:assert/strict";
import { afterEach, describe, mock, test } from "node:test";
const CATALOG = {
  generatedAt: "2026-04-21T00:00:00.000Z",
  workflowSkills: [{ name: "brainstorming", description: "x" }],
  recommendedSkills: [{ name: "codex-agent", description: "x" }],
  plugins: [{ name: "auriga-go", description: "x" }],
  hooks: [{ name: "notify", description: "x" }],
};
let importSerial = 0;
async function captureStderr<T>(fn: () => Promise<T>): Promise<{ result: T; stderr: string }> {
  const chunks: string[] = [];
  const original = process.stderr.write.bind(process.stderr);
  process.stderr.write = ((chunk: string | Uint8Array) => {
    chunks.push(String(chunk));
    return true;
  }) as typeof process.stderr.write;
  try {
    return { result: await fn(), stderr: chunks.join("") };
  } finally {
    process.stderr.write = original;
  }
}
async function importMain(overrides: {
  exec?: (cmd: string) => string;
  fetchContentRoot?: () => Promise<string>;
  isNonInteractive?: () => boolean;
  installWorkflow?: (packageRoot: string, opts: { scope?: string }) => Promise<void>;
  installSkills?: (packageRoot: string, opts: { scope?: string }) => Promise<void>;
  installPlugins?: (packageRoot: string, opts: { scope?: string }) => Promise<void>;
  installHooks?: (packageRoot: string, opts: { scope?: string }) => Promise<void>;
  loadCatalog?: () => unknown;
} = {}) {
  mock.module(new URL("../src/utils.js", import.meta.url), {
    namedExports: {
      LANGUAGES: [
        { value: "en", label: "English", file: "CLAUDE.md" },
        { value: "zh-CN", label: "中文", file: "CLAUDE.zh-CN.md" },
      ],
      exec: overrides.exec ?? (() => ""),
      fetchContentRoot: overrides.fetchContentRoot ?? (async () => process.cwd()),
      getPackageRoot: () => process.cwd(),
      isNonInteractive: overrides.isNonInteractive ?? (() => true),
      readPackageVersion: () => "0.0.0-test",
      // Shape mirrors the real `log` export (ok / warn / error / skip).
      // error + warn route to stderr so the test captureStderr() helper
      // sees them; ok + skip are no-ops because the non-interactive
      // code path under test doesn't assert on stdout.
      log: {
        ok: () => {},
        warn: (msg: string) => process.stderr.write(`${msg}\n`),
        error: (msg: string) => process.stderr.write(`${msg}\n`),
        skip: () => {},
      },
      withEsc: async <T>(prompt: Promise<T>) => prompt,
    },
  });
  mock.module(new URL("../src/catalog.js", import.meta.url), {
    namedExports: { loadCatalog: overrides.loadCatalog ?? (() => CATALOG) },
  });
  mock.module(new URL("../src/workflow.js", import.meta.url), {
    namedExports: { installWorkflow: overrides.installWorkflow ?? (async () => {}) },
  });
  mock.module(new URL("../src/skills.js", import.meta.url), {
    namedExports: {
      installSkills: overrides.installSkills ?? (async () => {}),
      installRecommendedSkills: async () => {},
    },
  });
  mock.module(new URL("../src/plugins.js", import.meta.url), {
    namedExports: { installPlugins: overrides.installPlugins ?? (async () => {}) },
  });
  mock.module(new URL("../src/hooks.js", import.meta.url), {
    namedExports: { installHooks: overrides.installHooks ?? (async () => {}) },
  });
  const mod = await import(new URL(`../src/cli.js?case=${importSerial++}`, import.meta.url).href);
  return mod.main;
}
afterEach(() => { mock.restoreAll(); });
// Covers spec §5.3.1 non-interactive entry, graded exits, and §11 non-TTY acceptance checks.
describe("main non-interactive install flow", () => {
  // Covers spec §3.4 and §11 "install with no args in non-TTY" fail-fast behavior.
  test("returns exit 1 and the non-TTY hint when install has no target", async () => {
    const main = await importMain();
    const { result, stderr } = await captureStderr(() => main(["install"]));
    assert.equal(result, 1);
    assert.match(stderr, /Interactive mode requires a TTY\. Run 'npx auriga-cli --help' for non-interactive options\./);
  });
  // Covers spec §5.3.1 precheck ordering and §11 "claude missing means exit 1 without touching files".
  test("fails precheck before fetch or installers when claude CLI is missing", async () => {
    const calls: string[] = [];
    let fetchCalls = 0;
    const main = await importMain({
      exec: (cmd) => {
        if (cmd === "which claude") throw new Error("missing");
        return "";
      },
      fetchContentRoot: async () => {
        fetchCalls += 1;
        return process.cwd();
      },
      installWorkflow: async () => {
        calls.push("workflow");
      },
      installSkills: async () => {
        calls.push("skills");
      },
      installPlugins: async () => {
        calls.push("plugins");
      },
      installHooks: async () => {
        calls.push("hooks");
      },
    });
    const { result, stderr } = await captureStderr(() => main(["install", "--all"]));
    assert.equal(result, 1);
    assert.equal(fetchCalls, 0);
    assert.deepEqual(calls, []);
    assert.match(stderr, /install Claude Code first|claude/i);
  });
  // Covers spec §5.3.1 graded exit 2, per-category stderr status, and retry hint generation.
  test("returns exit 2 with status lines and retry command when one category fails", async () => {
    const main = await importMain({
      installWorkflow: async () => {},
      installSkills: async () => {},
      installPlugins: async () => {
        throw new Error("claude CLI error: boom");
      },
      installHooks: async () => {},
    });
    const { result, stderr } = await captureStderr(() => main(["install", "--all"]));
    assert.equal(result, 2);
    assert.match(stderr, /\[OK\]\s+workflow/i);
    assert.match(stderr, /\[OK\]\s+skills/i);
    assert.match(stderr, /\[FAIL\]\s+plugins.*claude CLI error: boom/i);
    assert.match(stderr, /\[OK\]\s+hooks/i);
    assert.match(stderr, /Retry:\s+npx -y auriga-cli install plugins/i);
  });
  // Covers codex deep-review finding #1: install paths must fail-fast when
  // dist/catalog.json is missing (§7 / §11), not silently proceed. guide
  // and --version must NOT require the catalog — they're usable before
  // any build.
  test("install path fails fast with 'catalog missing' when catalog is gone", async () => {
    const main = await importMain({
      loadCatalog: () => {
        throw new Error("catalog missing at /x/dist/catalog.json. Run 'npm run build' or reinstall the package.");
      },
    });
    const { result, stderr } = await captureStderr(() => main(["install", "--all"]));
    assert.equal(result, 1);
    assert.match(stderr, /catalog missing/i);
  });
  test("guide and --version do NOT require the catalog", async () => {
    const main = await importMain({
      loadCatalog: () => {
        throw new Error("catalog missing at /x/dist/catalog.json. Run 'npm run build' or reinstall the package.");
      },
    });
    // guide prints to stdout (not captured by captureStderr) — we just
    // need exit 0, which proves the catalog wasn't touched.
    const guide = await captureStderr(() => main(["guide"]));
    assert.equal(guide.result, 0);
    const version = await captureStderr(() => main(["--version"]));
    assert.equal(version.result, 0);
  });
  // Covers the P2 regression from PR #31 codex review: retry hint for
  // `install --all --scope user` must preserve `--scope user`, otherwise
  // users following the hint silently install into the default project
  // scope and the intended user-scope install stays incomplete.
  // cli.ts forwards `opts.scope` straight through to installHooks as-is
  // (undefined / "project" / "user"); the two-value mapping to
  // "project-local" vs. "project" vs. "user" lives inside hooks.ts
  // (mapNonInteractiveScope — unit-tested in tests/hooks.test.ts). These
  // three tests lock down the cli forwarding contract only.
  test("hooks forwarding: install --all → installer sees scope undefined", async () => {
    const seen: { scope?: string }[] = [];
    const main = await importMain({
      installHooks: async (_root, opts) => {
        seen.push({ scope: opts.scope });
      },
    });
    const { result } = await captureStderr(() => main(["install", "--all"]));
    assert.equal(result, 0);
    assert.deepEqual(seen, [{ scope: undefined }]);
  });
  test("hooks forwarding: --scope project is passed through verbatim", async () => {
    const seen: { scope?: string }[] = [];
    const main = await importMain({
      installHooks: async (_root, opts) => {
        seen.push({ scope: opts.scope });
      },
    });
    const { result } = await captureStderr(() => main(["install", "--all", "--scope", "project"]));
    assert.equal(result, 0);
    assert.deepEqual(seen, [{ scope: "project" }]);
  });
  test("hooks forwarding: --scope user is passed through verbatim", async () => {
    const seen: { scope?: string }[] = [];
    const main = await importMain({
      installHooks: async (_root, opts) => {
        seen.push({ scope: opts.scope });
      },
    });
    const { result } = await captureStderr(() => main(["install", "--all", "--scope", "user"]));
    assert.equal(result, 0);
    assert.deepEqual(seen, [{ scope: "user" }]);
  });
  // `install hooks --scope user` (single-type) used to be rejected at parse
  // time. User manual-test feedback loosened rule 6 to let hooks take
  // --scope, so verify the single-category path now forwards scope too.
  test("hooks single-type: install hooks --scope user forwards scope", async () => {
    const seen: { scope?: string }[] = [];
    const main = await importMain({
      installHooks: async (_root, opts) => {
        seen.push({ scope: opts.scope });
      },
    });
    const { result } = await captureStderr(() =>
      main(["install", "hooks", "--scope", "user"]),
    );
    assert.equal(result, 0);
    assert.deepEqual(seen, [{ scope: "user" }]);
  });
  test("retry hint preserves --scope when runAll was invoked with non-default scope", async () => {
    const main = await importMain({
      installWorkflow: async () => {},
      installSkills: async () => {},
      installPlugins: async () => {
        throw new Error("boom");
      },
      installHooks: async () => {},
    });
    const { result, stderr } = await captureStderr(() =>
      main(["install", "--all", "--scope", "user"]),
    );
    assert.equal(result, 2);
    assert.match(stderr, /Retry:\s+npx -y auriga-cli install plugins --scope user/i);
  });
  // Covers spec §7 success-tail reload reminder and §11 full-install success acceptance.
  test("prints the reload reminder as the final stderr line on success", async () => {
    const main = await importMain({
      installWorkflow: async () => {},
      installSkills: async () => {},
      installPlugins: async () => {},
      installHooks: async () => {},
    });
    const { result, stderr } = await captureStderr(() => main(["install", "--all"]));
    const lastLine = stderr.trim().split(/\r?\n/).at(-1) ?? "";
    assert.equal(result, 0);
    assert.match(lastLine, /Reload your Claude Code session .* loaded at session startup/i);
  });
  // Partial success (exit 2) must still print the reload reminder —
  // categories that succeeded installed assets that require a session
  // reload. Without this hint the user may retry the failed category
  // and act on stale (pre-reload) state.
  test("partial success still prints the reload reminder alongside the retry hint", async () => {
    const main = await importMain({
      installWorkflow: async () => {},
      installSkills: async () => {},
      installPlugins: async () => {
        throw new Error("boom");
      },
      installHooks: async () => {},
    });
    const { result, stderr } = await captureStderr(() => main(["install", "--all"]));
    assert.equal(result, 2);
    assert.match(stderr, /Retry:\s+npx -y auriga-cli install plugins/i);
    assert.match(stderr, /Reload your Claude Code session/i);
  });
  // Conversely, a full failure (no category succeeded → nothing was
  // installed → nothing to reload) must NOT print the reload reminder.
  test("full failure suppresses the reload reminder", async () => {
    const main = await importMain({
      installWorkflow: async () => { throw new Error("w"); },
      installSkills: async () => { throw new Error("s"); },
      installPlugins: async () => { throw new Error("p"); },
      installHooks: async () => { throw new Error("h"); },
    });
    const { result, stderr } = await captureStderr(() => main(["install", "--all"]));
    assert.equal(result, 2);
    assert.doesNotMatch(stderr, /Reload your Claude Code session/i);
  });
});
