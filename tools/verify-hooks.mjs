#!/usr/bin/env node
/**
 * End-to-end verification driver for the Hooks install module.
 *
 * Exercises src/hooks.ts non-interactively against a scratch directory,
 * then asserts file bytes, settings.local.json shape, idempotency, and
 * preserveFiles semantics. Runs the installed hook through stdin to
 * confirm the runtime fires.
 *
 * Usage:
 *     npm run build && node tools/verify-hooks.mjs
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import path from "node:path";

import { installHook, loadHooksConfig } from "../dist/hooks.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TEST_PROJECT = "/tmp/test-auriga-hooks";

let pass = 0;
let fail = 0;
function check(name, ok, detail = "") {
  if (ok) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}${detail ? " — " + detail : ""}`);
  }
}

function rmrf(p) {
  if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
}

function readBuf(p) {
  return fs.readFileSync(p);
}

async function run() {
  console.log(`Verifying Hooks installer end-to-end → ${TEST_PROJECT}\n`);

  rmrf(TEST_PROJECT);
  fs.mkdirSync(TEST_PROJECT, { recursive: true });

  const config = loadHooksConfig(REPO_ROOT);
  const notify = config.hooks.find((h) => h.name === "notify");
  if (!notify) throw new Error("notify hook missing from registry");

  console.log("--- Phase 1: fresh install (project-local scope) ---");
  const r1 = await installHook(notify, "project-local", TEST_PROJECT, REPO_ROOT);

  check("hook directory created", fs.existsSync(r1.hookDir));
  for (const f of notify.files) {
    check(
      `${f} present`,
      fs.existsSync(path.join(r1.hookDir, f)),
      path.join(r1.hookDir, f),
    );
  }
  check(
    "icon.png byte-identical to source",
    Buffer.compare(
      readBuf(path.join(REPO_ROOT, ".claude/hooks/notify/icon.png")),
      readBuf(path.join(r1.hookDir, "icon.png")),
    ) === 0,
  );
  check(
    "settings.local.json written",
    fs.existsSync(r1.settingsPath),
  );
  check("settings was mutated on first run", r1.settingsMutated === true);
  check("written count == files.length", r1.written === notify.files.length);
  check("preserved count == 0 on fresh install", r1.preserved === 0);

  const settings1 = JSON.parse(fs.readFileSync(r1.settingsPath, "utf8"));
  const groups1 = settings1?.hooks?.Notification ?? [];
  check("Notification array has 1 group", groups1.length === 1);
  const action1 = groups1[0]?.hooks?.[0];
  check("group entry has _marker == auriga:notify", action1?._marker === "auriga:notify");
  check("group entry uses $CLAUDE_PROJECT_DIR", action1?.command?.includes("$CLAUDE_PROJECT_DIR"));
  check("group entry points at index.mjs", action1?.command?.includes("notify/index.mjs"));
  check(
    "no other settings keys touched",
    Object.keys(settings1).every((k) => k === "hooks"),
  );

  console.log("\n--- Phase 2: customize then re-run (preserve + idempotent) ---");
  const userIcon = Buffer.from("USER_CUSTOM_ICON_BYTES_FOR_TEST_PURPOSES_ONLY");
  fs.writeFileSync(path.join(r1.hookDir, "icon.png"), userIcon);
  const userConfig = JSON.stringify({ icon: "./icon.png", sound: "Hero" }, null, 2);
  fs.writeFileSync(path.join(r1.hookDir, "config.json"), userConfig);

  const r2 = await installHook(notify, "project-local", TEST_PROJECT, REPO_ROOT);

  check("settings NOT mutated on re-run (idempotent)", r2.settingsMutated === false);
  check(
    "preserved count == 2 (config.json + icon.png)",
    r2.preserved === 2,
    `actual: ${r2.preserved}`,
  );
  check(
    "user icon.png preserved byte-identical",
    Buffer.compare(readBuf(path.join(r2.hookDir, "icon.png")), userIcon) === 0,
  );
  check(
    "user config.json preserved",
    fs.readFileSync(path.join(r2.hookDir, "config.json"), "utf8") === userConfig,
  );

  const settings2 = JSON.parse(fs.readFileSync(r2.settingsPath, "utf8"));
  const groups2 = settings2?.hooks?.Notification ?? [];
  check(
    "Notification array still has exactly 1 group after re-run",
    groups2.length === 1,
    `actual: ${groups2.length}`,
  );

  console.log("\n--- Phase 3: settings.json with sibling keys is not clobbered ---");
  // pre-seed a settings.local.json with another key
  const customSettings = {
    enabledPlugins: { "fake@market": true },
    someUnrelatedKey: "preserve me",
  };
  fs.writeFileSync(r2.settingsPath, JSON.stringify(customSettings, null, 2));
  const r3 = await installHook(notify, "project-local", TEST_PROJECT, REPO_ROOT);
  const settings3 = JSON.parse(fs.readFileSync(r3.settingsPath, "utf8"));

  check("install added Notification entry to pre-existing settings", r3.settingsMutated === true);
  check(
    "enabledPlugins preserved",
    JSON.stringify(settings3.enabledPlugins) === JSON.stringify(customSettings.enabledPlugins),
  );
  check("someUnrelatedKey preserved", settings3.someUnrelatedKey === "preserve me");
  check("Notification group present", (settings3.hooks?.Notification ?? []).length === 1);

  console.log("\n--- Phase 4: installed runtime fires ---");
  const installedScript = path.join(r3.hookDir, "index.mjs");
  const proc = spawnSync("node", [installedScript], {
    input: JSON.stringify({
      hook_event_name: "Notification",
      title: "auriga-cli verify",
      message: "end-to-end check",
      notification_type: "permission_prompt",
    }),
    encoding: "utf8",
  });
  check("installed index.mjs runs without error", proc.status === 0, proc.stderr || "");

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
