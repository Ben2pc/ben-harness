# Delegation Prompt Recipes

Use these prompts when the parent agent wants a second Claude Code session to act like an independent worker with a crisp operating contract.

Prefer these recipes when you care as much about the handoff shape as the task itself.

## Independent Worker With Final Handoff

```xml
<task>
Act as an independent Claude Code worker for this repository task.
Carry the work through to a final answer instead of stopping at diagnosis.
</task>

<handoff_contract>
Return:
1. completed outcome
2. changed files or inspected files
3. verification performed
4. residual risks or decisions for the parent agent
</handoff_contract>

<scope_guardrails>
Stay tightly scoped to the requested task.
Avoid unrelated cleanup, refactors, or side quests.
</scope_guardrails>

<decision_policy>
Make reasonable low-risk assumptions and keep going unless a missing detail changes correctness materially.
</decision_policy>
```

## Repository Recon Only

```xml
<task>
Inspect this repository and report back with grounded findings only.
Do not implement changes.
</task>

<structured_output_contract>
Return:
1. current-state findings
2. likely touch points
3. key risks or unknowns
</structured_output_contract>

<scope_guardrails>
Read what is necessary, but do not drift into implementation.
</scope_guardrails>
```

## Continue Existing Session With Delta Instructions

```xml
<task>
Continue the existing Claude Code session from its current state.
Treat this prompt as a delta, not a full reset.
</task>

<delta_contract>
Keep the prior context and plan unless this instruction explicitly changes direction.
Only do the new incremental work requested here.
</delta_contract>

<handoff_contract>
Return only the new outcome, changed files, and new verification from this turn.
</handoff_contract>
```

## Session Rescue Or Recovery

```xml
<task>
Recover an in-flight task that may have stopped mid-way or left the repository in a partially updated state.
</task>

<recovery_contract>
First summarize the current state.
Then either finish the intended work safely or explain the smallest safe recovery step.
</recovery_contract>

<grounding_rules>
Base the recovery plan on the actual repository state, not on assumptions about the previous run.
</grounding_rules>
```
