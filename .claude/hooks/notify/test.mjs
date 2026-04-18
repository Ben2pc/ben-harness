#!/usr/bin/env node
// Manual smoke test for the notify hook.
//
// Fires a fake `Notification` payload at index.mjs the same way Claude
// Code would, so you can verify your customized `config.json` (sound)
// and `icon.png` actually fire after editing them. Run from anywhere:
//
//     node /path/to/.claude/hooks/notify/test.mjs
//
// or, if your project is the cwd:
//
//     node .claude/hooks/notify/test.mjs
//
// The script does not duplicate any of the hook logic — it just invokes
// index.mjs over stdin, exactly the way Claude Code does at runtime.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ENTRY = path.join(HERE, "index.mjs");

const payload = JSON.stringify({
  hook_event_name: "Notification",
  title: "auriga notify test",
  message: "If you see this banner AND hear the sound, your config works.",
  notification_type: "manual_test",
});

// AURIGA_NOTIFY_FORCE=1 bypasses the focus check so the banner shows
// even if you're staring at the terminal you ran the test from. Without
// it, a focused terminal would only get the sound — which can read as
// "the test failed" when it's actually working as designed.
const child = spawn("node", [ENTRY], {
  stdio: ["pipe", "inherit", "inherit"],
  env: { ...process.env, AURIGA_NOTIFY_FORCE: "1" },
});
child.stdin.write(payload);
child.stdin.end();

child.on("exit", (code) => {
  if (code !== 0) {
    console.error(`✗ notify hook exited with code ${code}`);
    process.exit(code ?? 1);
  }
  console.log("✓ notify fired. Now check:");
  console.log("  • Banner shown?  if not → System Settings → Notifications → your terminal app");
  console.log("  • Sound heard?   if not → System Settings → Sound → Alert volume");
  console.log("                   (alert volume is INDEPENDENT from the main volume slider)");
  console.log("  • Brand icon?    if not → check config.json `icon` points to a real PNG");
});
