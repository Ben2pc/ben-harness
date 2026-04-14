#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

if (process.platform !== "darwin") process.exit(0);

const HERE = path.dirname(fileURLToPath(import.meta.url));

const DEFAULTS = { icon: "./icon.png", sound: "Submarine", sender: null };

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
    };
  } catch {
    return { ...DEFAULTS };
  }
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
