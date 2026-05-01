import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { planSkillInstallCommands } from "../src/skills.js";
import type { SkillsLock } from "../src/utils.js";

// Typed as the real SkillsLock["skills"] shape so schema drift in
// SkillEntry (new required fields, etc.) surfaces here as a compile error.
const stub = (source: string) => ({
  source,
  sourceType: "github",
  computedHash: "x",
});

const LOCK: SkillsLock["skills"] = {
  brainstorming: stub("obra/superpowers"),
  "systematic-debugging": stub("obra/superpowers"),
  "test-driven-development": stub("obra/superpowers"),
  "verification-before-completion": stub("obra/superpowers"),
  "deep-review": stub("Ben2pc/g-claude-code-plugins"),
  "test-designer": stub("Ben2pc/g-claude-code-plugins"),
  "parallel-implementation": stub("Ben2pc/g-claude-code-plugins"),
  "planning-with-files": stub("OthmanAdi/planning-with-files"),
  "playwright-cli": stub("microsoft/playwright-cli"),
};

describe("planSkillInstallCommands", () => {
  test("single source, single skill → one command with npx -y", () => {
    const batches = planSkillInstallCommands(["brainstorming"], LOCK, "");
    assert.equal(batches.length, 1);
    assert.equal(batches[0].source, "obra/superpowers");
    assert.deepEqual(batches[0].skills, ["brainstorming"]);
    assert.match(batches[0].command, /^npx -y skills add /);
    assert.match(batches[0].command, / --skill brainstorming /);
    assert.match(batches[0].command, / --agent claude-code codex /);
    assert.match(batches[0].command, / --yes$/);
  });

  test("single source, multiple skills → merged --skill list, space-separated", () => {
    const batches = planSkillInstallCommands(
      ["brainstorming", "systematic-debugging", "test-driven-development"],
      LOCK,
      "",
    );
    assert.equal(batches.length, 1);
    assert.equal(batches[0].source, "obra/superpowers");
    assert.deepEqual(batches[0].skills, [
      "brainstorming",
      "systematic-debugging",
      "test-driven-development",
    ]);
    assert.match(
      batches[0].command,
      / --skill brainstorming systematic-debugging test-driven-development /,
    );
  });

  test("multiple sources → one batch per source, grouping is stable", () => {
    const batches = planSkillInstallCommands(
      [
        "brainstorming",
        "deep-review",
        "systematic-debugging",
        "test-designer",
        "planning-with-files",
      ],
      LOCK,
      "",
    );
    assert.equal(batches.length, 3);
    const bySource = Object.fromEntries(batches.map((b) => [b.source, b.skills]));
    assert.deepEqual(bySource["obra/superpowers"], [
      "brainstorming",
      "systematic-debugging",
    ]);
    assert.deepEqual(bySource["Ben2pc/g-claude-code-plugins"], [
      "deep-review",
      "test-designer",
    ]);
    assert.deepEqual(bySource["OthmanAdi/planning-with-files"], [
      "planning-with-files",
    ]);
  });

  test("every distinct source yields one batch", () => {
    const batches = planSkillInstallCommands(Object.keys(LOCK), LOCK, "");
    assert.equal(batches.length, 4); // 4 distinct sources in LOCK
  });

  test("globalFlag threads into every command", () => {
    const batches = planSkillInstallCommands(
      ["brainstorming", "deep-review"],
      LOCK,
      " -g",
    );
    for (const b of batches) {
      assert.match(b.command, new RegExp(` ${b.source} -g `));
    }
  });

  test("no globalFlag → no trailing -g in the source slot", () => {
    const batches = planSkillInstallCommands(["brainstorming"], LOCK, "");
    assert.doesNotMatch(batches[0].command, / -g /);
  });

  test("unknown skill name is ignored (defensive — caller filters first, but planner must not crash)", () => {
    const batches = planSkillInstallCommands(
      ["brainstorming", "not-a-real-skill"],
      LOCK,
      "",
    );
    // Only the known skill survives; no throw.
    assert.equal(batches.length, 1);
    assert.deepEqual(batches[0].skills, ["brainstorming"]);
  });

  test("empty selection → empty plan", () => {
    assert.deepEqual(planSkillInstallCommands([], LOCK, ""), []);
  });
});
