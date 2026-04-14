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

The hook is macOS-only at runtime. On other platforms it exits silently
without doing anything, so it's safe to commit into a repo shared with a
cross-platform team if you registered it in `.claude/settings.json`.

## How it works

`index.mjs` reads the `Notification` event payload from stdin, looks up
`terminal-notifier` (auto-installed by the auriga-cli installer via
Homebrew), and shows a banner. If `terminal-notifier` is missing it falls
back to `osascript`, which still produces a banner + sound but cannot
show the brand icon.

## Re-installing

Re-running `npx auriga-cli` and re-selecting this hook will:

- Overwrite `index.mjs` and this `README.md` (the runtime and docs).
- Preserve `config.json` and `icon.png` (your customizations).
- Skip duplicate entries in `settings.json` / `settings.local.json`.
