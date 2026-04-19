#!/bin/bash
# auriga-go ship mode — Stop hook.
#
# Registered via SKILL.md frontmatter. Fires on every Stop event while the
# auriga-go skill is active (for the rest of the session after invocation,
# per Claude Code skill-scoped hook lifecycle).
#
# Gated by state-file presence so step/auto modes are untouched:
# no state file = not in ship mode = immediate no-op.
#
# Pattern adapted from anthropics/claude-plugins-official ralph-loop
# (hooks/stop-hook.sh).
#
# Evaluation order (the reason it's not "cap-check then marker"):
#   marker → over-cap force exit → at-cap grace turn → normal re-feed
# A marker always wins so the ceremony turn can actually exit. The at-cap
# grace turn re-feeds a terminal prompt asking the Agent to post the
# Blocked PR comment and emit <ship-done>Blocked</ship-done>; the next
# Stop fires with iter > max, which forces a hard exit if the Agent still
# didn't emit a marker.

set -euo pipefail

STATE_FILE=".claude/auriga-go-ship.local.md"

# Gate: no state file = not in ship mode = no-op
[[ -f "$STATE_FILE" ]] || exit 0

HOOK_INPUT=$(cat)

# Parse YAML frontmatter (content between the two --- markers). Each grep
# is tolerated if absent: missing-field handling lives below, not here.
FRONTMATTER=$(sed -n '/^---$/,/^---$/{ /^---$/d; p; }' "$STATE_FILE")
ITERATION=$(echo "$FRONTMATTER" | grep '^iteration:' | sed 's/iteration: *//' || true)
MAX_ITERATIONS=$(echo "$FRONTMATTER" | grep '^max_iterations:' | sed 's/max_iterations: *//' || true)
STATE_SESSION=$(echo "$FRONTMATTER" | grep '^session_id:' | sed 's/session_id: *//' || true)

# Session isolation — state file is project-scoped but session-specific.
# If another session is running against the same file, don't interfere.
HOOK_SESSION=$(echo "$HOOK_INPUT" | jq -r '.session_id // ""')
if [[ -n "$STATE_SESSION" ]] && [[ "$STATE_SESSION" != "$HOOK_SESSION" ]]; then
  exit 0
fi

# Validate required numeric fields. max_iterations must be a positive int;
# zero or missing means the state file was hand-authored in a way that
# would silently kill the loop at iter 1 — treat as corruption.
if [[ ! "$ITERATION" =~ ^[0-9]+$ ]] || [[ ! "$MAX_ITERATIONS" =~ ^[0-9]+$ ]] || [[ "$MAX_ITERATIONS" -eq 0 ]]; then
  echo "auriga-go ship: state file corrupted ($STATE_FILE)" >&2
  echo "  iteration='$ITERATION' max_iterations='$MAX_ITERATIONS' (max_iterations must be a positive integer)" >&2
  echo "  Removing state file. Re-invoke /auriga-go ship to restart." >&2
  rm "$STATE_FILE"
  exit 0
fi

# Read transcript to scan the final assistant text block for the marker
TRANSCRIPT_PATH=$(echo "$HOOK_INPUT" | jq -r '.transcript_path')
if [[ ! -f "$TRANSCRIPT_PATH" ]]; then
  echo "auriga-go ship: transcript not found at $TRANSCRIPT_PATH. Exiting loop." >&2
  rm "$STATE_FILE"
  exit 0
fi

# Claude Code writes each content block as its own JSONL assistant-role line.
# Slurp the last 100 assistant lines, flatten to text blocks, take the final one.
LAST_LINES=$(grep '"role":"assistant"' "$TRANSCRIPT_PATH" | tail -n 100 || true)

MARKER=""
if [[ -n "$LAST_LINES" ]]; then
  set +e
  LAST_OUTPUT=$(echo "$LAST_LINES" | jq -rs '
    map(.message.content[]? | select(.type == "text") | .text) | last // ""
  ' 2>&1)
  JQ_EXIT=$?
  set -e

  if [[ $JQ_EXIT -ne 0 ]]; then
    echo "auriga-go ship: failed to parse transcript JSON. Exiting loop." >&2
    echo "  Error: $LAST_OUTPUT" >&2
    rm "$STATE_FILE"
    exit 0
  fi

  # Completion signal — perl -0777 slurps whole input, /s makes . match newline.
  # First match wins if the Agent emits both Ready and Blocked in one block.
  MARKER=$(echo "$LAST_OUTPUT" | perl -0777 -ne 'print $1 if /<ship-done>(Ready|Blocked)<\/ship-done>/s' 2>/dev/null || true)
fi

# 1. Marker present → normal / ceremony-done exit
if [[ -n "$MARKER" ]]; then
  echo "auriga-go ship: detected <ship-done>$MARKER</ship-done> at iter $ITERATION/$MAX_ITERATIONS" >&2
  rm "$STATE_FILE"
  exit 0
fi

# 2. Over cap and no marker → grace turn already used → hard exit
if [[ $ITERATION -gt $MAX_ITERATIONS ]]; then
  echo "auriga-go ship: grace turn elapsed at iter $ITERATION without <ship-done>Blocked</ship-done>. Forcing exit." >&2
  rm "$STATE_FILE"
  exit 0
fi

# Extract prompt body (everything after the closing --- of the frontmatter)
PROMPT_TEXT=$(awk '/^---$/{i++; next} i>=2' "$STATE_FILE")
if [[ -z "$PROMPT_TEXT" ]]; then
  echo "auriga-go ship: no prompt body in state file. Exiting loop." >&2
  rm "$STATE_FILE"
  exit 0
fi

# Atomically update iteration count (mktemp avoids predictable-name TOCTOU)
NEXT_ITERATION=$((ITERATION + 1))
TMP=$(mktemp "${STATE_FILE}.XXXXXX")
sed "s/^iteration: .*/iteration: $NEXT_ITERATION/" "$STATE_FILE" > "$TMP"
mv "$TMP" "$STATE_FILE"

# 3. At cap, no marker → grace turn: re-feed a terminal ceremony prompt
#    asking the Agent to post the Blocked PR comment and emit the marker.
#    iter is now max+1, so the next Stop (without marker) hits case 2.
if [[ $ITERATION -eq $MAX_ITERATIONS ]]; then
  GRACE_PROMPT="auriga-go ship: iteration budget exhausted ($ITERATION/$MAX_ITERATIONS reached). One grace turn remains to close out cleanly.

On this turn only:
1. Post a PR comment titled \"🚫 ship mode: Blocked at iter $ITERATION/$MAX_ITERATIONS\" using the template in skills/auriga-go/references/ship.md (autonomous decisions so far, last attempts, what's blocking, how the human can continue).
2. Emit <ship-done>Blocked</ship-done> as the final assistant text.
Do no other work. Do not try to keep solving — the budget is spent; this turn is ceremony only."

  SYSTEM_MSG="auriga-go ship grace turn — emit <ship-done>Blocked</ship-done> after posting the blocker PR comment, or the loop force-exits."

  jq -n \
    --arg prompt "$GRACE_PROMPT" \
    --arg msg "$SYSTEM_MSG" \
    '{
      "decision": "block",
      "reason": $prompt,
      "systemMessage": $msg
    }'
  exit 0
fi

# 4. Under cap, no marker → normal re-feed
SYSTEM_MSG="auriga-go ship iter $NEXT_ITERATION/$MAX_ITERATIONS — emit <ship-done>Ready</ship-done> ONLY when all four Ready terminal conditions hold; emit <ship-done>Blocked</ship-done> on hard stop."

jq -n \
  --arg prompt "$PROMPT_TEXT" \
  --arg msg "$SYSTEM_MSG" \
  '{
    "decision": "block",
    "reason": $prompt,
    "systemMessage": $msg
  }'

exit 0
