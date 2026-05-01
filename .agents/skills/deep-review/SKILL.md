---
name: deep-review
description: Run a formal, multi-dimensional code review of a pull request. Reads the PR diff, classifies change types, dispatches parallel reviewers by dimension (spec-conformance, correctness incl. test quality, docs-sync, plus conditional robustness/UX/performance/structure and code-quality for non-trivial changes), and synthesizes findings into an actionable punch list. Use when the user asks to review a PR, run /deep-review, mark a PR as ready for review, or requests a formal/thorough code review.
---

# Deep Review

Multi-dimensional PR review orchestrator. Replaces ad-hoc "please review this PR" with a structured dispatch of specialized reviewers.

## When to Use

- User explicitly invokes `/deep-review` or asks for a "deep review" / "formal review" / "thorough review"
- PR is transitioning from Draft to Ready for Review
- A high-risk change needs independent verification before merge

**Don't use for:** quick sanity checks (just do it yourself), typo fixes, or single-line changes.

## Prerequisites

1. `gh` CLI is authenticated (`gh auth status`)
2. Target PR is identified — either the current branch's PR or an explicit PR number
3. You have `git` / `gh` read access to the repo

## Steps

### Step 1: Fetch the diff and PR metadata

```bash
gh pr view --json number,title,body,baseRefName,headRefName
gh pr diff
```

Extract: PR number, title, body, base branch, head branch, full diff.

### Step 2: Classify the change — apply tags (multi-select)

Read the diff and assign one or more tags:

- **`logic`** — code logic changes (functions, algorithms, control flow, data handling)
- **`auth-sensitive`** — sub-tag to `logic`; diff touches authentication / authorization / crypto / secret handling / payment paths. Upgrades Robustness to split out a dedicated Security reviewer with a larger reasoning budget
- **`ui`** — CLI / TUI / web / mobile UI changes (user-facing interaction surfaces)
- **`perf`** — performance-sensitive changes. Covers frontend (rendering / bundle / network / memory), mobile (startup / main thread / battery), and backend/CLI/data (query patterns / algorithm complexity / I/O / concurrency)
- **`structure`** — new files, module reorganization, dependency graph changes

Also judge: is this **trivial** (single-line tweak, pure config/doc) or **non-trivial** (any code logic change)?

### Step 3: Dispatch required reviewers (always, in parallel)

Launch these three as read-only subagents **in parallel** (single message, multiple Agent tool calls, no isolation needed since read-only):

| Reviewer | Focus |
|---|---|
| **Spec Conformance** | Locate the spec: PR body acceptance criteria first, then `docs/specs/`, `docs/architecture/`, or `docs/worklog/<branch>/`. Check each AC against the diff and flag: (a) ACs not implemented (missing functionality), (b) scope present in code but absent from spec (scope creep), (c) spec ambiguities the diff resolves in one direction (call out the resolution, mark non-blocking when explicitly documented, blocking otherwise). **If no spec / AC exists, return exactly `"No spec found — cannot evaluate conformance."`** — do not invent ACs from the diff. |
| **Correctness** | Logic errors (off-by-one, null handling, wrong branch, broken fail-fast paths, bad data transforms), data handling (type / encoding / precision), contract mismatches with callers. **When the diff includes test files, also review test quality**: do tests verify the target behavior (vs. assert on mocks)? Is mock granularity reasonable (over-mocking hides prod drift)? Flaky risk (time / order / network dependencies)? Edge coverage (error paths, empty inputs, concurrency)? |
| **Documentation sync** | Do changes cause README, CLAUDE.md, API docs, etc. to drift? Remove stale/redundant descriptions — no docs is better than wrong docs. Code is documentation; don't add redundant prose describing code behavior. |

**Each reviewer receives**:
- PR diff (full)
- Relevant project spec docs (if any, e.g., `docs/` topic files)
- Explicit output format requirement (see "Output format" below)

**Spec Conformance reviewer inputs must exclude** the Agent's own commit messages, PR body rationale sections, and any "autonomous decisions" notes — those bias the reviewer toward confirming the writer's reading. Feed only the spec source + the diff.

### Step 4: Dispatch conditional reviewers (by tag)

| Tag | Reviewer | Focus |
|---|---|---|
| `logic` | **Robustness** | One reviewer, two lenses (present findings grouped under each lens): **Security** — injection, XSS, unsafe deserialization, auth bypass, secret leakage, shell / quote escaping. **Edge cases** — exception inputs, concurrency, resource cleanup, error paths, timeout / retry behavior, race conditions. |
| `logic` + `auth-sensitive` | **Security** (split out) | Same Security checklist above, but as a dedicated reviewer with a larger reasoning budget (subtle auth / crypto / secret-handling flaws deserve longer analysis). When this fires, Robustness narrows to the Edge-cases lens only — don't double-report. |
| `ui` | **UX** (consider independent Agent, optionally with `playwright-cli`) | Dead ends, no feedback after action, misclick risk, redundant operations, invisible state — review from a user's perspective |
| `perf` | **Performance** | Three sub-focuses — apply the one(s) matching the changed surface. **Web/Frontend** — rendering (unnecessary re-renders, unvirtualized large lists, animation jank), bundle (untreeshaken deps, uncompressed assets), network (redundant requests, no caching, waterfall loading), memory (leaks, unreleased listeners/timers). **Mobile** — startup time, offscreen rendering, main thread blocking, power/battery, cold vs hot start paths, memory-warning handling. **Backend/CLI/Data** — N+1 queries, algorithm complexity, long-running-process memory, I/O patterns (batch vs per-item), concurrency overhead, cold-start / first-request latency. |
| `structure` | **Engineering structure** | Are new files in correct directories per existing layering/packaging? Circular dependencies? Cross-layer direct calls? Are shared-module changes assessed for blast radius? Reimplementation of existing reusable modules? |

Launch these in parallel with the required three (same message).

### Step 5: Dispatch general reviewer (if non-trivial)

For any non-trivial change, additionally dispatch:

- **Code Quality** — merges the previous Consistency + Maintainability dimensions. One reviewer, two lenses (present findings grouped under each lens so classification stays clear):
  - **Consistency**: naming, style, existing project patterns, stale comments, leftover refactoring debt, import/export conventions
  - **Maintainability**: naming clarity, comment quality (removing redundant / over-describing ones, preserving WHY comments), duplicated logic, premature abstraction vs under-abstraction, dead code, YAGNI violations

### Step 6: Synthesize findings into a punch list

Aggregate all reviewer outputs into a single report:

```
## Deep Review: PR #<n> — <title>

**Tags**: <logic|ui|...>  |  **Reviewers dispatched**: <list>

### Blocking issues
- [ ] <file:line> — <one-line finding> — [confidence: high|med|low] (<reviewer>)

### Non-blocking suggestions
- [ ] <file:line> — <one-line finding> — [confidence: high|med|low] (<reviewer>)

### Architectural observations
- <observation and recommended tracking action>
```

**Classification rule**:
- **Blocking** = correctness bug, security vulnerability, breaks existing tests/contracts, **unsatisfied spec acceptance criterion**, unjustified scope creep
- **Non-blocking** = maintainability / style / minor perf / documented spec ambiguity
- **Architectural** = decay worth tracking as a separate issue (don't bundle risky, out-of-scope changes into a review-cycle PR)

**Confidence handling at synthesis time**:
- When two reviewers report the same root cause at the same `file:line`, keep the higher-confidence wording and drop the duplicate (don't double-count)
- Within each category, sort by confidence (high → low), then by severity
- Low-confidence findings stay in the report — they are signal for the human reviewer; do not silently drop them at synthesis. If a low-confidence finding is genuinely too speculative to act on, move it to Architectural observations rather than deleting it

## Output Format (for each dispatched reviewer)

**Every reviewer subagent must be told how to report back.** Do not rely on defaults — subagents will otherwise dump raw context.

Default prompt contract for each reviewer:

> Treat this pass as a coverage stage, not a filtering stage. Report every issue you find, including ones you are uncertain about or consider low-severity — a separate synthesis step will rank or drop them. It is better to surface a finding that later gets filtered out than to silently drop a real bug.
>
> Return a summary of **at most 300 words** followed by a bullet list of findings. Each finding: `<file>:<line> — <one-line description> — [severity: blocking | non-blocking] — [confidence: high | medium | low]`. Do not include code excerpts longer than 5 lines. Do not restate the diff. Return `"No findings."` only when you genuinely found nothing — not as a shortcut to skip low-severity or low-confidence reporting.

Reviewers that merge two lenses (Robustness, Code Quality) should group findings under a sub-heading per lens so the synthesis step can classify them independently. Adjust the word budget per reviewer as needed (e.g., split-out Security may justify a longer explanation for a single high-severity finding).

The coverage-first framing matters specifically because newer reasoning models (Opus 4.7 and similar) follow filtering instructions like "only report high-severity issues" faithfully — they investigate just as deeply, then convert fewer investigations into reported findings. Push the filtering to the synthesis step (below), where you have all reviewers' findings in front of you and can rank them with full context.

## Runtime: subagent vs independent Agent

- **Default**: in-conversation subagent (read-only, parallel-safe)
- **Use independent Agent when**:
  - UX review benefits from zero-context fresh eyes
  - Cross-model blind spot coverage is valuable (dispatch a different-family reviewer — e.g., Codex reviewing Claude-written code, or Claude reviewing Codex-written code — so the reviewer doesn't share the writer's blind spots)
  - Architectural trade-offs require the strongest reasoning model the runtime offers at `xhigh` effort
  - **Spec Conformance** — when the writer and reviewer share a session, an independent Agent avoids carrying the writer's interpretation of ambiguous spec lines into the review
- **Never required**: committing `.claude/agents/` files. Subagent configuration is runtime, per-dispatch.

## Follow-up

After synthesis:

1. **Small fixes in current PR** — architectural decay caught by review can be fixed in this PR if it doesn't affect test results
2. **High-risk issues** — remind the human partner to create an issue for tracking; don't bundle risky changes into a review-cycle PR
3. **Document new patterns** — if the review surfaces a recurring anti-pattern worth codifying, note it for the next workflow iteration

## Anti-patterns (don't do this)

- ❌ Dispatching subagents without specifying output format → context flood
- ❌ Serializing reviewers that are independent → wastes time
- ❌ Parallel subagents editing the same file → use `isolation: "worktree"` or assign to one reviewer
- ❌ Asking subagents to coordinate with each other mid-review → no current CLI runtime (Claude Code, Codex CLI, etc.) has an agent-to-agent channel. If one reviewer's finding affects another's scope, serialize (A → main Agent → B) instead
- ❌ Reviewing Draft PRs formally — draft is for informal early feedback; wait for Ready
- ❌ Feeding the Spec Conformance reviewer the Agent's own commit messages, PR body rationale, or "autonomous decisions" sections — those bias it toward confirming the writer's reading. Spec + diff only
- ❌ Splitting already-merged dimensions (running separate Consistency and Maintainability, or separate Security and Edge-cases) unless the `auth-sensitive` sub-tag fires — the merge is a deliberate token-cost optimization that preserves every original checklist item
- ❌ Telling reviewers "only report high-severity issues", "be conservative", or "don't nitpick" — newer reasoning models (Opus 4.7 and similar) follow this faithfully and silently drop real findings. Filtering belongs at the synthesis step where you can see all reviewers' findings in context, not at the per-reviewer step where each reviewer is missing the cross-reviewer signal

## Example invocation

```
User: /deep-review
Assistant:
  1. gh pr view + gh pr diff
  2. Tags: logic, structure
  3. Dispatches 6 reviewers in parallel:
     - Required: spec-conformance, correctness, docs-sync
     - Conditional (logic): robustness
     - Conditional (structure): engineering-structure
     - Non-trivial: code-quality
  4. Each reviewer returns ≤300-word summary + findings
  5. Synthesizes punch list, categorizes blocking vs non-blocking
  6. Reports to user
```

Same PR but `logic` + `auth-sensitive` (e.g., diff touches JWT handling or the secret store): dispatch becomes 7 reviewers — Robustness narrows to Edge-cases lens only, and a dedicated Security reviewer joins with a larger reasoning budget.
