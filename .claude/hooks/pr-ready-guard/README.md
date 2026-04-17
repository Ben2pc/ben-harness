# pr-ready-guard

**PreToolUse** hook that intercepts `gh pr ready` and blocks the Draft → Ready state flip on structural problems that would make the PR misleading to reviewers.

## What it does

Runs only when the matched tool is `Bash` and its command contains `gh pr ready`. For any other tool / command the hook exits 0 silently.

### Hard block (exit 2) — structural signals only

Checks run in fixed order; the first to fire is the reason the Agent sees:

1. **Stray planning docs** — any of `findings.md`, `progress.md`, `task_plan.md` at repo root, OR any `*.md` under `docs/superpowers/specs/`. Per the `Document Conventions` section of `CLAUDE.md`, these are session-ephemeral and must be archived to `docs/worklog-<YYYY-MM-DD>-<branch-name>/` (or deleted) before marking ready.
2. **Unpushed commits** — `git rev-list --count @{u}..HEAD` > 0. The remote-side PR can't reflect what isn't pushed yet, so marking ready would misrepresent the diff. If the branch has no tracking upstream (rev-list errors), this check silently skips — brand-new unpushed branches aren't flagged.

Both signals are verifiable from filesystem or git state alone. The hook never inspects PR body text to decide whether to block (no text regex).

### Filter (additionalContext) — no block

When all block checks pass, the hook fetches the real PR body via `gh pr view --json body`, scans for `^##` / `^###` headings, counts `- [ ]` / `- [x]` checkboxes, and injects a snapshot. The Agent sees the snapshot on its next turn and can compare against its own understanding of what the PR should claim.

If gh is missing / unauthenticated / times out, the hook exits 0 silently — no crash, no false block.

## Dispatch

The registry declares `matcher: "Bash"` + `if: "Bash(gh pr ready)"`, so Claude Code ≥ 2026-04 skips the subprocess spawn entirely on non-matching calls. The script also does the substring check internally for compatibility with older runtimes.

## Design principles

1. **Block only on structural signals.** File existence and git-status diffs are binary facts; text-content "is the body good enough" is judgment, which belongs to the Agent, not to a regex in a hook.
2. **Filter-first mindset.** The blocks are escape valves for the two cases where proceeding would visibly mislead reviewers. Everything else goes through the filter.
3. **Graceful degradation.** Unrecognized git state or missing gh tooling → silent pass, not spurious block.

## Test

```bash
node .claude/hooks/pr-ready-guard/test.mjs
```

Covers 7 smoke cases: pass-through for non-matching commands, stray-doc blocks for each path (root files + spec glob), archived-worklog copies correctly excluded, and clean-repo pass-through. The live gh-fetch happy path is exercised end-to-end by the worktree-isolated verification agent before the PR is marked ready.

## Limits

- **Platform:** `darwin`, `linux`. Windows untested.
- **PR number extraction** only catches the positional form `gh pr ready <N>`. When omitted, the hook relies on `gh pr view` auto-picking the current branch's PR.
- **Upstream-less branches** skip the unpushed-commit check (rev-list errors). Tracking upstream must exist for the check to fire.
