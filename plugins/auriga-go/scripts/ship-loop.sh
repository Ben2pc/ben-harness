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

# Defensive: without jq, later stages would `set -e` partway through and
# leave the state file stranded. Prefer a clean shutdown over a dead loop.
if ! command -v jq >/dev/null 2>&1; then
  echo "auriga-go ship: jq not on PATH. Removing state file to avoid a dead loop." >&2
  echo "  Install jq and re-invoke /auriga-go ship to restart." >&2
  rm "$STATE_FILE"
  exit 0
fi

HOOK_INPUT=$(cat)

# Parse YAML frontmatter — first `---` to second `---`, exclusive. awk is
# precise (stops at the second `---`) where sed's `/^---$/,/^---$/` is a
# greedy range that re-triggers if the body contains another `---`, which
# would silently pull body lines into the "frontmatter" and fail later
# regex checks as if the state file were corrupt.
FRONTMATTER=$(awk 'NR==1 && /^---$/{f=1; next} f && /^---$/{exit} f' "$STATE_FILE")

# sed strips leading AND trailing whitespace so tabs / accidental trailing
# spaces don't get into the numeric-regex check below.
ITERATION=$(echo "$FRONTMATTER" | grep '^iteration:' | sed -E 's/^iteration:[[:space:]]*//; s/[[:space:]]+$//' || true)
MAX_ITERATIONS=$(echo "$FRONTMATTER" | grep '^max_iterations:' | sed -E 's/^max_iterations:[[:space:]]*//; s/[[:space:]]+$//' || true)
STATE_SESSION=$(echo "$FRONTMATTER" | grep '^session_id:' | sed -E 's/^session_id:[[:space:]]*//; s/[[:space:]]+$//' || true)

# Session isolation — state file is project-scoped but session-specific.
# If another session is running against the same file, don't interfere.
HOOK_SESSION=$(echo "$HOOK_INPUT" | jq -r '.session_id // ""')
if [[ -n "$STATE_SESSION" ]] && [[ "$STATE_SESSION" != "$HOOK_SESSION" ]]; then
  exit 0
fi

# Validate required numeric fields. max_iterations must be a positive int
# (zero would silently kill at iter 1). iteration=0 is accepted on purpose
# — harmless, since the atomic increment bumps to 1 before any re-feed.
if [[ ! "$ITERATION" =~ ^[0-9]+$ ]] || [[ ! "$MAX_ITERATIONS" =~ ^[0-9]+$ ]] || [[ "$MAX_ITERATIONS" -eq 0 ]]; then
  echo "auriga-go ship: state file corrupted ($STATE_FILE)" >&2
  echo "  iteration='$ITERATION' max_iterations='$MAX_ITERATIONS' (max_iterations must be a positive integer)" >&2
  echo "  Removing state file. Re-invoke /auriga-go ship to restart." >&2
  rm "$STATE_FILE"
  exit 0
fi

# Read transcript to scan the final assistant text block for the marker.
TRANSCRIPT_PATH=$(echo "$HOOK_INPUT" | jq -r '.transcript_path // ""')
if [[ -z "$TRANSCRIPT_PATH" ]] || [[ ! -f "$TRANSCRIPT_PATH" ]]; then
  echo "auriga-go ship: transcript not found or unspecified ('$TRANSCRIPT_PATH'). Exiting loop." >&2
  rm "$STATE_FILE"
  exit 0
fi

# Pre-filter to assistant lines that contain at least one text block, then
# take the last 100. Counting by message rather than JSONL line matters
# because each content block is its own line — a long fix-loop full of
# tool_use blocks would otherwise push the earlier text (and any marker)
# past the tail window.
#
# Real Claude Code transcripts use `.type == "assistant"` at the top level
# (not `.role`); `.message.role` is nested inside. Using `.type` is correct.
#
# Why the perl pre-pass: Claude Code has been observed to write raw ANSI /
# control bytes (U+0000-U+001F, notably ESC 0x1B) into transcript text
# blocks. `jq -c` treats a bare control byte inside a JSON string as a
# hard parse error and **aborts at that row, dropping every subsequent
# row** — which would otherwise strand the marker behind a stray-ESC
# row and silently force the hook into the normal re-feed path. Stripping
# the offending bytes before parsing keeps jq's behavior intact for
# well-formed rows while restoring marker detection past the bad row.
# `\t` (0x09), `\n` (0x0A), and `\r` (0x0D) are preserved because they're
# valid inside JSON-decoded strings and we don't want to mangle line
# framing for the downstream `tail -n 100`.
set +e
LAST_LINES=$(perl -pe 's/[\x00-\x08\x0B\x0C\x0E-\x1F]//g' "$TRANSCRIPT_PATH" | jq -c '
  select(.type == "assistant") |
  select(any(.message.content[]?; .type == "text"))
' 2>/dev/null | tail -n 100)
set -e

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

# Extract prompt body — everything after the second `---`. Once we've
# counted two separators, every subsequent line is body content, including
# any `---` markdown horizontal rule the user puts in the prompt.
PROMPT_TEXT=$(awk '/^---$/ && i<2 {i++; next} i>=2' "$STATE_FILE")
if [[ -z "$PROMPT_TEXT" ]]; then
  echo "auriga-go ship: no prompt body in state file. Exiting loop." >&2
  rm "$STATE_FILE"
  exit 0
fi

# Atomically bump the iteration count. awk rewrites the whole file —
# frontmatter-scoped, so body lines starting with `iteration:` don't get
# accidentally rewritten (which an unscoped sed would do). mktemp gives
# an unguessable temp name; trap cleans it up if we die before mv.
NEXT_ITERATION=$((ITERATION + 1))
TMP=$(mktemp "${STATE_FILE}.XXXXXX")
trap 'rm -f "$TMP"' EXIT
awk -v new_iter="$NEXT_ITERATION" '
  NR==1 && /^---$/ {f=1; print; next}
  f && /^---$/ {f=0; print; next}
  f && /^iteration:/ {print "iteration: " new_iter; next}
  {print}
' "$STATE_FILE" > "$TMP"
mv "$TMP" "$STATE_FILE"
trap - EXIT

# 3. At cap, no marker → grace turn: re-feed a terminal ceremony prompt
#    that points at the ship-Blocked PR comment template. iter is now
#    max+1, so the next Stop (without marker) hits case 2.
if [[ $ITERATION -eq $MAX_ITERATIONS ]]; then
  GRACE_PROMPT="auriga-go ship: iteration budget exhausted ($ITERATION/$MAX_ITERATIONS reached). One grace turn remains to close out cleanly.

On this turn only:
1. Post a PR comment titled \"🚫 ship mode: Blocked at iter $ITERATION/$MAX_ITERATIONS\" using the canonical template in the auriga-go skill's references/ship.md (§ \"ship-Blocked PR comment (required before emitting Blocked)\") — all five sections.
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
