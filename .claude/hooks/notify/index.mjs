#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

if (process.platform !== "darwin") process.exit(0);

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SELF = fileURLToPath(import.meta.url);

const DEFAULTS = { icon: "./icon.png", sound: "Submarine", sender: null, activate: undefined };

// terminal-notifier's `-sender` re-routes the notification through a
// specific app's bundle ID — for both the small icon next to the title
// AND the notification permission NotificationCenter consults. Pinning
// it to any concrete bundle is fragile: if that app isn't installed,
// has never been launched, has notification permission off, or has
// banner style set to "None", terminal-notifier silently exits 0 and
// nothing appears. Default to NOT passing `-sender` so the notification
// rides on terminal-notifier's own bundle, which the Homebrew install
// authorizes at first launch and which always works. Users who want a
// specific app icon next to the title can set `sender` in config.json.
function loadConfig() {
  try {
    const raw = fs.readFileSync(path.join(HERE, "config.json"), "utf8");
    const parsed = JSON.parse(raw);
    return {
      icon: typeof parsed.icon === "string" ? parsed.icon : DEFAULTS.icon,
      sound: typeof parsed.sound === "string" ? parsed.sound : DEFAULTS.sound,
      sender:
        typeof parsed.sender === "string" && parsed.sender.length > 0
          ? parsed.sender
          : DEFAULTS.sender,
      // `activate` accepts a bundle ID string, `false` to opt out of
      // click-to-activate entirely, or undefined for auto-detect.
      activate:
        parsed.activate === false || typeof parsed.activate === "string"
          ? parsed.activate
          : DEFAULTS.activate,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

// macOS Launch Services injects $__CFBundleIdentifier into every
// descendant of an app it launched, so a hook spawned from Claude Code
// → spawned from the user's terminal receives the *exact* bundle ID of
// the terminal — no mapping table to maintain. Wrong/missing → click is
// a no-op (banner + sound still fire), so this is safe to enable by
// default. Users on weird launch chains (ssh, launchd, cron) can pin
// `activate` in config.json or set it to `false` to opt out.
function resolveActivate(cfg) {
  if (cfg.activate === false) return null;
  if (typeof cfg.activate === "string" && cfg.activate.length > 0) return cfg.activate;
  return process.env.__CFBundleIdentifier ?? null;
}

function resolveIcon(iconPath) {
  if (!iconPath) return null;
  const abs = path.isAbsolute(iconPath) ? iconPath : path.join(HERE, iconPath);
  return fs.existsSync(abs) ? abs : null;
}

// Detached worker mode (re-invocation of this script). Reads a JSON job
// blob from argv, runs alerter to completion (synchronously, since
// alerter blocks until click or --timeout), and on click activates the
// resolved bundle via osascript. The main hook process spawns this
// worker `detached: true, stdio: "ignore"` and exits immediately so
// Claude Code is never blocked waiting on a notification banner.
//
// alerter contract (verified against v26.5):
//   - blocks until user interacts OR --timeout fires
//   - prints "@CONTENTCLICKED" to stdout when the banner content is clicked
//   - prints "@TIMEOUT" / "@CLOSED" / "@ACTIONCLICKED" for other outcomes
// We only react to @CONTENTCLICKED; everything else is a no-op exit.
if (process.argv[2] === "--alerter-worker") {
  try {
    const job = JSON.parse(process.argv[3]);
    const result = spawnSync(job.bin, job.args, { encoding: "utf8" });
    if (
      result.status === 0 &&
      typeof result.stdout === "string" &&
      result.stdout.includes("@CONTENTCLICKED") &&
      job.activate
    ) {
      spawnSync("osascript", [
        "-e",
        `tell application id "${job.activate}" to activate`,
      ]);
    }
  } catch {
    // worker failures are silent — never bubble up to Claude Code
  }
  process.exit(0);
}

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  try {
    const cfg = loadConfig();
    const iconAbs = resolveIcon(cfg.icon);

    const data = JSON.parse(input);
    const title = String(data.title || "Claude Code");
    const message = String(data.message || "");
    const subtitle = data.notification_type ? String(data.notification_type) : "";
    const activate = resolveActivate(cfg);

    // Backend preference: alerter > osascript.
    //
    // alerter wins because its --app-icon flag lets us replace the
    // small top-left app icon with the Auriga brand mark — the only
    // backend that can do that. Cost: alerter blocks until click or
    // --timeout, so we dispatch it through a detached worker and the
    // worker reads its stdout for the click signal.
    //
    // osascript is the fallback when alerter isn't installed (e.g.
    // brew tap install failed, or the user is running this hook in a
    // project that hasn't been re-installed via the auriga-cli
    // installer). It's always present on macOS but can't show a
    // custom icon and can't activate an app on click.
    const al = spawnSync("which", ["alerter"], { encoding: "utf8" });
    if (al.status === 0 && al.stdout.trim()) {
      const args = [
        "--title", title,
        "--message", message,
        "--sound", cfg.sound,
        "--timeout", "30",
      ];
      if (subtitle) args.push("--subtitle", subtitle);
      // Only --app-icon, not --content-image. macOS notifications
      // would otherwise show the same Auriga mark twice (small +
      // large) — visual noise. The small position is the one that
      // identifies "who sent this", which is what we care about.
      if (iconAbs) args.push("--app-icon", iconAbs);
      if (cfg.sender) args.push("--sender", cfg.sender);

      const job = JSON.stringify({ bin: "alerter", args, activate });
      const child = spawn(process.execPath, [SELF, "--alerter-worker", job], {
        detached: true,
        stdio: "ignore",
      });
      child.unref();
      return;
    }

    const displayTitle = subtitle ? `${title} · ${subtitle}` : title;
    const escape = (s) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    const script = `display notification "${escape(message)}" with title "${escape(displayTitle)}" sound name "${escape(cfg.sound)}"`;
    spawnSync("osascript", ["-e", script], { stdio: "ignore" });
  } catch {
    // swallow — never block Claude on notification failures
  }
});
