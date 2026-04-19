# auriga-go ship mode (Experimental)

> ⚠️ **Experimental.** Opt in explicitly. Read this file before invoking.

ship drives an existing spec to a PR Ready candidate without per-step user prompts. Use for small-scope feature development or prototyping for non-technical collaborators.

## How the loop runs

ship is **hook-backed**, not self-policed. A Stop hook bundled with this skill (`scripts/ship-loop.sh`, registered via SKILL.md frontmatter) intercepts Claude Code's session-end attempts and decides whether to re-feed the ship prompt, inject a grace-turn ceremony prompt, or let it exit.

Two termination conditions — whichever fires first:

**Completion signal** — emit this as the final assistant text to exit the loop:

```
<ship-done>Ready</ship-done>     (success terminal state met)
<ship-done>Blocked</ship-done>   (hard stop, budget exhausted, or ambiguity)
```

The hook scans the last assistant text block for these exact tags. Emit **exactly one**. If both appear in the same block, the first match wins. Missing the marker → hook blocks exit and re-feeds the ship prompt as iteration N+1.

**Iteration budget** — hard cap via `max_iterations` in the state file (default 30). The hook distinguishes two over-budget states:

- `iteration == max_iterations` → one **grace turn** is injected: the hook re-feeds a terminal ceremony prompt asking the Agent to post a Blocked PR comment and emit `<ship-done>Blocked</ship-done>`. No new work.
- `iteration > max_iterations` → the grace turn already elapsed without a marker. The hook force-exits and removes the state file, even with no marker.

> Naming: user-facing argument `max-iter` maps to the state-file YAML field `max_iterations`. Same value, different punctuation.

## Entering ship mode

When ship is invoked (`/auriga-go ship` or confirmed NL trigger):

1. Print the opt-in warning (once, as iter 1 begins):
   ```
   ⚠️ ship mode (Experimental, max-iter N). Strictest defaults + in-Draft deep-review.
      Every exit — Ready or Blocked — posts a decisions + review-points comment on the PR.
      Hard stops still apply. /clear-safe (loop auto-resumes).
      Cancel anytime: rm .claude/auriga-go-ship.local.md
   ```
2. Write the state file at `.claude/auriga-go-ship.local.md` (template below).
3. Begin iteration 1.

**State file template** (ralph-loop-style: YAML frontmatter + re-entry prompt body):

```markdown
---
active: true
iteration: 1
max_iterations: 30
session_id: ${CLAUDE_SESSION_ID}
started_at: <ISO 8601 UTC timestamp>
---

Continue auriga-go ship mode. Re-read CLAUDE.md (the auriga workflow),
skills/auriga-go/SKILL.md, and skills/auriga-go/references/ship.md
before acting. Your job:

1. Inspect current state (git log, docs/specs/, gh pr view) to find
   where the previous iteration left off in the auriga workflow.
2. Pick up the next phase per CLAUDE.md + ship's strict defaults.
3. On test/verification failure: systematic-debugging → fix → retry.
4. When all four Ready terminal conditions hold (tests pass AND
   in-Draft deep-review empty AND ship-Ready PR comment posted AND
   PR flipped Draft → Ready), emit <ship-done>Ready</ship-done>.
5. On hard stop (ambiguity / destructive op) or if you want to exit
   before conditions are met, post the Blocked PR comment and emit
   <ship-done>Blocked</ship-done>.

Record each workflow phase you take through your host Agent's task
tracker — that's your primary in-session audit trail. The <ship-done>
marker is the only format ship itself mandates (the Stop hook scans
for nothing else).
```

The prompt body is the **same every iteration** — a fresh Agent (e.g. after `/clear`) must be able to read it cold and continue.

When writing the state file, substitute `${CLAUDE_SESSION_ID}` with the actual session ID value (read via bash: `echo "$CLAUDE_SESSION_ID"`). If the env var is unset, leave the field blank — session isolation becomes a no-op, but the state file still gates by presence, which is safe for single-session use.

**Iteration count** lives in the state file's `iteration:` field, incremented atomically by the hook on each re-feed. To see it: `grep '^iteration:' .claude/auriga-go-ship.local.md`.

## Auto-resume across `/clear`

The Stop hook + state file both survive `/clear` and compaction. Mid-ship `/clear` → next Stop fires the hook → hook re-feeds the prompt body → Agent re-reads SKILL.md + ship.md + workflow state and continues. No manual resume needed.

## Ready terminal conditions

All four must hold before emitting `<ship-done>Ready</ship-done>`:

1. Tests pass (full `verification-before-completion`)
2. In-Draft `deep-review` returns an empty blocking-list
3. **ship-Ready PR comment posted** (template below)
4. PR flipped Draft → Ready

If any fails mid-iteration, continue the main loop: invoke `systematic-debugging`, apply the fix, re-run, iterate. Iterations count against the same `max_iterations` — no private counters.

### ship-Ready PR comment (required before emitting Ready)

Post this as a new PR comment, then flip Draft → Ready, then emit the marker.

```markdown
## 🚢 ship mode: Ready at iter <N>/<max-iter>

### 自主决定 (strict defaults applied)
<One bullet per decision point that surfaced, naming the decision and
the strict default chosen. Example:
- Step 7 test design → test-designer (Independent Evaluation)
- Step 10 spec lifecycle → promoted docs/specs/X.md to docs/architecture/>

### 迭代中的 case-specific 判断
<Bullet list of judgments not pre-decided by the strict-defaults table —
small structural choices, test-failure fix directions, scope trims.
One line each: "<decision> — why". Example:
- Replaced the 4-arg helper with a config object — 3rd caller made the
  positional form unreadable>

### 人需要验收 / review 的点
<Bullet list of things the human partner should eyeball. Frame as
"please verify", not "I think this is fine". Example:
- Verify the PR title + body match the actual scope shipped
- Confirm the deep-review punch list in the PR timeline is actually empty
  (not "empty-looking")
- Spot-check docs/architecture/X.md reads cleanly as a standalone doc>
```

Three sections always present; empty sections get "None." rather than being omitted — absence of a section should mean "not applicable yet," not "agent forgot."

## Strict defaults per workflow decision

At each decision point the auriga workflow surfaces (see `CLAUDE.md` for the authoritative phase list), pick the most rigorous option:

| Decision point | ship default |
|---|---|
| Choosing a planning method | `planning-with-files` — persistent state survives `/clear` and iterations |
| Designing tests for the TDD red phase | `test-designer` — Independent Evaluation |
| Deciding whether to parallelize implementation | dispatch when threshold met; don't skip "to save complexity" |
| Deciding what to do with the spec at PR readiness | **promote** to `docs/architecture/` first; archive only if no clear architectural home |
| Picking review rigor | `deep-review` **mandatory on Draft** — deliberate exception to "deep-review only after Ready", justified because ship is producing the Ready candidate |
| Flipping Draft → Ready | automatic once all four Ready terminal conditions hold |

Decisions not in this table and not pre-decided by the spec → ambiguity → hard stop → `Blocked` exit. **Don't invent a ship default not listed here.**

## Blocked exit

Blocked is reached in one of two ways:

- **Voluntary** — mid-iteration hard stop: ambiguity that can't be resolved by strict defaults, destructive/irreversible op, or the Agent judges the spec too thin to continue. Agent posts the comment and emits the marker on the same turn.
- **Grace turn** — budget exhausted (`iteration == max_iterations`, no marker). See "How the loop runs" above for the hook mechanic. On the grace turn: post the Blocked comment + emit `<ship-done>Blocked</ship-done>`. **No new implementation work** — budget is spent.

Before emitting `<ship-done>Blocked</ship-done>`:

1. Post a PR comment using the template below
2. Leave PR as Draft (do **not** flip Ready)
3. Emit `<ship-done>Blocked</ship-done>` — hook deletes state file, allows exit

No silent give-up.

### ship-Blocked PR comment (required before emitting Blocked)

```markdown
## 🚫 ship mode: Blocked at iter <N>/<max-iter>

### 自主决定 (strict defaults applied so far)
<Same framing as the Ready template — what was locked in before the block.>

### 迭代中的 case-specific 判断
<Same framing as the Ready template — judgments made up to the blocker.>

### 最近的修复尝试
<Up to 3 most recent fix attempts and why each failed. Example:
1. Tried narrowing the regex to exclude the `---` separator — still matched
   the trailing `---` in markdown tables
2. Tried `sed` with multi-line range — POSIX sed doesn't honor `/^---$/,/^---$/`
   the way GNU sed does, broke on macOS
3. Switched to `awk` state machine — works, but tests still red because the
   fixture file itself has CRLF line endings (unconfirmed)>

### 为什么 Blocked
<One paragraph: what's blocking, what class of block this is (ambiguity /
destructive op / budget exhaustion / spec gap). Be concrete.>

### 人继续的两条路
1. **Bump max-iter and resume**: `/auriga-go ship <larger number>` if the
   block was just budget and the last attempt was on the right track.
2. **Take over manually**: checkout the branch, finish by hand. State file
   is already removed, so no ship residue to clean up.

### 人需要验收 / review 的点
<Same framing as the Ready template — even Blocked PRs leave review surface
for the human to validate.>
```

All five sections present; empty sections get "None." rather than being omitted.

## When NOT to use ship

- Production data, secrets, or shared infrastructure in scope
- Security-sensitive or regulatory work where "almost right" is unacceptable
- Shaky spec — ship can only execute work that's well-defined upfront
- Customer-visible repos where a bad PR comment thread has real cost

## Manual cancel

```bash
rm .claude/auriga-go-ship.local.md
```

Next Stop event fires the hook → no state file → immediate no-op → normal exit. The skill's Stop hook stays registered for the session but is a no-op without the state file.

## Invocation

- `/auriga-go ship` — 30 iterations
- `/auriga-go ship 50` — 50 iterations
- `ship 模式跑到 PR Ready` — natural language, **requires confirmation** before entering
