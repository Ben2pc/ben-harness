# General Workflow (v0.1.0)

1. Requirement Clarification: Use `brainstorming` to clarify requirements for new features. **Requirements should focus on "what to do" and acceptance criteria, not specific technical paths.** For product features, prioritize "Why" and let the implementation-stage Agent decide how.

2. Planning: After clarification, use `AskUserQuestion` to ask which planning method to use — e.g., built-in Plan for medium complexity; `planning-with-files` for long-running tasks with local persistent tracking. Plans, design decisions, and tech debt should be versioned artifacts in the repo for subsequent Agent context.

3. Pre-coding 1: **Create a development branch from main before writing code.** All commits go on the branch — never commit directly to main. Branch naming: `feat/` (feature), `fix/` (bugfix), `docs/` (documentation), `refactor/` (refactoring), `chore/` (chores).

4. Pre-coding 2: For UI/UX work, recommend your human partner install the `ui-ux-pro-max-skill`: `npx skills add nextlevelbuilder/ui-ux-pro-max-skill --skill ui-ux-pro-max --agent claude-code codex -y`. Remind them to restart after installation.

5. Pre-coding 3: When encountering bugs, test failures, or unexpected behavior, follow `systematic-debugging` to find root cause before fixing.

6. TDD: Non-trivial code changes follow `test-driven-development`: write a failing test first, then minimal implementation, then regression verification. **Define testable acceptance criteria before each task** (specific features + acceptance conditions + edge cases) — don't check at the end. For complex features, **test cases and acceptance criteria should be designed by an independent subagent** (not the coding Agent), receiving **only the requirement description and code file paths, without current implementation context**, to avoid bias. Evaluation subagents should use the strongest available model at highest reasoning effort.

## Quick Development Flow (bug fix / small refactor / small feature)

No brainstorming or planning needed, but TDD is not skippable. Steps:

1. **Run baseline**: Run existing tests for affected modules to confirm current state (all green or pre-existing failures)
2. **Write/update tests** (red): Use `test-driven-development` to describe expected behavior. When changes touch shared modules, ensure all consumers' tests are in the baseline
3. **Implement** (green): Write minimal code to make tests pass
4. **Regression verification**: Run all affected tests, not just the new ones

The only exception to skip TDD: pure documentation, pure configuration, or pure prompt changes (no code logic changes).

7. Post-coding: Before any "done / fixed / ready to commit" judgment, run and check full verification per `verification-before-completion`. For UI changes, use `playwright-cli` for interaction verification (operate the app like a user), not just code review.

8. Post-requirement: After development branch work, **ensure** all related tests have been run and passed, confirm the base branch, and submit a Pull Request. If `brainstorming` or `planning-with-files` produced design docs (specs), findings.md, progress.md, task_plan.md, etc., use `AskUserQuestion` to ask the user: delete or archive to `docs/worklog-<YYYY-MM-DD>-<branch-name>/` for traceability.

9. Post-PR: Remind your human partner to use `/review` for review, which **must** be executed by subagents — dispatch multiple subagents for different dimensions, referencing project specification docs during review. Review subagents use the following structured scoring dimensions (weighted by model blind spots):
   1. **Correctness**: Does it implement requirements correctly? Any logic errors?
   2. **Security** (high weight): Does it introduce injection, XSS, or other vulnerabilities?
   3. **Consistency** (high weight): Does it follow existing project patterns and conventions?
   4. **Edge Cases** (high weight): Exception inputs, concurrency, resource cleanup
   5. **Maintainability**: Naming, structure, over-abstraction or under-abstraction
   6. **UX** (required for CLI/TUI/UI): Review all interaction flows from user perspective — dead ends, no feedback after actions, misclick risks, redundant operations, invisible state. Dispatch a dedicated subagent for UX review
   7. **Performance** (high weight for frontend/mobile): Rendering (unnecessary re-renders, unvirtualized large lists, animation jank), bundle size (un-tree-shaken deps, uncompressed large assets), network (redundant requests, no caching, waterfall loading), memory (leaks, unreleased listeners/timers). Mobile: additionally check startup time, offscreen rendering, main thread blocking
   8. **Documentation Sync**: Code is documentation — avoid redundant descriptions of code behavior. Only check: do changes cause README, CLAUDE.md, etc. to be inconsistent with reality? Remove outdated or redundant descriptions — no documentation is better than wrong documentation
   9. **Engineering Structure**: Are new files in the right directories, following existing layering/packaging conventions? Any circular dependencies or cross-layer direct calls? Have impact scopes of shared module changes been assessed? Any reimplementation of existing reusable modules?

10. About Review: When review finds architectural decay (for reuse, quality, efficiency, clarity, consistency, maintainability), small issues can be fixed in the current PR without affecting test results. For high-risk changes, remind your human partner to create an issue for tracking.

# Harness Principles

- **Enforce constraints via mechanisms, not prompts**: Core architectural rules should be enforced via linters / CI / type systems, not by relying on Agents to self-police.
- **The repo is the single source of truth**: What Agents can't access doesn't exist. External docs must be brought into the repo to count.
- **Separate generation and evaluation**: Don't let an Agent evaluate its own work. Review must be done by independent Agents.
- **Continuously fight entropy**: Pay down tech debt incrementally — don't let it accumulate into painful cleanups.
- **Components are detachable**: Each workflow step encodes an assumption that "the model isn't good at this." Periodically reassess as model capabilities improve, changing one variable at a time.
- **Instruction files are directories, not encyclopedias**: Keep CLAUDE.md / AGENTS.md lean (~100 lines), serving as entry points and navigation. Detailed specs go in `docs/` topic files. Subsystems can have their own local instruction files. When everything is important, nothing is — information overload causes Agents to pattern-match locally rather than understand globally. Always create an AGENTS.md symlink to CLAUDE.md (`ln -s CLAUDE.md AGENTS.md`) to ensure different Agent frameworks read the same instructions.

# Subagent Usage Principles

In-conversation subagents (Agent tool) share the main Agent's working directory — be mindful of read/write isolation:

- **Read in parallel, isolate writes**: Multiple subagents can read in parallel (review, search, analyze), but parallel code writing **must** use `isolation: "worktree"`, otherwise later writes silently overwrite earlier ones.
- **Single writer needs no isolation**: When only one subagent writes code, no worktree is needed — write directly.
- **Use appropriate models**: When the approach is clear, assign medium/small-granularity coding tasks to sonnet / gpt-5.4-mini / gpt-5.3-codex-spark — no need for opus/gpt-5.4. Saves tokens, runs faster.
- **Review -> Fix strategy**: For few/simple changes, the main Agent fixes directly — no subagent needed. For multiple complex fixes requiring parallel subagents, proactively start reviews with `isolation: "worktree"` when you anticipate large fixes, so the review agent can fix directly without rebuilding context. For uncertain fix scope, review without isolation first, then dispatch isolated subagents if needed.
- **Split tasks by file/module**: Parallel worktree subagents fork from the same commit. Changes to different files auto-merge; changes to the same file create conflicts. Task boundaries by file are better than by function.
- **Don't manually `git worktree`**: `isolation: "worktree"` doesn't just create a worktree — it switches the agent's entire tool path context and handles merging and cleanup automatically. Manual worktrees cause Read/Edit tool paths to be inconsistent with Bash.

# Independent Agent Usage Guide

Independent Agents (e.g., Codex plugin's rescue subagent) provide process-level isolation (independent context, independent model instance) — more thorough than in-conversation subagents.

**Good use cases**:
- **Independent evaluation/test design**: Acceptance criteria design per step 6, requiring complete isolation from current implementation context
- **Cross-model review**: Different models reviewing each other's code (e.g., GPT reviewing Claude's code) — different models have different blind spots, catching issues same-model review misses
- **Long parallel tasks**: One writing code, one writing docs/tests, non-blocking

**Poor use cases**:
- Simple code search, small changes — in-conversation subagents suffice, process overhead not worthwhile
- Tasks requiring frequent back-and-forth — inter-process communication cost is high
