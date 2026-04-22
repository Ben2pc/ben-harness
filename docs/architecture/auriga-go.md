# auriga-go — Workflow Autopilot Skill

**Status**: stable · promoted from `docs/specs/` on 2026-04-19
**Workflow version anchor**: auriga Workflow v1.4.0 (`CLAUDE.md`)

> This document captures the **decisions and rationale** behind auriga-go. The **live runtime contract** — modes, markers, state-file schema, strict defaults, grace-turn mechanics — lives in `plugins/auriga-go/skills/auriga-go/SKILL.md`; the ship-mode specifics (PR-comment templates, Ready/Blocked ceremonies) live in `plugins/auriga-go/skills/auriga-go/references/ship.md`. When this doc disagrees with those, the skill files win.

## Purpose

A workflow skill that drives the Agent forward along the auriga workflow (`CLAUDE.md`) with minimum prompting. When invoked, it inspects state, determines the next action, and executes (auto mode) or proposes one step (step mode). It stops only at two classes of hard stops:

1. Ambiguity that requires a human answer (requirement / design choice, two or more equally-valid paths).
2. Destructive or irreversible operations (force push, main-branch writes, file deletion, `--no-verify` or other safety bypass, package publish, CI/CD mutation).

## Name

`auriga-go` — continues the Latin *auriga* ("charioteer") motif of the project with *go* indicating forward motion. The charioteer keeps driving.

## Placement

- **Source in this repo**: `plugins/auriga-go/` (plugin root). Contains `.claude-plugin/plugin.json`, `hooks/hooks.json`, `scripts/ship-loop.sh`, and `skills/auriga-go/` (SKILL.md + references/ship.md). The skill is bundled *inside* the plugin so the description-based NL trigger (`/auriga-go`, "按照工作流继续", etc.) is preserved.
- **Installed to user project**: materialized by `claude plugins install auriga-go@auriga-cli` under the Claude Code plugin directory. Claude Code auto-discovers `skills/` subdirectories inside installed plugins.
- **Install mechanism**: Claude Code plugin system.
  - Repo-root `.claude-plugin/marketplace.json` lists the plugin (`"source": "./plugins/auriga-go"`).
  - `.claude/plugins.json` advertises `auriga-go@auriga-cli` with `marketplace: { name: "auriga-cli", source: "Ben2pc/auriga-cli" }` so `npx auriga-cli` → Plugins offers it.
  - User-facing install: `claude plugins marketplace add Ben2pc/auriga-cli` + `claude plugins install auriga-go@auriga-cli`, or just `npx auriga-cli`.
- **Tier**: plugin — first-party, shipped as a default-offered option.

> **Why not a skill?** Originally this *was* a skill with a `hooks:` block in its SKILL.md frontmatter. Claude Code's `${CLAUDE_SKILL_DIR}` substitution does not currently expand inside skill-bundled hook commands (empirically verified in both `claude -p` and interactive mode), and the hook's cwd is the project root (not the skill dir) so the documented `./scripts/...` form also fails. Plugins use `${CLAUDE_PLUGIN_ROOT}`, which expands reliably. Promoting auriga-go to a plugin + bundling the skill inside keeps the NL-trigger ergonomics while unblocking the Stop hook.

## Decisions locked in (brainstorming §1)

| Area | Decision |
|---|---|
| Scenario | **E** — unified "workflow state machine" entry: covers session resume (`/clear` / compact), handoff of half-done work, workflow correction, and generic "what's next" compass. |
| Output type | **③ Autonomous driving** — detect state → take action → loop until a hard stop. |
| Hard stops | Exactly two classes: (a) ambiguity that needs a human answer; (b) destructive / irreversible operations. Everything else: push forward. |
| Primary data source | **Agent context** — whatever the main Agent already sees (its native task/todo tracker, in-flight tasks, recent tool results). |
| Fallback data sources (probed on miss) | **A**: `planning-with-files` artifacts (`task_plan.md`, `progress.md`). **C**: open Draft PR body TODO checkboxes. **D**: git / filesystem / GitHub state evaluated against the workflow heuristic. |
| Fallback protocol | When context is insufficient → probe A/C/D → present findings → confirm with user → write todos → proceed. |
| Architecture | **Approach 3** — three modes: `mode=step` (single action + return, conservative); `mode=auto` (default, internal loop, stops at any human-decision gate); `mode=ship` *(Experimental)* (drives spec → PR Ready autonomously; applies CLAUDE.md's strictest defaults at every decision point; runs in-Draft `deep-review` before flipping Ready; loop continues until Ready terminal conditions hold, or `max-iter` exceeded). |

## Resolved clarifications (rationale archive)

| Area | Decision + rationale |
|---|---|
| Invocation | `/auriga-go` slash command **OR** natural-language trigger (e.g., "按照工作流继续", "continue the workflow"). Both paths enter the same skill. |
| Relationship with other workflow skills | **Reminder-based, not orchestrating.** auriga-go inspects state and tells the main Agent which skill to invoke next (`brainstorming`, `planning-with-files`, `test-designer`, `deep-review`, etc.); it never dispatches those skills itself. Keeps the skill thin and lets the main Agent own tool choice. |
| CLAUDE.md integration | **Independent meta-tool** — not embedded in any numbered step. Referenced from the workflow as a compass/autopilot available at any point. |
| Hard-stop enumeration | **No explicit whitelist.** The two contract classes (ambiguity / destructive-or-irreversible) stay as-is; rely on the model to recognize concrete commands in context. Rationale: destructive operations are low-frequency and context-sensitive — an enumeration would both miss cases and add maintenance drag. |
| Fallback D state signals | **No fixed signal → workflow-step mapping table.** SKILL.md describes the fallback *intent* (probe git / filesystem / GitHub state → present findings → confirm with user → write todos → proceed); the model derives the concrete signals per situation. |
| Progress visibility | **No prescribed echo format.** Each Agent has its own task tracker; auriga-go's job is to tell the Agent to record the current workflow step through that native tracker. ship adds one mandatory transcript tag (`<ship-done>Ready\|Blocked</ship-done>` as the final assistant text — the Stop-hook signal) and one mandatory PR-side artifact per exit (the decisions/review-points comment). No mid-run echo prescribed. |
| Ship-mode exit ceremony | **Every exit posts a PR comment** — both Ready (success) and Blocked (stop). Comment documents strict defaults applied, case-specific judgments, recent fix attempts (Blocked only), and review points the human must verify. Rationale: ship runs without per-step user gates, so the Agent owes the human a post-hoc audit trail at the one place both humans and future Agents will look — the PR thread. |
| Budget-exhaustion ceremony | **Grace turn** — when `iteration == max_iterations` and no marker, the Stop hook re-feeds a terminal ceremony prompt ("post the Blocked comment and emit the marker, no other work"). Next Stop (`iteration > max_iterations`) force-exits unconditionally. Rationale: without a grace turn, budget exhaustion would trigger a silent kill that leaves no blocker comment — exactly the "silent give-up" the contract prohibits. |
| Fix-loop budgeting (ship) | Fix-loop iterations count against the top-level `max-iter` — single shared budget, no nested counter. |
| Acceptance criteria | `deep-review` passes on the PR + human-partner dogfooding. No pre-specified smoke/integration test matrix — real usage is the test. |

## Risks

- **Autonomy tension** with CLAUDE.md's "Automation ladder — start low" principle. Mitigations: two-class hard-stop contract, Confirmation Contract on fallback inference, recording every workflow step through the Agent's native task tracker, ship's hook-enforced budget, `mode=step` escape hatch.
- **State-detection misreads** in fallback path D. Mitigation: fallback-path results must be confirmed with the user before todos are written.
- **Loop runaway** in `mode=ship`. Mitigation: hard `max-iter` budget enforced by the bundled Stop hook; fix-loop iterations count against the same budget. `mode=auto` has no hard cap but natural human-decision gates fire as de facto pause points.
- **Version skew** with CLAUDE.md workflow — if the workflow evolves, `auriga-go`'s encoded view drifts. Mitigation: pin the workflow version in this doc's header; treat workflow rewrites as a trigger to bump the skill.
- **Ship mode produces a flawed Ready PR**. Mitigations: (i) strictest defaults at every decision point; (ii) in-Draft `deep-review` self-pass before flipping Ready; (iii) `max-iter` cap with a clear Blocked PR comment on budget exhaustion (no silent give-up); (iv) `Experimental` tag both in SKILL.md header and as a one-line runtime warning when invoked; (v) the state file's `iteration:` field + the Agent's native task tracker + the mandatory exit PR comment form the post-hoc audit trail.

## Built artifacts

- `plugins/auriga-go/.claude-plugin/plugin.json` — plugin metadata (name, description, author)
- `plugins/auriga-go/hooks/hooks.json` — Stop hook registered at plugin level, `command: "${CLAUDE_PLUGIN_ROOT}/scripts/ship-loop.sh"`
- `plugins/auriga-go/skills/auriga-go/SKILL.md` — frontmatter (`argument-hint`), algorithm, Stop/Confirmation contracts, three-mode table, examples. No `hooks:` block — the hook is registered at plugin level
- `plugins/auriga-go/skills/auriga-go/references/ship.md` — hook-backed loop contract, marker schema, state-file schema, strict-defaults table, Ready/Blocked PR-comment templates, grace-turn mechanics, Blocked exit protocol
- `plugins/auriga-go/scripts/ship-loop.sh` — Stop hook adapted from ralph-loop, state-file-gated so step/auto are untouched; unit tests at `tests/ship-loop.test.sh`
- `plugins/auriga-go/README.md` — plugin overview and manual install instructions
- Repo-root `.claude-plugin/marketplace.json` — marketplace manifest listing auriga-go
- `.claude/plugins.json` — entry for `auriga-go@auriga-cli` so `npx auriga-cli` → Plugins offers it
- Root `CLAUDE.md` / `CLAUDE.zh-CN.md` do **not** reference auriga-go anymore — the dedicated "Workflow Autopilot" section was removed in the CLAUDE.md slim pass (PR #46) to keep the workflow spec minimal. auriga-go is now surfaced only via the Plugins table in `README.md` / `README.zh-CN.md` and the marketplace manifest.
- `README.md` + `README.zh-CN.md` plugins-table row (removed from skills-table as part of the plugin conversion)
- `.claude/CLAUDE.md` dev-guide documents plugin-owned authoring convention and the `${CLAUDE_SKILL_DIR}` bug workaround
