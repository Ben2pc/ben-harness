---
name: test-designer
description: Design failing tests for complex features using Independent Evaluation — dispatches a context-free agent that sees only the requirement spec and code paths (not the implementation approach), then returns executable failing tests. Use when starting TDD for a non-trivial feature, when the requirement is ambiguous enough that biased tests are a risk, or when the user asks for independent test design.
---

# Test Designer

Independent test-design orchestrator. Encodes Independent Evaluation: the agent writing the tests must not be the agent implementing the feature, and must not inherit the implementation's assumptions.

## When to Use

- TDD red phase for a **complex / non-trivial** feature (multi-file, multi-branch logic, new subsystem)
- Requirement is ambiguous enough that the implementer's tests would likely rationalize the implementation instead of catching bugs
- User explicitly asks for "independent test design", "fresh-eyes tests", or runs `/test-designer`

**Don't use for:**
- Trivial changes (one-line fix, rename) — just write the test inline
- Bug reproduction tests — write directly from the bug report
- Non-code changes (pure docs, pure config, pure prompt)

## The Iron Law

**The agent designing the tests must not carry the implementation's context.** If you (the main Agent) are about to implement the feature, you are disqualified from designing its tests. Dispatch.

Violating this = tests that pass because they mirror the buggy implementation.

## Steps

### Step 1: Assemble the dispatch package

Collect **only these inputs** — nothing else:

1. **Requirement description** — "what to do" and acceptance criteria (not "how to do")
2. **Relevant code file paths** — read-only access to the code the feature will touch or integrate with
3. **Edge case prompts** — categories the dispatched agent should enumerate:
   - Boundary inputs (empty, max, min, off-by-one)
   - Concurrency / ordering (if applicable)
   - Resource lifecycle (cleanup on error, partial failure)
   - Invariants (data consistency, idempotency)
   - Adversarial inputs (malformed, oversized, mis-encoded)

**Explicitly exclude:**
- The implementation plan or design you've been developing
- Hints about which approach you've chosen
- Code excerpts from a work-in-progress branch
- Your own guesses about "the right way to test this"

### Step 2: Choose the executor

| Task shape | Executor | Reason |
|---|---|---|
| Complex, architectural implications | Independent Agent (e.g., `codex-agent` or `claude-code-agent` with fresh session) | True zero-context isolation; can use strongest model at highest effort |
| Medium complexity, current conversation clean | In-conversation subagent | Cheaper; still acceptable if main Agent hasn't yet proposed an implementation |
| Trivial | **Don't dispatch** — write tests inline |

**Default to Independent Agent** when the main Agent has already discussed or sketched implementation. Subagent isolation within the same conversation doesn't undo prior context pollution.

### Step 3: Dispatch with the strongest model and highest effort

Test design is a correctness-critical reasoning task, not a rote mechanical one. Use:

- **Model**: strongest reasoning model the runtime offers — inherit if the main Agent is already on that tier; otherwise override. Don't hardcode a specific brand name
- **Effort**: `xhigh` (the maximum level the runtime supports). Escalation ladder: `low` → `medium` → `high` → `xhigh`
- **Tools**: Read / Grep / Glob on code paths; Write on test files only
- **Permission**: read-only on non-test files; writable on test files

Example dispatch prompt skeleton:

```
You are designing failing tests for a feature. You will NOT see or write the
implementation. Your job is to produce executable tests that fail today and
pass only when the feature is correctly implemented.

Requirement:
<paste requirement description + acceptance criteria>

Code paths (read-only, for understanding context):
<list of file paths>

Existing test framework and conventions:
<infer from repo or specify>

Produce:
1. A test plan — enumerate the behaviors being tested (happy path + edge
   cases), grouped by category (boundary / concurrency / lifecycle /
   invariants / adversarial).
2. Executable test files that fail against the current code (or against
   an empty implementation).
3. For each test, one-line rationale explaining the bug it would catch.

Constraints:
- Do NOT propose an implementation.
- Do NOT edit files outside the test directory.
- Cover edge cases explicitly; don't only test the happy path.
- Use the project's existing test framework and style.
```

### Step 4: Validate the returned tests

Before handing the tests to the implementation phase:

1. **Run the tests** — they should FAIL (red). Tests that pass on empty/wrong implementations are useless.
2. **Scan the rationale** — does each test catch a distinct failure mode? Drop duplicates.
3. **Check coverage** — are all edge case categories represented? Request additions if not.
4. **Confirm the test framework matches** — ensure the dispatched agent used the right runner / assertion lib / fixtures.

### Step 5: Hand off to implementation

With the validated failing tests in place, implementation proceeds per `test-driven-development` skill: write minimal code to make them pass (green), then regression.

## Output Format (from the dispatched agent)

Require the agent to return:

> A test plan (bullet list, grouped by category) followed by the test files. Each test must include a one-line rationale comment. No implementation code. No commentary on how to implement. If assumptions about the code are needed, list them explicitly at the top of the test file.

## Anti-patterns

- ❌ Main Agent writes the tests after sketching the implementation — tests will mirror the implementation's assumptions
- ❌ Dispatching with medium effort / weaker model to save cost — test design quality compounds across the whole feature's lifetime
- ❌ Passing the work-in-progress branch contents to the dispatched agent — defeats Independent Evaluation
- ❌ Accepting tests that pass against an empty implementation — those tests don't constrain anything
- ❌ Skipping Step 4 validation — unvalidated tests get merged as fake green

## Relationship to other skills

- `brainstorming` → clarifies the requirement (upstream of `test-designer`)
- `test-driven-development` → governs the red-green-refactor loop (downstream; consumes the failing tests)
- `systematic-debugging` → kicks in if tests unexpectedly fail after implementation (downstream)
- `verification-before-completion` → runs the tests at the "done" gate (downstream)

## Example invocation

```
User: Starting work on the new plugin dependency resolver. Design tests first.
Assistant:
  1. Requirement: "Resolver takes a plugin manifest and returns install order
     respecting deps and detecting cycles. Must handle: transitive deps,
     diamond deps, self-references, missing deps, cycles."
  2. Code paths: src/plugins.ts, .claude/plugins.json schema, tests/ dir
  3. Dispatch to codex-agent with opus / high effort, read-only on src/,
     writable on tests/
  4. Agent returns: test plan (5 categories, 18 tests), tests/resolver.test.ts
     with failing assertions + per-test rationale comments
  5. Main Agent runs tests → all red → validates rationale → hands off
```
