# Review Prompt Recipes

Use these prompts when `claude-code-agent` is asked to review changes rather than implement them.

Pair them with `--permission-mode plan` and a read-oriented tool allowlist unless the task explicitly requires write access.

## Default Review

```xml
<task>
Review the requested changes for material correctness, regression risk, and missing tests.
Focus on the provided repository context only.
</task>

<structured_output_contract>
Return:
1. findings ordered by severity
2. supporting evidence for each finding
3. brief next steps
</structured_output_contract>

<grounding_rules>
Ground every claim in the repository context or tool outputs.
If a point is an inference, label it clearly.
</grounding_rules>

<verification_loop>
Before finalizing, make sure each finding is material and actionable.
</verification_loop>
```

## Adversarial Review

```xml
<role>
You are performing an adversarial software review.
Your job is to break confidence in the current approach, not to validate it.
</role>

<task>
Review the requested changes as if you are trying to find the strongest reasons they should not ship yet.
</task>

<operating_stance>
Default to skepticism.
Assume the change can fail in subtle, high-cost, or user-visible ways until the evidence says otherwise.
</operating_stance>

<attack_surface>
Prioritize:
- trust boundaries, permissions, and data exposure
- retries, partial failure, rollback, and idempotency
- empty-state, timeout, stale state, and concurrency behavior
- compatibility, migration, and observability gaps
</attack_surface>

<structured_output_contract>
Return:
1. blocking findings ordered by severity
2. exact file and line references
3. brief ship/no-ship summary
</structured_output_contract>

<grounding_rules>
Be aggressive, but stay grounded.
Do not invent files, code paths, or runtime behavior you cannot support.
</grounding_rules>
```

## Missing Tests Pass

```xml
<task>
Inspect the implementation and current tests, then report only meaningful missing test coverage.
</task>

<structured_output_contract>
Return:
1. missing test cases
2. why each case is uncovered
3. the exact test file that should own the case when inferable
</structured_output_contract>

<grounding_rules>
Only report a gap when the implementation path exists and current tests do not already cover it.
Do not suggest generic testing categories without repository evidence.
</grounding_rules>
```

## Contract Drift Review

```xml
<task>
Compare implementation, tests, and docs for contract drift.
Focus on mismatches that could mislead users or break downstream integrations.
</task>

<structured_output_contract>
Return:
1. confirmed drift items
2. evidence from code, tests, and docs
3. likely impact
</structured_output_contract>

<grounding_rules>
Only report drift you can support from the inspected files.
Do not infer undocumented intended behavior unless the repository provides evidence.
</grounding_rules>
```

## Useful Review Tail Constraint

Append this when you need a user-facing review style that is easy to consume:

```text
Findings first. Keep summaries brief. If there are no material issues, say that explicitly and mention any residual testing gaps.
```
