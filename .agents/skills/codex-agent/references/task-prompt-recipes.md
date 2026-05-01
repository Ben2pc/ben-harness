# Task Prompt Recipes

Use these as default prompt starters for `codex exec` or `codex exec resume` when the job is diagnosis, planning, implementation, or prompt improvement.

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
Before finalizing, verify the fix matches the task and run the most relevant validation:
- targeted unit tests for the changed behavior
- type checks or lint when applicable
- a minimal smoke test if full validation is too expensive
If validation cannot run, say so and describe the next best check.
</verification_loop>

<solution_quality>
Implement the actual logic that solves the problem generally, not a workaround that only makes the failing test pass.
Do not hard-code values, special-case test inputs, or weaken or skip tests to turn them green.
If a test itself looks wrong or the requirement is infeasible, surface that in residual risks instead of patching around it.
</solution_quality>

<action_safety>
Keep changes tightly scoped to the stated task.
Avoid unrelated refactors or cleanup.
</action_safety>
```

## Planning Or Design Pass

```xml
<task>
Analyze this repository and propose the smallest practical plan for the requested change.
Do not implement yet.
</task>

<structured_output_contract>
Return:
1. current-state findings
2. proposed approach with each requirement traced to where it gets addressed
3. named resources, files, modules, APIs, or systems involved
4. state transitions or data flow when relevant
5. validation commands or checks to run
6. key risks and open questions that materially change the plan
</structured_output_contract>

<grounding_rules>
Ground the plan in the repository context you inspected.
Do not invent modules or workflows that are not present.
</grounding_rules>
```

## Frontend Implementation

```xml
<task>
Build the requested frontend interface as production-grade UI.
Decide the design direction before writing code; commit to one thesis and execute it consistently.
</task>

<design_thesis>
Before generating components, write down:
1. visual thesis (mood, material, energy in one sentence)
2. content plan (hero, supporting, detail, final CTA)
3. interaction thesis (2-3 intentional motions, not scattered micro-animations)
Each section has one job, one dominant visual idea, and one primary action.
Use realistic copy from the product context, not lorem ipsum or generic stock copy.
</design_thesis>

<design_system_contract>
Establish tokens as CSS variables before laying out sections:
- color: dominant base plus one sharp accent; avoid the purple-on-white default
- typography: one display face plus one body face; do not default to Inter, Roboto, Arial, or system stacks
- spacing, radius, and motion as named tokens reused across components
Cap at two typefaces and one accent unless the existing design system already requires more.
</design_system_contract>

<first_viewport_rule>
The first viewport contains: brand, one headline, one short supporting line, one CTA group, and one dominant image — and nothing else.
Do not place stat strips, schedules, metadata rows, address blocks, or secondary marketing in the first viewport.
On landing or promotional surfaces the hero runs full-bleed; reserve inset treatments for app or dashboard contexts.
Brand test: if the viewport could belong to another brand after removing the nav, the branding is too weak.
No cards in the hero. Outside the hero, use a card only when it is the container for an interaction.
</first_viewport_rule>

<presence_rule>
Build atmosphere instead of flat solid backgrounds: gradients, photography, geometric patterns, translucent layers, or contextual shadows that match the chosen direction.
Imagery must show product, place, or context — decorative gradients alone are not the visual anchor.
Use motion to reinforce hierarchy, not as noise; ship 2-3 intentional motions (one hero entrance, one scroll or sticky moment, one hover or layout transition).
</presence_rule>

<structured_output_contract>
Return:
1. summary of the design direction (visual thesis, palette, type pairing, signature moment)
2. created or changed files
3. verification performed (rendered viewports, accessibility, console errors)
4. residual risks or follow-ups
</structured_output_contract>

<verification_loop>
Before finalizing, render at least one wide and one narrow viewport.
Fix layout breaks, console errors, and missing keyboard or contrast affordances before reporting done.
</verification_loop>
```

Counterintuitive tip from OpenAI's GPT-5.4 frontend playbook: start with **low or medium reasoning effort** for simple frontends — higher reasoning often produces overthought aesthetics. Provide a Playwright MCP server or skill so Codex can render and inspect viewports natively; this dramatically tightens the verification loop for layout, state, and navigation. If the user attaches a reference screenshot or mood board, prefer that as the primary `<design_thesis>` anchor over text descriptions.

## Structured Output To Feed Another Tool

```xml
<task>
Analyze the requested target and produce machine-consumable output only.
</task>

<structured_output_contract>
Return exactly the requested schema fields and nothing else.
Keep values compact and specific.
</structured_output_contract>

<grounding_rules>
Every field must be supported by the repository context or tool outputs.
If a field cannot be filled reliably, say so in that field instead of guessing.
</grounding_rules>
```

## Prompt-Patching

```xml
<task>
Diagnose why this existing prompt is underperforming and propose the smallest high-leverage changes to improve it for Codex.
</task>

<structured_output_contract>
Return:
1. failure modes
2. root causes in the current prompt
3. a revised prompt
4. why the revision should work better
</structured_output_contract>

<grounding_rules>
Base your diagnosis on the prompt text and failure examples provided.
Do not invent unsupported failure modes.
</grounding_rules>

<verification_loop>
Before finalizing, make sure the revised prompt addresses the cited failure modes without adding contradictions.
</verification_loop>
```

## Follow-Up On The Same Codex Thread

Use short delta instructions on `codex exec resume` instead of replaying the whole original prompt when the direction has not changed.

Example:

```text
Continue from the current state. Keep the existing plan, apply the smallest safe fix, run the most relevant verification, and report only the final outcome plus touched files.
```
