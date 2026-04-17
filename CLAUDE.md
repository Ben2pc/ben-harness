# General Workflow (v1.1.0)

1. Requirement Clarification: Use `brainstorming` to clarify requirements for new features. **Requirements should focus on "what to do" and acceptance criteria, not specific technical paths.** For product features, prioritize "Why" and let the implementation-stage Agent decide how.

2. Planning: After clarification, use `AskUserQuestion` to ask which planning method to use — e.g., built-in Plan for medium complexity; `planning-with-files` for long-running tasks with local persistent tracking. Plans, design decisions, and tech debt should be versioned artifacts in the repo for subsequent Agent context.

3. Pre-coding 1: **Create a development branch from main before writing code.** All commits go on the branch — never commit directly to main. Branch naming: `feat/` (feature), `fix/` (bugfix), `docs/` (documentation), `refactor/` (refactoring), `chore/` (chores).

4. Pre-coding 2: After creating the development branch and making the first meaningful commit, create a Draft Pull Request early so CI, scope discussion, and incremental feedback can start before implementation is complete.

5. Pre-coding 3: For UI/UX work, recommend your human partner install the `ui-ux-pro-max-skill`: `npx skills add nextlevelbuilder/ui-ux-pro-max-skill --skill ui-ux-pro-max --agent claude-code codex -y`. Remind them to restart after installation.

6. Pre-coding 4: When encountering bugs, test failures, or unexpected behavior, follow `systematic-debugging` to find root cause before fixing.

7. TDD: Non-trivial code changes follow `test-driven-development`: write a failing test first, then minimal implementation, then regression verification. **Define testable acceptance criteria before each task** (specific features + acceptance conditions + edge cases) — don't check at the end. For complex features, invoke the `test-designer` skill — it encodes **Independent Evaluation**, dispatching a context-free agent that sees only the requirement and code paths (not the implementation approach) and returns executable failing tests at highest reasoning effort.

8. Post-coding: Before any "done / fixed / ready to commit / ready for review" judgment, run and check full verification per `verification-before-completion`. For UI changes, use `playwright-cli` for interaction verification (operate the app like a user), not just code review.

9. PR Readiness: Keep the PR in Draft until verification is complete, the base branch is confirmed, and the PR description is updated with scope, acceptance criteria, risks, and remaining TODOs. Then mark the PR Ready for Review. If `brainstorming` or `planning-with-files` produced design docs (specs), findings.md, progress.md, task_plan.md, etc., use `AskUserQuestion` to ask the user: delete or archive to `docs/worklog-<YYYY-MM-DD>-<branch-name>/` for traceability.

10. PR Review: Early feedback may happen on a Draft PR. After the PR is Ready for Review, formal review must use the `deep-review` skill (invoke via `/deep-review` or ask "run a deep review"). The skill encodes **Independent Evaluation** and the full dispatch matrix — required three dimensions (correctness, consistency, documentation sync), conditional dimensions by change-type tag (`logic` → security + edge cases, `ui` → UX, `frontend-perf` → performance, `structure` → engineering structure), and general maintainability for non-trivial changes. `/review` (the plugin slash command) remains as a lightweight fallback.

11. About Review: When review finds architectural decay (for reuse, quality, efficiency, clarity, consistency, maintainability), small issues can be fixed in the current PR without affecting test results. For high-risk changes, remind your human partner to create an issue for tracking.

## Quick Development Flow (bug fix / small refactor / small feature)

Skip brainstorming and planning only; branch, Draft PR, TDD, verification, and review rules still apply. Steps:

1. **Run baseline**: Run existing tests for affected modules to confirm current state (all green or pre-existing failures)
2. **Write/update tests** (red): Use `test-driven-development` to describe expected behavior. When changes touch shared modules, ensure all consumers' tests are in the baseline
3. **Implement** (green): Write minimal code to make tests pass
4. **Regression verification**: Run all affected tests, not just the new ones

The only exception to skip TDD: pure documentation, pure configuration, or pure prompt changes (no code logic changes).

# Harness Principles

- **Enforce constraints via mechanisms, not prompts**: Core architectural rules should be enforced via linters / CI / type systems, not by relying on Agents to self-police.
- **The repo is the single source of truth**: What Agents can't access doesn't exist. External docs must be brought into the repo to count.
- **Independent Evaluation**: Test design for complex features and formal review must be done by independent agents; do not let an Agent evaluate its own work.
- **Continuously fight entropy**: Pay down tech debt incrementally — don't let it accumulate into painful cleanups.
- **Components are detachable**: Each workflow step encodes an assumption that "the model isn't good at this." Periodically reassess as model capabilities improve, changing one variable at a time.
- **Instruction files are directories, not encyclopedias**: Keep CLAUDE.md / AGENTS.md lean (~100 lines), serving as entry points and navigation. Detailed specs go in `docs/` topic files. Subsystems can have their own local instruction files. When everything is important, nothing is — information overload causes Agents to pattern-match locally rather than understand globally. Always create an AGENTS.md symlink to CLAUDE.md (`ln -s CLAUDE.md AGENTS.md`) to ensure different Agent frameworks read the same instructions.
- **Automation ladder (start conversational, codify later)**: Subagent invocation has five layers, from flexible to locked-in: in-conversation subagent → `.claude/agents/` → CLAUDE.md policy → Skill → Hook. **Each layer up the ladder locks in one more assumption.** Only promote a pattern up the ladder after it stabilizes across 3+ real uses. Premature promotion creates brittleness; `.claude/agents/` files accumulate, hooks fire in wrong contexts, and skills encode outdated dispatch structures. When in doubt, stay low on the ladder.

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
- **Always specify the output format** (shape + scope/length): a subagent without a format contract will dump verbose context back, cancelling the context benefit of dispatching. The rule is "must be explicit" — the specific format is task-dependent (e.g., "summary ≤300 words", "punch list, one finding per line", "diff + one-line rationale each", "structured JSON `{...}`", "one-paragraph verdict + one-line rationale"). Don't enumerate formats; pick the right one per task.
- **Anti-patterns — four scenarios where you should NOT dispatch parallel subagents**:
  1. **Serial-dependent tasks** — later step needs the full output of the earlier one; you gain nothing from parallelizing
  2. **Same-file parallel writes** — guaranteed conflict (mirror of "isolate parallel writes" above)
  3. **Tasks too small** — dispatch overhead > savings
  4. **Tasks requiring subagents to exchange intermediate state** — Claude Code has no agent-to-agent channel. Test: "can the task be split into slices with independent inputs and independent outputs?" If no, either serialize (A → main Agent relays to B) or merge into a single-line task. Note: sequential handoff (A → main → B) is NOT inter-agent communication; it's a normal pipeline.
