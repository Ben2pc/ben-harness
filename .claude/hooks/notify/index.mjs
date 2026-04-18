#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

if (process.platform !== "darwin") process.exit(0);

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SELF = fileURLToPath(import.meta.url);

const DEFAULTS = {
  icon: "./icon.png",
  sound: "Submarine",
  sender: null,
  activate: undefined,
  soundOnlyWhenFocused: true,
};

// alerter's `--sender` re-routes the notification through a specific
// app's bundle ID, which determines what notification permission and
// banner-style settings NotificationCenter applies. Pinning it to any
// concrete bundle is fragile: if that app isn't installed, has never
// been launched, has notification permission off, or has banner style
// set to "None", alerter silently exits 0 and nothing appears. Default
// to NOT passing `--sender` so the notification rides on alerter's own
// bundle, which Homebrew authorizes at install time. Users who want a
// specific app's icon at the small position can set `sender` in
// config.json — but `--app-icon` already lets you override that icon
// without the routing fragility, so most users won't need this.
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
      // `soundOnlyWhenFocused` downgrades to sound-only (no banner)
      // when the terminal that launched Claude is currently the
      // frontmost app — you're already looking at it, the banner is
      // visual noise. Default true. Set false to always show the
      // full banner regardless of focus.
      soundOnlyWhenFocused:
        typeof parsed.soundOnlyWhenFocused === "boolean"
          ? parsed.soundOnlyWhenFocused
          : DEFAULTS.soundOnlyWhenFocused,
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
function getSourceBundleId() {
  return process.env.__CFBundleIdentifier ?? null;
}

function resolveActivate(cfg, sourceBundle) {
  if (cfg.activate === false) return null;
  if (typeof cfg.activate === "string" && cfg.activate.length > 0) return cfg.activate;
  return sourceBundle;
}

// Returns the bundle ID of the currently frontmost macOS app, or null
// if osascript fails / times out / the user has denied "System Events"
// automation permission. We wrap the AppleScript in try/error so a
// permission denial returns "" instead of an exit-2 — failing open
// (caller treats null as "can't tell, just notify").
function getFrontmostBundleId() {
  const r = spawnSync(
    "osascript",
    [
      "-e", "try",
      "-e", "tell application \"System Events\" to bundle identifier of first application process whose frontmost is true",
      "-e", "on error",
      "-e", "\"\"",
      "-e", "end try",
    ],
    { encoding: "utf8", timeout: 1500 },
  );
  if (r.status !== 0) return null;
  const out = (r.stdout ?? "").trim();
  return out.length > 0 ? out : null;
}

// "Is the terminal that launched Claude currently the user's frontmost
// app?" Both inputs are bundle IDs (com.googlecode.iterm2,
// com.apple.Terminal, com.microsoft.VSCode, ...). Return false on any
// uncertainty so callers default to the louder behavior.
function isSourceFocused(sourceBundle) {
  if (!sourceBundle) return false;
  const front = getFrontmostBundleId();
  if (!front) return false;
  return front === sourceBundle;
}

// Play the configured sound without a banner. Searches user-installed
// sounds first (~/Library/Sounds), then falls back to the macOS system
// sound bank. Spawns afplay detached so we don't block the hook return.
// On miss (custom sound name with no matching file), no-op.
function playSoundOnly(soundName) {
  if (!soundName) return false;
  const home = process.env.HOME ?? "";
  const candidates = [];
  if (home) {
    candidates.push(path.join(home, "Library", "Sounds", `${soundName}.aiff`));
    candidates.push(path.join(home, "Library", "Sounds", `${soundName}.caf`));
  }
  candidates.push(`/System/Library/Sounds/${soundName}.aiff`);
  for (const candidate of candidates) {
    try {
      if (fs.statSync(candidate).isFile()) {
        const child = spawn("afplay", [candidate], {
          detached: true,
          stdio: "ignore",
        });
        child.unref();
        return true;
      }
    } catch {
      // not found; try next candidate
    }
  }
  return false;
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
    const sourceBundle = getSourceBundleId();
    const activate = resolveActivate(cfg, sourceBundle);

    // Focus-aware downgrade: when the launching terminal is the
    // frontmost app, the user is already looking at the conversation —
    // a banner is just visual noise. Drop to sound-only via afplay.
    // AURIGA_NOTIFY_FORCE=1 (set by test.mjs) bypasses this so manual
    // smoke tests always show the full banner.
    const forceFull = process.env.AURIGA_NOTIFY_FORCE === "1";
    if (cfg.soundOnlyWhenFocused && !forceFull && isSourceFocused(sourceBundle)) {
      playSoundOnly(cfg.sound);
      return;
    }

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
