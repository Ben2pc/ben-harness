# notify hook

Fires a native macOS notification (banner + sound) whenever Claude Code
emits a `Notification` event — permission prompts, idle input waits — so
you get pulled back to the terminal without having to watch it.

## Customize

Edit `config.json` next to this README:

```json
{
  "icon": "./icon.png",
  "sound": "Submarine"
}
```

- **`sound`** — any macOS built-in sound name (case-sensitive):
  `Basso`, `Blow`, `Bottle`, `Frog`, `Funk`, `Glass`, `Hero`, `Morse`,
  `Ping`, `Pop`, `Purr`, `Sosumi`, `Submarine`, `Tink`. You can also
  drop a `.aiff` or `.caf` into `~/Library/Sounds/` and reference it by
  filename without the extension.
- **`icon`** — relative to this directory (default `./icon.png`) or an
  absolute path. Replace `icon.png` with any 512×512 PNG to brand it
  yourself; the file is never overwritten by re-running the installer.
- **`sender`** *(optional, advanced)* — bundle ID of a macOS app whose
  notification permission and small title icon `terminal-notifier`
  should piggy-back on (e.g. `"com.apple.Terminal"`,
  `"com.googlecode.iterm2"`, `"com.mitchellh.ghostty"`). Default is
  unset, which routes through `terminal-notifier`'s own bundle — the
  most reliable path because brew authorized it at install time. Only
  set this if you specifically want a different small icon next to the
  title; the prominent brand image always comes from `icon.png`. Setting
  this to a bundle whose notification permission, banner style, or
  Focus settings are misconfigured will silently swallow notifications.
- **`activate`** *(optional)* — bundle ID of the app to bring to the
  foreground when you click the banner. **By default the hook
  auto-detects** the terminal Claude Code is running in via the
  `$__CFBundleIdentifier` env var that macOS Launch Services injects
  into every descendant of an app it launched, so clicking the banner
  takes you straight back to the terminal that asked for attention —
  Apple Terminal, iTerm2, Ghostty, Warp, VS Code's integrated terminal,
  whatever — with no mapping table to maintain. Set this to a string to
  force a specific app (e.g. `"com.microsoft.VSCode"` to always jump to
  VS Code), or to `false` to opt out entirely (banner is purely
  informational, click does nothing).

The hook is macOS-only at runtime. On other platforms it exits silently
without doing anything, so it's safe to commit into a repo shared with a
cross-platform team if you registered it in `.claude/settings.json`.

## Test it

After editing `config.json` or replacing `icon.png`, fire a fake
`Notification` event end-to-end without waiting for Claude:

```bash
node .claude/hooks/notify/test.mjs
```

This invokes `index.mjs` exactly the way Claude Code would, so what you
see + hear is what you'll get in real use.

**No sound but the banner shows up?** macOS's *alert volume* is
independent from the main volume slider. Open **System Settings → Sound
→ Alert volume** and make sure it isn't at zero — that's the most
common cause. Other suspects: Focus / Do Not Disturb mode, or the
notification permission for your terminal app being set to "None" in
**System Settings → Notifications**.

## How it works

`index.mjs` reads the `Notification` event payload from stdin, looks up
`terminal-notifier` (auto-installed by the auriga-cli installer via
Homebrew), and shows a banner. If `terminal-notifier` is missing it falls
back to `osascript`, which still produces a banner + sound but cannot
show the brand icon.

## Re-installing

Re-running `npx auriga-cli` and re-selecting this hook will:

- Overwrite `index.mjs`, `test.mjs`, and this `README.md` (the runtime, smoke test, and docs).
- Preserve `config.json` and `icon.png` (your customizations).
- Skip duplicate entries in `settings.json` / `settings.local.json`.
