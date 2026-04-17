---
name: deep-review
description: Run a formal, multi-dimensional code review of a pull request. Reads the PR diff, classifies change types, dispatches parallel reviewers by dimension (correctness, consistency, docs-sync, plus conditional security/edge-cases/UX/performance/structure/maintainability), and synthesizes findings into an actionable punch list. Use when the user asks to review a PR, run /deep-review, mark a PR as ready for review, or requests a formal/thorough code review.
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
- **`ui`** — CLI / TUI / web / mobile UI changes (user-facing interaction surfaces)
- **`frontend-perf`** — frontend or mobile performance-sensitive changes (rendering, bundle, network, memory)
- **`structure`** — new files, module reorganization, dependency graph changes

Also judge: is this **trivial** (single-line tweak, pure config/doc) or **non-trivial** (any code logic change)?

### Step 3: Dispatch required reviewers (always, in parallel)

Launch these three as read-only subagents **in parallel** (single message, multiple Agent tool calls, no isolation needed since read-only):

| Reviewer | Focus |
|---|---|
| **Correctness** | Does it implement the requirement correctly? Any logic errors? |
| **Consistency** | Does it follow existing project patterns, naming, structure? |
| **Documentation sync** | Do changes cause README, CLAUDE.md, API docs, etc. to drift? Remove stale/redundant descriptions — no docs is better than wrong docs. Code is documentation; don't add redundant prose describing code behavior. |

**Each reviewer receives**:
- PR diff (full)
- Relevant project spec docs (if any, e.g., `docs/` topic files)
- Explicit output format requirement (see "Output format" below)

### Step 4: Dispatch conditional reviewers (by tag)

| Tag | Reviewer | Focus |
|---|---|---|
| `logic` | **Security** | Injection, XSS, auth bypass, secret leakage, unsafe deserialization |
| `logic` | **Edge cases** | Exception inputs, concurrency, resource cleanup, error paths |
| `ui` | **UX** (consider independent Agent, optionally with `playwright-cli`) | Dead ends, no feedback after action, misclick risk, redundant operations, invisible state — review from a user's perspective |
| `frontend-perf` | **Performance** | Rendering (unnecessary re-renders, unvirtualized large lists, animation jank); bundle size (untreeshaken deps, uncompressed assets); network (redundant requests, no caching, waterfall loading); memory (leaks, unreleased listeners/timers). Mobile: startup time, offscreen rendering, main thread blocking |
| `structure` | **Engineering structure** | Are new files in correct directories per existing layering/packaging? Circular dependencies? Cross-layer direct calls? Are shared-module changes assessed for blast radius? Reimplementation of existing reusable modules? |

Launch these in parallel with the required three (same message).

### Step 5: Dispatch general reviewer (if non-trivial)

For any non-trivial change, additionally dispatch:

- **Maintainability** — naming, structure, over-abstraction vs. under-abstraction, comment quality

### Step 6: Synthesize findings into a punch list

Aggregate all reviewer outputs into a single report:

```
## Deep Review: PR #<n> — <title>

**Tags**: <logic|ui|...>  |  **Reviewers dispatched**: <list>

### Blocking issues
- [ ] <file:line> — <one-line finding> (<reviewer>)

### Non-blocking suggestions
- [ ] <file:line> — <one-line finding> (<reviewer>)

### Architectural observations
- <observation and recommended tracking action>
```

**Classification rule**:
- **Blocking** = correctness bug, security vulnerability, breaks existing tests/contracts
- **Non-blocking** = maintainability / style / minor perf
- **Architectural** = decay worth tracking as a separate issue (per the workflow "About Review" rule)

## Output Format (for each dispatched reviewer)

**Every reviewer subagent must be told how to report back.** Do not rely on defaults — subagents will otherwise dump raw context.

Default prompt contract for each reviewer:

> Return a summary of **at most 300 words** followed by a bullet list of findings. Each finding: `<file>:<line> — <one-line description> — [severity: blocking | non-blocking]`. Do not include code excerpts longer than 5 lines. Do not restate the diff. If no issues found, return exactly: `"No findings."`

Adjust the word budget or format per reviewer as needed (e.g., Security may justify a longer explanation for a single high-severity finding).

## Runtime: subagent vs independent Agent

- **Default**: in-conversation subagent (read-only, parallel-safe)
- **Use independent Agent when**:
  - UX review benefits from zero-context fresh eyes
  - Cross-model blind spot coverage is valuable (dispatch a different-family reviewer — e.g., Codex reviewing Claude-written code, or Claude reviewing Codex-written code — so the reviewer doesn't share the writer's blind spots)
  - Architectural trade-offs require the strongest reasoning model the runtime offers at `xhigh` effort
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

## Example invocation

```
User: /deep-review
Assistant:
  1. gh pr view + gh pr diff
  2. Tags: logic, structure
  3. Dispatches 6 reviewers in parallel:
     - Required: correctness, consistency, docs-sync
     - Conditional (logic): security, edge-cases
     - Conditional (structure): engineering-structure
     - Non-trivial: maintainability
  4. Each reviewer returns ≤300-word summary + findings
  5. Synthesizes punch list, categorizes blocking vs non-blocking
  6. Reports to user
```
