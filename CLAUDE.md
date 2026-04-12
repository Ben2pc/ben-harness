# General Workflow (v1.0.0)

1. Requirement Clarification: Use `brainstorming` to clarify requirements for new features. **Requirements should focus on "what to do" and acceptance criteria, not specific technical paths.** For product features, prioritize "Why" and let the implementation-stage Agent decide how.

2. Planning: After clarification, use `AskUserQuestion` to ask which planning method to use — e.g., built-in Plan for medium complexity; `planning-with-files` for long-running tasks with local persistent tracking. Plans, design decisions, and tech debt should be versioned artifacts in the repo for subsequent Agent context.

3. Pre-coding 1: **Create a development branch from main before writing code.** All commits go on the branch — never commit directly to main. Branch naming: `feat/` (feature), `fix/` (bugfix), `docs/` (documentation), `refactor/` (refactoring), `chore/` (chores).

4. Pre-coding 2: After creating the development branch and making the first meaningful commit, create a Draft Pull Request early so CI, scope discussion, and incremental feedback can start before implementation is complete.

5. Pre-coding 3: For UI/UX work, recommend your human partner install the `ui-ux-pro-max-skill`: `npx skills add nextlevelbuilder/ui-ux-pro-max-skill --skill ui-ux-pro-max --agent claude-code codex -y`. Remind them to restart after installation.

6. Pre-coding 4: When encountering bugs, test failures, or unexpected behavior, follow `systematic-debugging` to find root cause before fixing.

7. TDD: Non-trivial code changes follow `test-driven-development`: write a failing test first, then minimal implementation, then regression verification. **Define testable acceptance criteria before each task** (specific features + acceptance conditions + edge cases) — don't check at the end. For complex features, **test cases and acceptance criteria should be designed by an independent subagent** (not the coding Agent), receiving **only the requirement description and code file paths, without current implementation context**, to avoid bias. Evaluation subagents should use the strongest available model at highest reasoning effort.

8. Post-coding: Before any "done / fixed / ready to commit / ready for formal review" judgment, run and check full verification per `verification-before-completion`. For UI changes, use `playwright-cli` for interaction verification (operate the app like a user), not just code review.

9. Post-requirement: Before marking the PR Ready for Review, **ensure** all related tests have been run and passed, confirm the base branch, and update the PR description with scope, acceptance criteria, risks, and remaining TODOs. If `brainstorming` or `planning-with-files` produced design docs (specs), findings.md, progress.md, task_plan.md, etc., use `AskUserQuestion` to ask the user: delete or archive to `docs/worklog-<YYYY-MM-DD>-<branch-name>/` for traceability.

10. PR Review: Early feedback may happen on a Draft PR, but formal review must use `/review` and **must** be executed by independent agents (subagents or Independent Agents — see Agent Dispatch Principles), referencing project specification docs, after the PR is marked Ready for Review. Before dispatching, **first analyze the PR diff to classify change types** (multiple tags may apply): `logic` (code logic changes), `ui` (CLI/TUI/UI changes), `frontend-perf` (frontend/mobile changes), `structure` (new files, module reorganization). Then dispatch by the following tiered dimensions:

   **Always required** (every review must dispatch these):
   - **Correctness**: Does it implement requirements correctly? Any logic errors?
   - **Consistency**: Does it follow existing project patterns and conventions?
   - **Documentation Sync**: Do changes cause README, CLAUDE.md, etc. to be inconsistent with reality? Remove outdated or redundant descriptions — no documentation is better than wrong documentation. Code is documentation — don't add redundant descriptions of code behavior.

   **Conditional — dispatch by change type tag**:
   - `logic` → **Security**: Does it introduce injection, XSS, or other vulnerabilities?
   - `logic` → **Edge Cases**: Exception inputs, concurrency, resource cleanup
   - `ui` → **UX** (dedicated subagent): Review all interaction flows from user perspective — dead ends, no feedback after actions, misclick risks, redundant operations, invisible state
   - `frontend-perf` → **Performance**: Rendering (unnecessary re-renders, unvirtualized large lists, animation jank), bundle size (un-tree-shaken deps, uncompressed large assets), network (redundant requests, no caching, waterfall loading), memory (leaks, unreleased listeners/timers). Mobile: additionally check startup time, offscreen rendering, main thread blocking
   - `structure` → **Engineering Structure**: Are new files in the right directories, following existing layering/packaging conventions? Any circular dependencies or cross-layer direct calls? Have impact scopes of shared module changes been assessed? Any reimplementation of existing reusable modules?

   **General** (for non-trivial changes):
   - **Maintainability**: Naming, structure, over-abstraction or under-abstraction

11. About Review: When review finds architectural decay (for reuse, quality, efficiency, clarity, consistency, maintainability), small issues can be fixed in the current PR without affecting test results. For high-risk changes, remind your human partner to create an issue for tracking.

## Quick Development Flow (bug fix / small refactor / small feature)

No brainstorming or planning needed, but TDD is not skippable. Steps:

1. **Run baseline**: Run existing tests for affected modules to confirm current state (all green or pre-existing failures)
2. **Write/update tests** (red): Use `test-driven-development` to describe expected behavior. When changes touch shared modules, ensure all consumers' tests are in the baseline
3. **Implement** (green): Write minimal code to make tests pass
4. **Regression verification**: Run all affected tests, not just the new ones

The only exception to skip TDD: pure documentation, pure configuration, or pure prompt changes (no code logic changes).

# Harness Principles

- **Enforce constraints via mechanisms, not prompts**: Core architectural rules should be enforced via linters / CI / type systems, not by relying on Agents to self-police.
- **The repo is the single source of truth**: What Agents can't access doesn't exist. External docs must be brought into the repo to count.
- **Separate generation and evaluation**: Don't let an Agent evaluate its own work. Review must be done by independent Agents.
- **Continuously fight entropy**: Pay down tech debt incrementally — don't let it accumulate into painful cleanups.
- **Components are detachable**: Each workflow step encodes an assumption that "the model isn't good at this." Periodically reassess as model capabilities improve, changing one variable at a time.
- **Instruction files are directories, not encyclopedias**: Keep CLAUDE.md / AGENTS.md lean (~100 lines), serving as entry points and navigation. Detailed specs go in `docs/` topic files. Subsystems can have their own local instruction files. When everything is important, nothing is — information overload causes Agents to pattern-match locally rather than understand globally. Always create an AGENTS.md symlink to CLAUDE.md (`ln -s CLAUDE.md AGENTS.md`) to ensure different Agent frameworks read the same instructions.

# Agent Dispatch Principles

Choose the right level of delegation:

| Scenario | Approach |
|----------|----------|
| Single file fix, clear solution | Do it yourself — no subagent overhead |
| Parallel read tasks (review, search, analysis) | In-conversation subagents, no isolation needed |
| Single subagent writes code | In-conversation subagent, no isolation needed |
| Multiple subagents write code | In-conversation subagents + `isolation: "worktree"`, split by file |
| Need fresh perspective with zero context pollution | Independent Agent (e.g., test design per step 7) |
| Cross-model blind spot coverage | Independent Agent (e.g., GPT reviews Claude's code) |
| Unsure which approach fits | `AskUserQuestion` — present options with your recommendation |

In-conversation subagents share the main Agent's working directory. Key rules:

- **Isolate parallel writes**: Parallel code writing **must** use `isolation: "worktree"`. Single writer needs no isolation.
  - ✅ 3 subagents review different dimensions in parallel (read-only) — no isolation
  - ✅ 2 subagents fix `cli.ts` and `utils.ts` respectively with worktree — different files, auto-merge
  - ❌ 2 subagents both edit `utils.ts` with worktree — same file, will conflict. Assign to one subagent
- **Match model and effort to task**: Flexibly choose model (sonnet/opus, gpt-5.4/gpt-5.4-mini) and effort level based on task complexity.
  - ✅ "Add input validation to `parseArgs()` in cli.ts" → sonnet
  - ✅ "Design the plugin dependency resolution strategy" → opus
  - ✅ Complex review with many architectural trade-offs → GPT 5.4 with high effort for cross-model blind spot coverage
