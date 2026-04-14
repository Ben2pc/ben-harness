#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

if (process.platform !== "darwin") process.exit(0);

const HERE = path.dirname(fileURLToPath(import.meta.url));

const DEFAULTS = { icon: "./icon.png", sound: "Submarine" };

function loadConfig() {
  try {
    const raw = fs.readFileSync(path.join(HERE, "config.json"), "utf8");
    const parsed = JSON.parse(raw);
    return {
      icon: typeof parsed.icon === "string" ? parsed.icon : DEFAULTS.icon,
      sound: typeof parsed.sound === "string" ? parsed.sound : DEFAULTS.sound,
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
        "-sender", "com.apple.Terminal",
      ];
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
