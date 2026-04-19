---
name: auriga-go
description: Workflow autopilot for the CLAUDE.md 12-step auriga workflow. Trigger ONLY when (a) the user explicitly invokes `/auriga-go`, or (b) the user's phrasing clearly references the workflow itself — e.g., "按照工作流继续", "按工作流走", "drive the workflow forward", "workflow autopilot", "where are we in the workflow", "我们的 workflow 走到哪了". Do NOT trigger on generic phrases like plain "继续" / "continue" / "next" / "下一步" / "what's next" — those almost always refer to the current specific task (the main Agent can handle them directly), not workflow navigation. Also do not trigger for single-question lookups, one-off commit/push asks, or exploratory discussion. Includes an Experimental `ship` mode that drives spec → PR Ready autonomously (see references/ship.md).
argument-hint: "[step|auto|ship] [max-iter]"
hooks:
  Stop:
    - hooks:
        - type: command
          command: "${CLAUDE_SKILL_DIR}/scripts/ship-loop.sh"
---

# auriga-go — Workflow Autopilot

Drives the Agent forward along the CLAUDE.md general workflow with minimum prompting. **Reminder-based, not orchestrating** — it tells the main Agent which skill to invoke next, then steps back. Charioteer holding the reins, not driver pushing pedals.

**Workflow version anchor**: auriga Workflow v1.3.0 (`CLAUDE.md`). If the workflow has been rewritten since, treat the current `CLAUDE.md` as authoritative and flag the drift.

## When to Use

- User explicitly invokes `/auriga-go`
- User's phrasing clearly references the workflow itself: "按照工作流继续", "按工作流走", "drive the workflow", "workflow autopilot", "where are we in the workflow", "我们的 workflow 走到哪了"
- Session just resumed (`/clear` or context compaction) AND the previous workflow step is genuinely unclear AND the user wants to navigate by workflow (not by "just continue what I was doing")
- Workflow drift is evident: commits on `main`, no Draft PR, branch without `feat/`/`fix/`/`docs/` prefix, code written before a spec

**Don't use for:**
- Plain "继续" / "continue" / "next" / "下一步" / "what's next" — these refer to the current specific task; the main Agent handles them directly
- Single-question lookups ("what does this function do?") — just answer
- Explicit one-off actions ("commit this", "push", "open a PR for X")
- Exploratory discussion with no implementation intent
- Tasks the 12-step workflow doesn't cover

## Modes

| Mode | Iteration unit | Default? | When |
|---|---|---|---|
| `step` | 1 workflow step → return | no | Conservative — one action then check in. Use when the user wants to stay close to the wheel. |
| `auto` | Loop steps until a hard stop | **yes** | Default. Drives forward across multiple steps until ambiguity, destructive op, or a natural human-decision gate (`AskUserQuestion` / Plan approval / Confirmation Contract). No iteration budget — hard stops do the work. |
| `ship` | Loop until Draft → Ready candidate | no, **Experimental** | High-autonomy. Drives spec → PR Ready autonomously with strictest defaults. **Read [`references/ship.md`](references/ship.md) before invoking.** Hard `max-iter` ~30 (enforced by the bundled Stop hook). |

Default to `auto` unless the user specifies otherwise or the work involves a destructive operation in scope.

## Arguments

Invocation: `/auriga-go [mode] [ship-max-iter]`, or natural-language trigger like "按照工作流继续".

Parse `$ARGUMENTS` (the full argument string):

- **Empty / no args** → mode = `auto`
- **First token is `step` / `auto` / `ship`** → use as mode
- **Subsequent integer, only when mode = `ship`** → override ship's `max-iter` (default 30). Ignored for step/auto since they have no iteration budget.
- **Natural-language text with no mode keyword** → mode = `auto`, with the text as the task context
- **NL text mentioning "ship" / "跑到 Ready" / "到 Ready for Review"** → consider `ship` but **confirm with the user before entering** (Experimental — opt-in)

Examples (what `$ARGUMENTS` receives):

| User types | `$ARGUMENTS` | Resolved |
|---|---|---|
| `/auriga-go` | (empty) | auto |
| `/auriga-go step` | `step` | step |
| `/auriga-go auto` | `auto` | auto |
| `/auriga-go ship` | `ship` | ship, max-iter=30 |
| `/auriga-go ship 50` | `ship 50` | ship, max-iter=50 |
| `按照工作流继续` | `按照工作流继续` | auto |

## Algorithm (step + auto)

```
loop:
  1. Read current state
  2. Identify next workflow step (Stop Contract checked here)
  3. Echo intent (one line, mandatory)
  4. Recommend next action to main Agent
  5. If mode == step: return
     If mode == auto: continue
```

### 1. Read current state

Try sources in order; stop at the first that gives an unambiguous answer:

1. **Main Agent context** — TodoWrite list, in-flight task description, recent tool results. Usually enough; check this first.
2. **`task_plan.md` / `progress.md`** — if `planning-with-files` is in use, these track step-by-step progress.
3. **Open Draft PR body TODOs** — `gh pr view --json body` and look for `- [ ]` checkboxes.
4. **Repo state heuristics** — derive signals from git / filesystem / GitHub state per situation. Examples (not an exhaustive table — model judges per context):
   - `git branch --show-current` starts with `feat/`/`fix/`/`docs/` → past step 3
   - `gh pr list --draft --head $(git branch --show-current)` returns a row → past step 4
   - `git rev-list @{u}..HEAD --count > 0` → step 10 not done
   - `docs/specs/*.md` exists → step 1 was run
   - Recent test/verification command in transcript → step 9 in progress

If sources 2–4 were needed, **fall through to the Confirmation Contract** (below) before writing todos and proceeding. Wrong inferences compound across iterations.

### 2. Identify next workflow step

Match current state to the CLAUDE.md 12 steps:

1. Requirement clarification (`brainstorming`)
2. Planning method choice (`AskUserQuestion` → built-in Plan or `planning-with-files`)
3. Create dev branch from main
4. Create Draft PR
5. UI/UX skill recommendation (conditional)
6. Bug investigation (`systematic-debugging`, conditional)
7. TDD red phase (`test-driven-development`, optionally `test-designer`)
8. Parallel implementation (`parallel-implementation`, conditional thresholds)
9. Verification (`verification-before-completion`)
10. PR readiness (push, update body, archive specs per Document Conventions, flip Ready)
11. Formal review (`deep-review`)
12. Address review findings

Next step = lowest-numbered unfinished step that matches current state. Apply CLAUDE.md's Quick Development Flow exception (skip 1–2) for bug fix / small refactor / small feature when appropriate.

### 3. Echo intent (mandatory, one line)

**Every iteration begins with this echo, before any tool call or recommendation:**

- step / auto (no hard budget): `[auriga-go iter N] 现状：<state> → 下一步：<action>`
- ship (hard budget from the Stop hook): `[auriga-go iter N/M] 现状：<state> → 下一步：<action>`

Examples:
- `[auriga-go iter 1] 现状：feat/foo 分支 + Draft PR 已建 + 0 commits → 下一步：step 7 TDD 红灯 (test-designer)` *(auto)*
- `[auriga-go iter 3] 现状：测试通过 + 未推送 commits → 下一步：step 10 PR readiness (push + update body)` *(auto)*
- `[auriga-go iter 4/30] 现状：deep-review punch list 空 → 下一步：flip Draft → Ready` *(ship)*

**Why this is mandatory.** It's the user's interrupt window — they can stop you before a wrong step runs. It's also the only audit trail when something later turns out off. Skipping it to "save tokens" trades cheap token cost for expensive recovery work later.

### 4. Recommend next action

This skill **does not dispatch other skills**. For each next step, name the action and let the main Agent execute:

- "Step 1 → invoke `brainstorming` skill, then return."
- "Step 3 → run `git checkout -b feat/<descriptive-name> main`."
- "Step 7 → invoke `test-designer` with the spec at `docs/specs/<name>.md`."
- "Step 11 → invoke `deep-review` (or run `/deep-review`)."

This keeps the skill thin and lets the main Agent own tool choice, model selection, and effort tuning. It also avoids the Subagent dispatch traps (output-format contract, isolation, max parallel) that already live in the dispatched skills themselves.

## Stop Contract

Hard-stop and return control to the user in exactly two situations:

1. **Ambiguity that needs a human answer** — requirement gap, design choice with two equally-valid paths, missing info that no probing can resolve. Don't guess; ask.
2. **Destructive or irreversible operations** — anything that mutates shared state in a way you can't easily undo. The model judges per context (no enumerated whitelist), but the spirit is: force-push to shared refs, main-branch writes, broad `rm -rf`, package publishes (`npm publish`, `gh release create`), CI/CD pipeline mutations, anything that affects other developers' machines or production systems.

In both cases, **explain why you stopped and what you need from the user** — don't silently exit.

Everything else is push-forward territory:
- `AskUserQuestion`-style choices — if the workflow encodes a default (e.g., "use `auto` mode default"), take it; only stop if no reasonable default exists
- Test failures — invoke `systematic-debugging` and continue
- Small structural decisions — pick one, note it in the intent echo, move on

## Confirmation Contract (fallback path only)

When current-state inference came from sources 2–4 (not from main-Agent context), present findings and confirm with the user **before writing todos and proceeding**:

```
状态推断（来自 [task_plan.md / Draft PR body / git heuristics]）：
- <signal 1> → <inference 1>
- <signal 2> → <inference 2>

推断当前在 step <N>，下一步 <action>。确认后我开始执行。
```

This is the mitigation for wrong fallback inference. A wrong guess compounds across iterations; one confirmation up front saves a runaway loop.

If main-Agent context was sufficient (source 1 only), skip this — confirmation isn't needed when the state is already in view.

## Loop budget

- `step`: n/a (single iteration)
- `auto`: **no hard budget** — hard stops (ambiguity / destructive) and natural human-decision gates (`AskUserQuestion`, Plan approval, Confirmation Contract) do the terminating. The `iter N` in the intent echo is a progress marker, not a countdown.
- `ship`: hard `max-iter` ~30, enforced by the bundled Stop hook at `scripts/ship-loop.sh` (see references/ship.md)

## Ship mode (Experimental)

`ship` drives the workflow from spec → PR Ready autonomously using CLAUDE.md's strictest defaults at every decision point. The loop is **hook-backed** — a Stop hook bundled with this skill (`scripts/ship-loop.sh`, registered in this SKILL.md's frontmatter) intercepts session-end and re-feeds the ship prompt until a completion marker (`<ship-done>Ready|Blocked</ship-done>`) or `max-iter` fires. Auto-resumes across `/clear` because hooks and the state file survive context compaction.

**Before invoking ship mode, read [`references/ship.md`](references/ship.md)** — it covers the state-file schema, completion markers, Ready terminal conditions, strict defaults table, and Experimental opt-in warning. Do not enter ship via natural language without confirming with the user first.

## Anti-patterns

- ❌ Dispatching other skills directly from inside auriga-go — let the main Agent do it; auriga-go only recommends
- ❌ Skipping the intent echo to "save tokens" — the echo is the user's interrupt window and the only audit trail
- ❌ Proceeding past a fallback inference without confirmation — a wrong guess compounds
- ❌ Continuing past `max-iter` in `ship` — the hook will force-stop, but post a blocker PR comment first so the audit trail isn't empty
- ❌ Trying to enumerate a hard-stop whitelist in this file — the contract is two classes; the model judges per context
- ❌ Treating the workflow step list as rigid — apply CLAUDE.md's Quick Development Flow exception when relevant

## Example invocations

### Resume after `/clear`

```
User: 按照工作流继续

auriga-go (auto):
  状态推断（来自 git + Draft PR）：
  - 当前分支 feat/auriga-go-skill + Draft PR #20 → step 4 已完成
  - docs/specs/auriga-go-design.md 存在 → step 1 已完成
  - 测试未跑 → step 9 未开始
  推断当前在 step 7 TDD。确认后我开始执行。

User: 确认

auriga-go (auto):
  [auriga-go iter 2] 现状：spec 完整 + 待 TDD → 下一步：step 7 invoke test-designer
  → main Agent invokes test-designer with docs/specs/auriga-go-design.md
```

### Step mode for cautious progress

```
User: /auriga-go step

auriga-go (step):
  [auriga-go iter 1] 现状：测试全绿 + 未推送 commits → 下一步：step 10 push + update PR body
  推荐执行：git push && gh pr edit --body-file <updated body>。继续吗？
```

### Hard stop on ambiguity

```
auriga-go (auto):
  [auriga-go iter 4] 现状：deep-review 返回 punch list（3 blocking）→ 下一步：决定处理方式

  Stop: 三个 blocking 中 #2 涉及架构调整（重构 src/skills.ts），按 CLAUDE.md
  step 12 应"高风险变更立 issue 跟踪，不并入本 PR"。需要确认：本 PR 内修复
  还是新开 issue？
```
