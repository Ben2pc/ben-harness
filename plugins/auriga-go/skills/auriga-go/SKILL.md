---
name: auriga-go
description: Drives the project's CLAUDE.md development workflow forward one or many phases. Trigger when the user invokes `/auriga-go`, uses a phrase explicitly naming the workflow ("按照工作流继续", "按工作流走", "drive the workflow", "workflow autopilot", "where are we in the workflow", "我们的 workflow 走到哪了"), resumes after `/clear`, or workflow drift is visible (commits on main, no Draft PR, missing branch prefix). NOT for plain "继续" / "continue" / "next" / "下一步" / "what's next" (those mean the current task, not workflow navigation), single-question lookups, one-off git commands, or exploratory discussion. Experimental `ship` mode drives spec → PR Ready autonomously (see references/ship.md).
argument-hint: "[step|auto|ship] [max-iter]"
---

# auriga-go — Workflow Autopilot

Inspect state, identify the next workflow step, drive forward. Reminder-based: tells the main Agent which skill to invoke next; does not dispatch skills itself.

**`CLAUDE.md` is the authoritative workflow.** Re-read it at invocation time; this file does not encode the step list.

## When to Use

- `/auriga-go` invoked explicitly
- User phrasing clearly references the workflow itself: "按照工作流继续", "按工作流走", "drive the workflow", "workflow autopilot", "where are we in the workflow", "我们的 workflow 走到哪了"
- Session just resumed (`/clear` or compaction) AND the previous workflow step is unclear AND the user wants to navigate by workflow
- Workflow drift is evident: commits on `main`, no Draft PR, branch without `feat/`/`fix/`/`docs/` prefix, code before a spec

## Don't Use For

- Plain "继续" / "continue" / "next" / "下一步" / "what's next" — refer to the current task
- Single-question lookups, one-off commands (commit/push/open PR), exploratory discussion
- Tasks outside the auriga workflow

## Modes

| Mode | Behavior |
|---|---|
| `step` | One workflow step → return |
| `auto` (default) | Loop steps until a hard stop |
| `ship` (Experimental) | Loop until Draft → Ready. Hook-backed, default `max-iter` 30. Every exit posts a PR comment. **Read `references/ship.md` before invoking.** |

## Arguments

Invocation: `/auriga-go [mode] [ship-max-iter]` or natural-language trigger.

Parse `$ARGUMENTS`:

- Empty → `auto`
- First token is `step` / `auto` / `ship` → use as mode
- Integer after `ship` → override `max-iter` (ignored for step/auto)
- Natural-language text with no mode keyword → `auto`, text as task context
- NL mentioning "ship" / "跑到 Ready" / "到 Ready for Review" → **confirm with user before entering `ship`**

| User types | `$ARGUMENTS` | Resolved |
|---|---|---|
| `/auriga-go` | (empty) | auto |
| `/auriga-go step` | `step` | step |
| `/auriga-go ship` | `ship` | ship, max-iter=30 |
| `/auriga-go ship 50` | `ship 50` | ship, max-iter=50 |
| `按照工作流继续` | `按照工作流继续` | auto |

## Algorithm (step + auto)

```
loop:
  1. Read current state
  2. Identify next workflow step (check Stop Contract here)
  3. Record the step in your Agent's native task/todo tracker
  4. Recommend next action to main Agent
  5. step → return; auto → continue
```

### Read current state — probe in order; stop at first unambiguous answer

1. Main Agent context — native task tracker, in-flight task description, recent tool results
2. `task_plan.md` / `progress.md` (if `planning-with-files` is active)
3. Open Draft PR body TODOs (`gh pr view --json body`, scan for `- [ ]`)
4. Repo state heuristics — git branch prefix, `gh pr list --draft`, `git rev-list @{u}..HEAD`, `docs/specs/*.md` presence, recent test/verification commands

If sources 2–4 were needed → run the **Confirmation Contract** below before proceeding.

### Identify next workflow step

Match current state to a phase in `CLAUDE.md`; pick the earliest unfinished phase applicable to the current work. Apply `CLAUDE.md`'s Quick Development Flow exception when appropriate.

### Record the step

Use your Agent's native task/todo tool. If the Agent has none, announce in natural language ("Working on TDD phase — writing the failing test for X") before the first tool call. Never silently begin.

**ship mode additionally requires**: every exit — Ready or Blocked — posts a decisions/review-points PR comment, then emits `<ship-done>Ready</ship-done>` or `<ship-done>Blocked</ship-done>` (exactly one) as the final assistant text. Ready has four terminal conditions (tests pass + deep-review empty + Ready PR comment posted + Draft→Ready flipped). See `references/ship.md` for the full contract, templates, and grace-turn mechanics.

### Recommend next action

Name the phase (in `CLAUDE.md`'s own terms) + the action or skill to invoke. Examples: "requirement clarification phase → invoke `brainstorming`", "TDD red phase → invoke `test-designer` with the spec", "formal review phase → invoke `deep-review`". The main Agent executes.

**Mandatory emissions before recommending green-phase code work** (CLAUDE.md steps 7–8 decision points). Both must be recorded in the task tracker as a single line each, *before* recommending any Write/Edit on production code:

1. Change-size estimate: `<N> module(s), <M> file(s), ~<L> lines/file` — the input the step 8 thresholds key off of.
2. `test-designer` applicability: `Y/N — <one-line reason>` — the step 7 "complex feature" judgment.

These exist so the step 7/8 **skip** decisions are auditable. CLAUDE.md's own escape hatch ("Below these thresholds, write it inline — multi-agent overhead outweighs the gain") is legitimate; what is not legitimate is skipping silently. If either emission is missing when green-phase code lands, treat it as workflow drift on the next pass.

## Stop Contract

Hard-stop and return control to the user in exactly two situations:

1. **Ambiguity that needs a human answer** — requirement gap, design choice with equally-valid paths, missing info no probing can resolve
2. **Destructive / irreversible operations** — force-push to shared refs, main-branch writes, broad `rm -rf`, package publishes (`npm publish`, `gh release create`), CI/CD pipeline mutations, anything that affects other developers or production

In both cases, explain why you stopped and what you need. Never silently exit.

Push-forward otherwise:

- `AskUserQuestion`-style choices with a reasonable default → take the default
- Test failures → invoke `systematic-debugging` and continue
- Small structural decisions → pick one, note it in the tracker, move on

## Confirmation Contract (fallback path only)

When current-state inference came from sources 2–4, present findings and confirm **before proceeding**:

```
State inference (sources: [task_plan.md / Draft PR body / git heuristics]):
- <signal> → <inference>
- ...
Inferred position: <phase>. Next action: <action>. Proceed?
```

Skip if source 1 was sufficient.

## Ship mode

Hook-backed loop bundled with this skill. State file, completion markers, strict defaults, Ready/Blocked PR-comment templates, and grace-turn mechanics all live in `references/ship.md`. Do not enter ship via natural-language trigger without user confirmation.

## Anti-patterns

- ❌ Dispatching other skills from inside auriga-go — recommend only
- ❌ Silently starting work — always record the phase in the task tracker first
- ❌ Proceeding past a fallback inference without running the Confirmation Contract
- ❌ Bypassing the Stop Contract for "small" destructive ops
- ❌ Entering green phase without emitting the change-size estimate + `test-designer` applicability lines (steps 7/8 skip-or-go decisions must be auditable)

## Example invocations

### Resume after `/clear`

```
User: continue the workflow

Agent (auriga-go, auto):
  State inference (sources: git + Draft PR):
  - Current branch feat/X + Draft PR #N → branch + Draft PR created
  - docs/specs/X.md exists → requirement clarification done
  - No recent test run → verification not started
  Inferred position: TDD phase. Proceed?

User: yes

Agent (auriga-go, auto):
  [records "TDD phase — invoke test-designer on docs/specs/X.md"
   as a task in the native tracker, then invokes test-designer]
```

### Step mode

```
User: /auriga-go step

Agent (auriga-go, step):
  [records "PR readiness phase — push + update PR body" as a task]
  Suggested command: git push && gh pr edit --body-file <updated body>. Proceed?
```

### Hard stop on ambiguity

```
Agent (auriga-go, auto):
  [task tracker shows "review-findings phase — triage deep-review punch list"]

  Stop: deep-review returned 3 blocking findings. #2 requires an architectural
  refactor (src/skills.ts); the auriga workflow's review-findings guidance says
  high-risk changes should be tracked as separate issues, not bundled into this
  PR. Need confirmation: fix inside this PR, or open a tracking issue?
```
