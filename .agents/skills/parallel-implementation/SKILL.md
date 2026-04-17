---
name: parallel-implementation
description: "Plan how to slice a non-trivial coding task across parallel subagents. Returns a dispatch plan (file assignments, dependencies, output-format contracts) — the main Agent then executes it with the Agent tool + `isolation: \"worktree\"`. Invoke only when work justifies multi-agent overhead: (a) greenfield 0→1 across multiple independent modules, (b) change touches ≥3 modules, or (c) ≥5 files each with >50 lines of diff. Small changes write inline."
---

# Parallel Implementation

Planner skill — returns a slice plan, does **not** invoke subagents itself. The main Agent keeps execution authority.

## When to Use

Invoke **only** when one of these triggers fires:

1. **Greenfield 0→1 across multiple independent modules** → plan a **layered parallel split** (e.g., data / service / UI layers each as their own slice). Greenfield independence makes this the cleanest parallel case.
2. **Change touches ≥3 modules** → the main Agent should confirm with the user via `AskUserQuestion` whether to parallelize; some cross-module edits are better serialized.
3. **Change touches ≥5 files AND each file's diff exceeds 50 lines** → the total work justifies dispatch overhead; recommend parallel.
4. **User explicitly asks** for "parallel write", "多 agent 并行实现", or "split this across subagents" → honor regardless of size.

**Don't use for:**
- Single-file, 2-file, or 3–4 file changes where any slice's diff is <50 lines → main Agent writes it inline
- Refactors where all callers cascade from a single change (e.g., renaming a widely-used helper) → serialize through main Agent
- Work with serial dependencies (B needs A's output) → that's a pipeline, not parallel
- Pure read tasks (review, search, analysis) → parallel subagents without slicing are fine; no planning needed

Multi-agent overhead (worktree setup, context briefing, result merging, conflict resolution) is real. When in doubt, inline wins.

## The Iron Law

**A slice plan is only valid when every slice has independent inputs and independent outputs.** If two slices can collide — on the same file, on a shared data structure, or on a shared mid-execution state — they are not parallel. Either merge them into one writer, or serialize them.

Violating this = guaranteed merge conflicts or silent state corruption.

## Steps

### Step 1: Slice-ability check

Ask: **can this task be cut into pieces whose inputs and outputs don't overlap?**

- ✅ "Implement `plugins.ts` resolver, write its unit tests in `tests/plugins.test.ts`, add CLI flag to `cli.ts`" — three files, dependencies resolvable at boundaries, each slice carries substantive logic
- ✅ "Greenfield: build data layer in `store.ts`, service layer in `service.ts`, UI layer in `ui.tsx`, each with its own tests" — layered 0→1, no shared mid-execution state
- ❌ "Refactor `utils.ts` to extract a logging helper and update all callers" — all callers edit sites cascade from the extraction; serialize
- ❌ "Add retry to the exec wrapper AND migrate exec callers to use it" — B depends on A; pipeline, not parallel

If the answer is no, **return "serialize" and terminate**. Don't force a bad split.

### Step 2: Draft file assignments

For each slice, list:

- Which files it will create / modify / delete
- What it needs from other slices as input (file paths, function signatures, data shapes)
- What it produces as output (unified diff, new file set, state change)

Be explicit — vague assignments ("slice 2 touches the config layer") breed collisions.

### Step 3: Collision check → merge

Scan the file-assignment table. For every file that appears in more than one slice:

- If the edits are **append-only and non-overlapping** (e.g., both add different rows to different sections of the same Markdown table) → still merge to one writer; worktree merges of concurrent edits to the same file produce conflicts whenever the hunks touch adjacent lines
- Otherwise → **merge those slices to one subagent**. Guaranteed.

Example:
- ✅ Slice A writes `cli.ts`, Slice B writes `utils.ts` — different files, safe
- ❌ Slice A and Slice B both edit `utils.ts` — merge into one slice
- ❌ Slice A edits `skills-lock.json` via `npx skills add`, Slice B also edits `skills-lock.json` directly — merge; the generator and the hand-edit will clobber each other

### Step 4: Size filter

For each remaining slice, estimate diff size. Rule of thumb:

- **< 50 lines of actual change per slice** → drop from the plan; main Agent writes inline. Dispatch overhead (context setup, worktree spin-up, result merge) outweighs parallelism gain.
- **~50–150 lines** → dispatch candidate
- **> 150 lines or architectural** → dispatch, and note "override to a stronger reasoning model at `xhigh` effort (the maximum the runtime supports)" on the slice if the main Agent's current model is not already that

Drop small slices from the plan; note them as "main Agent handles inline".

**Minimum-slices gate**: if fewer than 3 dispatchable slices remain after filtering, **terminate and return "serialize"**. Below three parallel writers, the dispatch ceremony (worktree spin-up, context briefing, merge) isn't worth the context cost — the main Agent writes them sequentially.

### Step 5: Output contract per slice

For every dispatched slice, decide the **exact format the subagent must return**. No defaults.

Common contracts:

- **Code change**: "Return the unified diff of your changes plus a one-line rationale per file."
- **New file**: "Return the full file contents plus a one-paragraph explanation of its role."
- **Config edit**: "Return the updated section verbatim; do not quote the entire file."
- **Test slice**: "Return the test file plus a bullet list mapping test → requirement being verified."

An unspecified format = the subagent dumps verbose context back, cancelling the dispatch benefit.

### Step 6: Return the plan

Emit a single table the main Agent can execute against:

| Slice | Writer | Model | Files | Depends on | Output format |
|---|---|---|---|---|---|
| 1 | subagent | inherit | `src/plugins.ts` | — | unified diff + one-line rationale |
| 2 | subagent | inherit | `tests/plugins.test.ts` | slice 1 signature only | test file + requirement map |
| 3 | main Agent | — | `src/cli.ts` | slice 1 complete | (inline, no dispatch) |

Annotate:
- Which slices are **parallelizable now** (no blocking deps)
- Which are **gated** (wait for a prior slice)
- Which are **inline** (main Agent, no subagent)

**Model column contract**:
- Default value is **`inherit`** — subagent uses whatever model the main Agent is currently running (could be any Claude model, Codex / GPT-5.4, or a future main Agent runtime). Don't hardcode Anthropic-specific or OpenAI-specific model names as the default.
- Set an **explicit override** only when the caller has a reason:
  - User or main Agent asked for a specific model (e.g., "use opus high for the resolver slice")
  - Slice is architectural / high-stakes and benefits from a stronger reasoning model at higher effort than the main Agent's current setting
  - Slice is mechanical boilerplate that can safely drop to a faster/cheaper model
- Write the override as a neutral phrase the main Agent can translate (e.g., `stronger reasoning model, xhigh effort`, `fast mechanical model`), not a specific model name, unless the user named one.
- Effort levels (when named) escalate: `low` → `medium` → `high` → `xhigh`. **Complex / architectural slices default to `xhigh`** (the max the runtime supports). `high` is appropriate for medium-complexity work; lower levels only for mechanical tasks.

## Handoff to Main Agent

The main Agent executes the plan:

1. Parallel slices → single message with multiple `Agent` tool calls, each with `isolation: "worktree"` (since they're writing code)
2. Gated slices → run after their deps complete; main Agent serves as the relay (A's output → main Agent → B's context)
3. Inline slices → main Agent writes them directly

The skill does none of this — it only produced the plan.

## Anti-patterns

- ❌ Returning a plan with overlapping file assignments — Step 3 must merge them
- ❌ Omitting the output format column — a slice without a format contract will dump context and waste the dispatch
- ❌ Forcing parallelism where the task is naturally serial — Step 1 should have terminated the skill
- ❌ Slicing too small just to have more parallelism — Step 4's size filter is not optional
- ❌ Attempting to coordinate subagents mid-flight via shared state — no current CLI runtime (Claude Code, Codex CLI, etc.) has an agent-to-agent channel; serialize through the main Agent or merge into a single-line task

## Example invocation

```
User: Code review surfaced three independent bugs. Fix all three in this PR:
      (A) cli.ts drops ESC cancellation errors in withEsc();
      (B) hooks.ts doesn't validate the `_marker` field on settings reads;
      (C) plugins.ts silently ignores marketplace fetch failures.
      Each has its own test.

Assistant (runs parallel-implementation):
  Step 1 (slice-ability): ✅ three bugs, three files, no cross-cutting
                          signature changes — fully independent
  Step 2 (assignments):
    A → src/cli.ts + tests/cli.test.ts
    B → src/hooks.ts + tests/hooks.test.ts
    C → src/plugins.ts + tests/plugins.test.ts
  Step 3 (collision check): no file appears twice; no merge needed
  Step 4 (size filter): each slice ~50–100 lines of changes — dispatch
  Step 5 (output contract): each subagent returns unified diff + a
                            one-sentence description of the bug it fixes
  Step 6 (plan):
    | Slice | Writer | Model | Files | Depends on | Output format |
    | A | subagent | inherit | src/cli.ts + tests     | — | diff + rationale |
    | B | subagent | inherit | src/hooks.ts + tests   | — | diff + rationale |
    | C | subagent | inherit | src/plugins.ts + tests | — | diff + rationale |
  Parallelizable now: A, B, C (no gating)

Main Agent:
  1. Dispatches A/B/C in parallel, each with isolation: "worktree"
  2. Merges returned diffs, runs the full regression suite
```

## Relationship to other skills

- `test-designer` → may produce the failing tests whose green phase triggers this skill (upstream)
- `test-driven-development` → governs when to enter green phase (upstream)
- `systematic-debugging` → runs if any dispatched slice's result breaks regression (downstream)
- `verification-before-completion` → gates "done" after all slices merge (downstream)
