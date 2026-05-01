import assert from "node:assert/strict";
import { describe, test } from "node:test";
import path from "node:path";

import type { Catalog, CatalogEntry } from "../src/catalog.js";
import { loadCatalog } from "../src/catalog.js";
import { generateCatalog } from "../src/build/generate-catalog.js";

// Covers spec §5.4 "Catalog 生成"

const REPO_ROOT = path.resolve(new URL(".", import.meta.url).pathname, "..", "..");

function assertEntriesShape(entries: CatalogEntry[], label: string): void {
  for (const e of entries) {
    assert.ok(
      typeof e.name === "string" && e.name.length > 0,
      `${label}: name must be non-empty string (got ${JSON.stringify(e)})`,
    );
    assert.ok(
      typeof e.description === "string" && e.description.length > 0,
      `${label}: description must be non-empty string (got ${JSON.stringify(e)})`,
    );
  }
}

describe("generateCatalog (build-time)", () => {
  const catalog: Catalog = generateCatalog(REPO_ROOT);

  test("catalog has all four top-level sections", () => {
    assert.ok(Array.isArray(catalog.workflowSkills));
    assert.ok(Array.isArray(catalog.recommendedSkills));
    assert.ok(Array.isArray(catalog.plugins));
    assert.ok(Array.isArray(catalog.hooks));
    assert.ok(typeof catalog.generatedAt === "string" && catalog.generatedAt.length > 0);
  });

  test("workflow skills: 9 entries matching WORKFLOW_SKILLS", () => {
    assert.equal(catalog.workflowSkills.length, 9);
    const names = catalog.workflowSkills.map((e) => e.name).sort();
    assert.deepEqual(names, [
      "brainstorming",
      "deep-review",
      "parallel-implementation",
      "planning-with-files",
      "playwright-cli",
      "systematic-debugging",
      "test-designer",
      "test-driven-development",
      "verification-before-completion",
    ]);
    assertEntriesShape(catalog.workflowSkills, "workflowSkills");
  });

  test("recommended skills: 2 entries (claude-code-agent, codex-agent)", () => {
    assert.equal(catalog.recommendedSkills.length, 2);
    const names = catalog.recommendedSkills.map((e) => e.name).sort();
    assert.deepEqual(names, ["claude-code-agent", "codex-agent"]);
    assertEntriesShape(catalog.recommendedSkills, "recommendedSkills");
  });

  test("plugins: 4 entries with manually-authored descriptions", () => {
    assert.equal(catalog.plugins.length, 4);
    const names = catalog.plugins.map((e) => e.name).sort();
    assert.deepEqual(names, [
      "auriga-go",
      "claude-md-management",
      "codex",
      "skill-creator",
    ]);
    assertEntriesShape(catalog.plugins, "plugins");
  });

  test("hooks: 3 entries", () => {
    assert.equal(catalog.hooks.length, 3);
    const names = catalog.hooks.map((e) => e.name).sort();
    assert.deepEqual(names, ["notify", "pr-create-guard", "pr-ready-guard"]);
    assertEntriesShape(catalog.hooks, "hooks");
  });

  test("descriptions survive YAML escaped quotes (parallel-implementation)", () => {
    const pi = catalog.workflowSkills.find((e) => e.name === "parallel-implementation");
    assert.ok(pi);
    assert.match(pi.description, /parallel subagents/);
    // parallel-implementation description contains escaped quotes: isolation: \"worktree\"
    assert.match(pi.description, /isolation/);
  });
});

describe("loadCatalog", () => {
  test("reads catalog.json from packageRoot/dist/catalog.json", () => {
    // This runs only after `npm run build` generated dist/catalog.json.
    // If the file is missing, loadCatalog should throw with a clear message.
    const catalog = loadCatalog(REPO_ROOT);
    assert.ok(catalog.workflowSkills.length > 0);
    assert.ok(catalog.plugins.length > 0);
  });

  test("throws a clear error when dist/catalog.json is missing", () => {
    const missingRoot = "/tmp/does-not-exist-catalog-root-" + Date.now();
    assert.throws(
      () => loadCatalog(missingRoot),
      /catalog missing/i,
    );
  });
});
