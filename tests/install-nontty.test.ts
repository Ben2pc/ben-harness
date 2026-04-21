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
      log: {
        error: (msg: string) => process.stderr.write(`${msg}\n`),
        warn: (msg: string) => process.stderr.write(`${msg}\n`),
        info: () => {},
        success: () => {},
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
  // Covers codex deep-review finding #2: hooks' non-interactive scope map
  // must distinguish "user didn't pass --scope" (→ project-local, matching
  // the interactive default) from "user explicitly passed --scope project"
  // (→ project, i.e. .claude/settings.json, the SHARED config). The prior
  // wiring collapsed both cases to project-local, so `install --all --scope
  // project` silently wrote to settings.local.json and users who shipped
  // the repo expecting teammates to pick up the hook got nothing.
  test("hooks scope: undefined → installer sees undefined (hooks maps to project-local)", async () => {
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
  test("hooks scope: --scope project → installer sees 'project' (not 'project-local')", async () => {
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
  test("hooks scope: --scope user → installer sees 'user'", async () => {
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
});
