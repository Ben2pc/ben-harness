# Browser Research Prompt Recipes

Use these prompts for local-browser tasks where Codex should drive Chrome or another desktop browser through Computer Use, inspect web content, and report findings.

For these tasks, pair the prompt with `--sandbox read-only`. Add `Do not modify local files.` unless edits are explicitly part of the job.

## Community Signal Sampling

```xml
<task>
Use Computer Use on my Mac to open Google Chrome, search the requested community or forum, open a small representative set of posts, and summarize the findings in Chinese.
</task>

<sampling_rules>
Pick representative examples rather than many near-duplicates.
If the prompt asks for balancing, include explicitly different slices such as positive, negative, and long-term usage reports.
</sampling_rules>

<structured_output_contract>
Return:
1. observed facts from the sampled posts
2. recurring patterns
3. points of disagreement
4. uncertainties or evidence gaps
</structured_output_contract>

<grounding_rules>
Separate observed facts from inferences.
Do not claim broad market truth from a tiny sample.
</grounding_rules>
```

## Product Workflow Observation

```xml
<task>
Use Computer Use on my Mac to open the requested product site or web app, walk through the named workflow, and report what you observed.
</task>

<structured_output_contract>
Return:
1. workflow steps completed
2. visible friction points
3. errors or blockers
4. suggested next checks
</structured_output_contract>

<grounding_rules>
Report only what was actually observed in the browser session.
If a step could not be completed, say exactly where it stopped.
</grounding_rules>
```

## Evidence-First Chinese Summary

Append this when the user wants a concise Chinese write-up:

```text
Write the final summary in Chinese. Keep observed facts, inferred conclusions, and remaining uncertainties clearly separated.
```

## Safety Tail

Append this when you want a stronger browser-only boundary:

```text
Do not modify local files. Do not run write-capable repository commands unless the task explicitly requires them.
```
