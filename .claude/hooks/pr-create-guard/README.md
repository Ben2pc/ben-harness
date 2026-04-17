# pr-create-guard

**PostToolUse** hook that fires after `gh pr create` and injects a factual snapshot of the new PR's body for the Agent to self-verify against the step-10 PR-description contract.

## What it does

Runs only when the matched tool is `Bash` and its command contains `gh pr create`. For any other tool / command the hook exits 0 silently.

On a successful `gh pr create`:

1. Extracts the PR URL (e.g. `https://github.com/owner/repo/pull/N`) from the tool's output.
2. Runs `gh pr view <url> --json body` to fetch the real body.
3. Scans for `^##` / `^###` markdown headings.
4. Counts `- [ ]` (unchecked) and `- [x]` (checked) checkboxes.
5. Returns `hookSpecificOutput.additionalContext` — a compact snapshot the Agent sees on its next turn.

On failure (gh returned non-zero, URL not extractable, gh unavailable / unauthenticated), the hook falls back to a passive nudge — never crashes, never blocks.

## Dispatch

The registry declares `matcher: "Bash"` + `if: "Bash(gh pr create)"`, so Claude Code ≥ 2026-04 skips the subprocess spawn entirely on non-matching calls. The script also does the substring check internally for compatibility with older runtimes.

## Why PostToolUse (not PreToolUse)

Running *after* the tool lets us query the real PR state via `gh pr view`. The PreToolUse alternative requires parsing `gh pr create`'s free-form command line (tokenizer + heredoc handling + `--body` / `-b` / `--body-file` / `--template` source resolution), which is brittle and produces false positives on exotic body sources.

PostToolUse trades a short-lived "maybe-empty" PR for a factual body snapshot. The Agent can `gh pr edit` to fix anything the snapshot surfaces.

## Design principles

1. **Never block.** PostToolUse runs after the fact; blocking just rejects the tool's return value, which isn't useful here.
2. **Report facts, never diagnose.** The hook lists headings found and checkbox counts — it does **not** say "you are missing `## Summary`". The Agent holds the scope / acceptance / risks / TODO contract and compares for itself.
3. **Graceful degradation.** If gh is missing, un-authed, or the PR URL can't be extracted, the hook still injects a short reminder — it just doesn't claim to know the body content.

## Test

```bash
node .claude/hooks/pr-create-guard/test.mjs
```

Covers 6 smoke cases: non-Bash tool ignored, non-matching commands pass through, gh-failure ignored, URL-less success falls back, URL-present success attempts fetch (and falls back gracefully when the URL isn't fetchable in the test env). The happy-path body-snapshot is exercised end-to-end by the worktree-isolated verification agent before PR Ready-for-Review.

## Limits

- **Platform:** `darwin`, `linux`. Windows untested.
- **PR URL detection** looks for `github.com/.../pull/N` in tool output. If gh is configured to suppress URL output (rare), the hook falls back to the passive nudge.
- **Timeout:** `gh pr view` is called with a 5-second timeout; slow network → passive nudge, not a crash.
