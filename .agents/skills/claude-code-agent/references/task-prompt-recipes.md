# Task Prompt Recipes

Use these as default prompt starters for `claude -p` or `claude --resume` when the job is diagnosis, planning, implementation, or structured handoff back to the parent agent.

Copy the smallest recipe that fits. Trim any block that does not materially improve the run.

## Diagnosis

```xml
<task>
Diagnose why this repository behavior, failing command, or failing test is broken.
Use tools to gather enough evidence to identify the most likely root cause.
</task>

<compact_output_contract>
Return:
1. most likely root cause
2. evidence
3. smallest safe next step
</compact_output_contract>

<default_follow_through_policy>
Keep going until you have enough evidence to support the diagnosis confidently.
Only stop to ask questions when a missing detail changes correctness materially.
</default_follow_through_policy>

<verification_loop>
Before finalizing, verify that the proposed root cause matches the observed evidence.
</verification_loop>

<missing_context_gating>
Do not guess missing repository facts.
If something required is absent, say exactly what remains unknown.
</missing_context_gating>
```

## Narrow Fix

```xml
<task>
Implement the smallest safe fix for the stated issue in this repository.
Preserve behavior outside the failing path.
</task>

<structured_output_contract>
Return:
1. summary of the fix
2. touched files
3. verification performed
4. residual risks or follow-ups
</structured_output_contract>

<default_follow_through_policy>
Default to the most reasonable low-risk interpretation and keep going.
</default_follow_through_policy>

<completeness_contract>
Finish the requested implementation instead of stopping after diagnosis.
</completeness_contract>

<verification_loop>
Before finalizing, verify that the fix matches the task and that the changed code is coherent.
</verification_loop>

<action_safety>
Keep changes tightly scoped to the stated task.
Avoid unrelated refactors or cleanup.
</action_safety>
```

## Planning Or Recon Pass

```xml
<task>
Inspect the current repository state and propose the smallest practical plan for the requested change.
Do not implement yet.
</task>

<structured_output_contract>
Return:
1. current-state findings
2. proposed approach
3. touched files or modules
4. key risks
5. verification plan
</structured_output_contract>

<grounding_rules>
Ground the plan in the repository context you inspected.
Do not invent modules or workflows that are not present.
</grounding_rules>
```

## Worktree-Isolated Implementation

```xml
<task>
Implement the requested change in the worktree created for this Claude Code session.
Act like an independent worker and carry the task through to verification.
</task>

<handoff_contract>
Return:
1. summary of the completed work
2. changed files
3. verification results
4. anything the parent agent must decide next
</handoff_contract>

<scope_guardrails>
Stay within the stated task.
Do not perform unrelated cleanup.
</scope_guardrails>

<verification_loop>
Before finalizing, run the most relevant checks that are available in the repository.
</verification_loop>
```

## Structured Output For A Parent Agent

```xml
<task>
Analyze the requested target and produce machine-consumable output only.
</task>

<structured_output_contract>
Return exactly the requested schema fields and nothing else.
Keep values compact and specific.
</structured_output_contract>

<grounding_rules>
Every field must be supported by repository context or tool outputs.
If a field cannot be filled reliably, say so in that field instead of guessing.
</grounding_rules>
```

## Follow-Up On The Same Claude Session

Use short delta instructions on `claude -p --resume` or `--continue` instead of replaying the whole original prompt when the direction has not changed.

Example:

```text
Continue from the current state. Keep the existing plan, apply the smallest safe fix, run the most relevant verification, and report only the final outcome plus touched files.
```
