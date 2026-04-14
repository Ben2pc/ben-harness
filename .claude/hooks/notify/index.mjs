#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

if (process.platform !== "darwin") process.exit(0);

const HERE = path.dirname(fileURLToPath(import.meta.url));

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

// terminal-notifier's `-activate` brings the named app to the foreground
// when the user clicks the banner. Auto-detect from $__CFBundleIdentifier:
// macOS Launch Services injects this env var into every descendant of an
// app it launched, so a hook spawned from Claude Code → spawned from
// Terminal/iTerm/Ghostty/Warp/... receives the *exact* bundle ID of the
// terminal, with no mapping table to maintain. Wrong/missing → click is a
// no-op (banner + sound still work), so this is safe to enable by default.
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

    const tn = spawnSync("which", ["terminal-notifier"], { encoding: "utf8" });
    if (tn.status === 0 && tn.stdout.trim()) {
      const args = [
        "-title", title,
        "-message", message,
        "-sound", cfg.sound,
      ];
      if (cfg.sender) args.push("-sender", cfg.sender);
      const activate = resolveActivate(cfg);
      if (activate) args.push("-activate", activate);
      if (subtitle) args.push("-subtitle", subtitle);
      if (iconAbs) args.push("-contentImage", iconAbs);
      spawnSync("terminal-notifier", args, { stdio: "ignore" });
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
