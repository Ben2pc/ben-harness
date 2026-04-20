#!/usr/bin/env bash
# Unit tests for plugins/auriga-go/scripts/ship-loop.sh.
#
# Runs each scenario in an isolated tempdir with hand-crafted fixtures
# (state file, transcript JSONL, hook-input JSON), then asserts the
# hook's exit code, stdout, and state-file aftermath.
#
# Usage: bash tests/ship-loop.test.sh

set -uo pipefail

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
HOOK="$HERE/../plugins/auriga-go/scripts/ship-loop.sh"
SESSION_ID="test-session-abc"

if [[ ! -x "$HOOK" ]]; then
  echo "FATAL: $HOOK not found or not executable" >&2
  exit 1
fi

PASS=0
FAIL=0
CURRENT=""

# ---- helpers ----------------------------------------------------------

start() {
  CURRENT=$1
  TMP=$(mktemp -d)
  cd "$TMP" || { echo "FATAL: cannot cd into $TMP" >&2; exit 1; }
  mkdir .claude
}

finish_ok() {
  echo "  ✓ $CURRENT"
  PASS=$((PASS + 1))
  cd /
  rm -rf "$TMP"
}

finish_fail() {
  echo "  ✗ $CURRENT — $1" >&2
  echo "    tmp: $TMP (preserved for inspection)" >&2
  FAIL=$((FAIL + 1))
  cd /
}

# Build a minimal JSONL transcript with one assistant message containing $1 as the text.
# Optional second arg = path (default ./transcript.jsonl).
# Schema matches real Claude Code transcripts: top-level .type == "assistant",
# with .message.role == "assistant" nested inside.
make_transcript() {
  local text=$1
  local path=${2:-./transcript.jsonl}
  jq -n --arg t "$text" '{
    type: "assistant",
    message: { role: "assistant", content: [ { type: "text", text: $t } ] }
  }' -c > "$path"
  echo "$path"
}

make_state() {
  local iter=$1 max=$2 session=${3:-$SESSION_ID}
  cat > .claude/auriga-go-ship.local.md <<EOF
---
active: true
iteration: $iter
max_iterations: $max
session_id: $session
started_at: 2026-04-19T00:00:00Z
---

Continue ship mode. This prompt body is what the hook re-feeds.
EOF
}

make_hook_input() {
  local transcript=$1 session=${2:-$SESSION_ID}
  jq -n --arg s "$session" --arg t "$transcript" '{
    session_id: $s,
    transcript_path: $t
  }'
}

run_hook() {
  "$HOOK" 2>stderr.log
}

# ---- scenarios -------------------------------------------------------

echo "ship-loop.sh unit tests"

# ---- 1. no state file → no-op (the blast-radius guardrail for auto/step) ----
start "no state file → no-op"
stdout=$(echo '{"session_id":"any"}' | run_hook)
rc=$?
if [[ $rc -ne 0 ]]; then
  finish_fail "expected exit 0, got $rc"
elif [[ -n "$stdout" ]]; then
  finish_fail "expected empty stdout, got: $stdout"
elif [[ -s stderr.log ]]; then
  finish_fail "expected empty stderr, got: $(cat stderr.log)"
else
  finish_ok
fi

# ---- 2. session_id mismatch → no-op ----
start "session mismatch → no-op, state preserved"
make_state 3 30 "other-session"
make_transcript "nothing here" > /dev/null
stdout=$(make_hook_input ./transcript.jsonl | run_hook)
rc=$?
if [[ $rc -ne 0 ]]; then
  finish_fail "expected exit 0, got $rc"
elif [[ ! -f .claude/auriga-go-ship.local.md ]]; then
  finish_fail "state file was removed but shouldn't have been"
elif [[ -n "$stdout" ]]; then
  finish_fail "expected empty stdout, got: $stdout"
else
  finish_ok
fi

# ---- 3. iteration field corrupt → cleanup + exit ----
start "corrupt iteration → state removed"
cat > .claude/auriga-go-ship.local.md <<'EOF'
---
iteration: not-a-number
max_iterations: 30
session_id: test-session-abc
---

body
EOF
make_transcript "x" > /dev/null
stdout=$(make_hook_input ./transcript.jsonl | run_hook)
rc=$?
if [[ $rc -ne 0 ]]; then
  finish_fail "expected exit 0, got $rc"
elif [[ -f .claude/auriga-go-ship.local.md ]]; then
  finish_fail "state file should have been removed"
elif [[ -n "$stdout" ]]; then
  finish_fail "expected empty stdout, got: $stdout"
else
  finish_ok
fi

# ---- 4. max_iterations field corrupt → cleanup + exit ----
start "corrupt max_iterations → state removed"
cat > .claude/auriga-go-ship.local.md <<'EOF'
---
iteration: 1
max_iterations: foo
session_id: test-session-abc
---

body
EOF
make_transcript "x" > /dev/null
stdout=$(make_hook_input ./transcript.jsonl | run_hook)
rc=$?
if [[ $rc -ne 0 ]]; then
  finish_fail "expected exit 0, got $rc"
elif [[ -f .claude/auriga-go-ship.local.md ]]; then
  finish_fail "state file should have been removed"
else
  finish_ok
fi

# ---- 5 + 5b: paired. Together they cover the at-cap → over-cap progression.
#   5  — iter == max, no marker → hook injects grace-turn ceremony prompt,
#         bumps iter to max+1, leaves state file.
#   5b — iter >  max (because grace turn elapsed without a marker) → hook
#         force-exits and removes state file.
# ---- 5. iter == max, no marker → grace-turn ceremony prompt, state preserved ----
start "iter == max → grace turn injected, iter bumped to max+1"
make_state 30 30
make_transcript "just working, no marker yet" > /dev/null
stdout=$(make_hook_input ./transcript.jsonl | run_hook)
rc=$?
if [[ $rc -ne 0 ]]; then
  finish_fail "expected exit 0, got $rc (stderr: $(cat stderr.log))"
elif [[ ! -f .claude/auriga-go-ship.local.md ]]; then
  finish_fail "state file should still exist (grace turn reuses it)"
elif ! echo "$stdout" | jq -e '.decision == "block"' > /dev/null 2>&1; then
  finish_fail "stdout missing decision:block — got: $stdout"
elif ! echo "$stdout" | jq -e '.reason | contains("iteration budget exhausted")' > /dev/null 2>&1; then
  finish_fail "stdout reason not the grace-turn prompt — got: $(echo "$stdout" | jq -r .reason)"
elif ! echo "$stdout" | jq -e '.reason | contains("Emit <ship-done>Blocked</ship-done>")' > /dev/null 2>&1; then
  finish_fail "grace-turn prompt missing Blocked-marker instruction"
else
  new_iter=$(grep '^iteration:' .claude/auriga-go-ship.local.md | sed 's/iteration: *//')
  if [[ "$new_iter" != "31" ]]; then
    finish_fail "expected iteration=31 after grace-turn bump, got $new_iter"
  else
    finish_ok
  fi
fi

# ---- 5b. iter > max, no marker → forced Blocked exit (grace turn already spent) ----
start "iter > max → forced exit, state removed"
make_state 31 30
make_transcript "still no marker after grace turn" > /dev/null
stdout=$(make_hook_input ./transcript.jsonl | run_hook)
rc=$?
if [[ $rc -ne 0 ]]; then
  finish_fail "expected exit 0, got $rc"
elif [[ -f .claude/auriga-go-ship.local.md ]]; then
  finish_fail "state file should have been removed"
elif [[ -n "$stdout" ]]; then
  finish_fail "expected empty stdout, got: $stdout"
else
  finish_ok
fi

# ---- 6. transcript path missing → cleanup + exit ----
start "transcript missing → state removed"
make_state 1 30
stdout=$(make_hook_input ./no-such-file.jsonl | run_hook)
rc=$?
if [[ $rc -ne 0 ]]; then
  finish_fail "expected exit 0, got $rc"
elif [[ -f .claude/auriga-go-ship.local.md ]]; then
  finish_fail "state file should have been removed"
else
  finish_ok
fi

# ---- 7. <ship-done>Ready</ship-done> detected → exit + state removed ----
start "Ready marker → state removed, allow exit"
make_state 5 30
make_transcript "some output then <ship-done>Ready</ship-done> goodbye" > /dev/null
stdout=$(make_hook_input ./transcript.jsonl | run_hook)
rc=$?
if [[ $rc -ne 0 ]]; then
  finish_fail "expected exit 0, got $rc"
elif [[ -f .claude/auriga-go-ship.local.md ]]; then
  finish_fail "state file should have been removed"
elif [[ -n "$stdout" ]]; then
  finish_fail "expected empty stdout, got: $stdout"
else
  finish_ok
fi

# ---- 8. <ship-done>Blocked</ship-done> detected → exit + state removed ----
start "Blocked marker → state removed, allow exit"
make_state 7 30
make_transcript "comment posted. <ship-done>Blocked</ship-done>" > /dev/null
stdout=$(make_hook_input ./transcript.jsonl | run_hook)
rc=$?
if [[ $rc -ne 0 ]]; then
  finish_fail "expected exit 0, got $rc"
elif [[ -f .claude/auriga-go-ship.local.md ]]; then
  finish_fail "state file should have been removed"
else
  finish_ok
fi

# ---- 9. no marker, budget remaining → block + re-feed, iter incremented ----
start "no marker, under budget → block+re-feed, iter+1"
make_state 3 30
make_transcript "just a status line, no marker yet" > /dev/null
stdout=$(make_hook_input ./transcript.jsonl | run_hook)
rc=$?
if [[ $rc -ne 0 ]]; then
  finish_fail "expected exit 0, got $rc (stderr: $(cat stderr.log))"
elif [[ ! -f .claude/auriga-go-ship.local.md ]]; then
  finish_fail "state file should still exist"
elif ! echo "$stdout" | jq -e '.decision == "block"' > /dev/null 2>&1; then
  finish_fail "stdout missing decision:block — got: $stdout"
elif ! echo "$stdout" | jq -e '.reason | contains("This prompt body")' > /dev/null 2>&1; then
  finish_fail "stdout reason missing expected prompt text — got: $(echo "$stdout" | jq -r .reason)"
else
  new_iter=$(grep '^iteration:' .claude/auriga-go-ship.local.md | sed 's/iteration: *//')
  if [[ "$new_iter" != "4" ]]; then
    finish_fail "expected iteration=4, got iteration=$new_iter"
  else
    finish_ok
  fi
fi

# ---- 10. no prompt body → cleanup + exit ----
start "empty prompt body → state removed"
cat > .claude/auriga-go-ship.local.md <<'EOF'
---
iteration: 1
max_iterations: 30
session_id: test-session-abc
---
EOF
make_transcript "no marker" > /dev/null
stdout=$(make_hook_input ./transcript.jsonl | run_hook)
rc=$?
if [[ $rc -ne 0 ]]; then
  finish_fail "expected exit 0, got $rc"
elif [[ -f .claude/auriga-go-ship.local.md ]]; then
  finish_fail "state file should have been removed"
else
  finish_ok
fi

# ---- 11. marker across multiple content blocks (transcript has earlier text + marker later) ----
start "marker in multi-line text block"
make_state 2 30
# Transcript contains two assistant lines; marker is in the LAST.
jq -n '{
  type: "assistant",
  message: { role: "assistant", content: [ { type: "text", text: "early assistant text without marker" } ] }
}' -c > ./transcript.jsonl
jq -n '{
  type: "assistant",
  message: { role: "assistant", content: [ { type: "text", text: "final block.\n<ship-done>Ready</ship-done>" } ] }
}' -c >> ./transcript.jsonl
stdout=$(make_hook_input ./transcript.jsonl | run_hook)
rc=$?
if [[ $rc -ne 0 ]]; then
  finish_fail "expected exit 0, got $rc"
elif [[ -f .claude/auriga-go-ship.local.md ]]; then
  finish_fail "state file should have been removed (marker in final block)"
else
  finish_ok
fi

# ---- 12. session_id empty in state → process normally (substitution fell through) ----
start "empty state session_id → no session gate, re-feed normally"
cat > .claude/auriga-go-ship.local.md <<'EOF'
---
active: true
iteration: 2
max_iterations: 30
session_id:
started_at: 2026-04-19T00:00:00Z
---

Continue ship mode. This prompt body is what the hook re-feeds.
EOF
make_transcript "working" > /dev/null
stdout=$(make_hook_input ./transcript.jsonl "any-session-id" | run_hook)
rc=$?
if [[ $rc -ne 0 ]]; then
  finish_fail "expected exit 0, got $rc (stderr: $(cat stderr.log))"
elif [[ ! -f .claude/auriga-go-ship.local.md ]]; then
  finish_fail "state file should still exist"
elif ! echo "$stdout" | jq -e '.decision == "block"' > /dev/null 2>&1; then
  finish_fail "expected decision:block re-feed — got: $stdout"
else
  new_iter=$(grep '^iteration:' .claude/auriga-go-ship.local.md | sed 's/iteration: *//')
  if [[ "$new_iter" != "3" ]]; then
    finish_fail "expected iteration=3, got $new_iter"
  else
    finish_ok
  fi
fi

# ---- 13. max_iterations=0 → treated as corruption ----
start "max_iterations=0 → corrupt, state removed"
make_state 1 0
make_transcript "x" > /dev/null
stdout=$(make_hook_input ./transcript.jsonl | run_hook)
rc=$?
if [[ $rc -ne 0 ]]; then
  finish_fail "expected exit 0, got $rc"
elif [[ -f .claude/auriga-go-ship.local.md ]]; then
  finish_fail "state file should have been removed"
elif ! grep -q "corrupted" stderr.log; then
  finish_fail "expected corruption warning on stderr, got: $(cat stderr.log)"
else
  finish_ok
fi

# ---- 14. duplicate markers (Ready + Blocked) in same block → first match wins ----
start "Ready + Blocked in one block → Ready wins, exit"
make_state 5 30
make_transcript "done: <ship-done>Ready</ship-done> actually wait <ship-done>Blocked</ship-done>" > /dev/null
stdout=$(make_hook_input ./transcript.jsonl | run_hook)
rc=$?
if [[ $rc -ne 0 ]]; then
  finish_fail "expected exit 0, got $rc"
elif [[ -f .claude/auriga-go-ship.local.md ]]; then
  finish_fail "state file should have been removed"
elif ! grep -q 'detected <ship-done>Ready</ship-done>' stderr.log; then
  finish_fail "expected Ready to win (first match), got stderr: $(cat stderr.log)"
else
  finish_ok
fi

# ---- 15. tool-use-only final turn (no text block in last message) → re-feed normally ----
start "tool-use-only final turn → no marker, re-feed"
make_state 4 30
# Earlier assistant turn with plain text (no marker), then a tool_use-only turn.
jq -n '{
  type: "assistant",
  message: { role: "assistant", content: [ { type: "text", text: "thinking about next step" } ] }
}' -c > ./transcript.jsonl
jq -n '{
  type: "assistant",
  message: { role: "assistant", content: [ { type: "tool_use", id: "toolu_1", name: "Bash", input: {command: "ls"} } ] }
}' -c >> ./transcript.jsonl
stdout=$(make_hook_input ./transcript.jsonl | run_hook)
rc=$?
if [[ $rc -ne 0 ]]; then
  finish_fail "expected exit 0, got $rc (stderr: $(cat stderr.log))"
elif [[ ! -f .claude/auriga-go-ship.local.md ]]; then
  finish_fail "state file should still exist"
elif ! echo "$stdout" | jq -e '.decision == "block"' > /dev/null 2>&1; then
  finish_fail "expected decision:block re-feed — got: $stdout"
else
  new_iter=$(grep '^iteration:' .claude/auriga-go-ship.local.md | sed 's/iteration: *//')
  if [[ "$new_iter" != "5" ]]; then
    finish_fail "expected iteration=5, got $new_iter"
  else
    finish_ok
  fi
fi

# ---- 16. body with `---` markdown horizontal rule → body preserved across re-feed ----
start "body with ---HR → re-fed body keeps both paragraphs"
cat > .claude/auriga-go-ship.local.md <<'EOF'
---
active: true
iteration: 3
max_iterations: 30
session_id: test-session-abc
started_at: 2026-04-19T00:00:00Z
---

First paragraph before the rule.

---

Second paragraph after the rule.
EOF
make_transcript "no marker" > /dev/null
stdout=$(make_hook_input ./transcript.jsonl | run_hook)
rc=$?
if [[ $rc -ne 0 ]]; then
  finish_fail "expected exit 0, got $rc (stderr: $(cat stderr.log))"
elif [[ ! -f .claude/auriga-go-ship.local.md ]]; then
  finish_fail "state file should still exist (unsafe frontmatter parse would have deleted it as corrupt)"
elif ! echo "$stdout" | jq -e '.reason | contains("First paragraph") and contains("Second paragraph")' > /dev/null 2>&1; then
  finish_fail "re-fed body should include both paragraphs — got: $(echo "$stdout" | jq -r .reason)"
else
  new_iter=$(grep '^iteration:' .claude/auriga-go-ship.local.md | sed 's/iteration: *//')
  if [[ "$new_iter" != "4" ]]; then
    finish_fail "expected iteration=4, got $new_iter"
  else
    finish_ok
  fi
fi

# ---- 17. long transcript: marker in text message, >100 tool_use-only blocks after ----
start "long transcript >100 tool_use blocks → pre-filter keeps marker"
make_state 5 30
# First: a text message containing the Ready marker.
jq -n '{
  type: "assistant",
  message: { role: "assistant", content: [ { type: "text", text: "all done <ship-done>Ready</ship-done>" } ] }
}' -c > ./transcript.jsonl
# Then: 150 tool_use-only assistant messages. Under a naive line-based
# tail -n 100 these would push the text line off the window and the
# hook would miss the marker.
i=0
while [[ $i -lt 150 ]]; do
  jq -n --argjson i "$i" '{
    type: "assistant",
    message: { role: "assistant", content: [ { type: "tool_use", id: ("toolu_" + ($i | tostring)), name: "Bash", input: {command: "ls"} } ] }
  }' -c >> ./transcript.jsonl
  i=$((i + 1))
done
stdout=$(make_hook_input ./transcript.jsonl | run_hook)
rc=$?
if [[ $rc -ne 0 ]]; then
  finish_fail "expected exit 0, got $rc (stderr: $(cat stderr.log))"
elif [[ -f .claude/auriga-go-ship.local.md ]]; then
  finish_fail "Ready marker should have triggered exit (state removed) — got stderr: $(cat stderr.log)"
elif ! grep -q 'detected <ship-done>Ready</ship-done>' stderr.log; then
  finish_fail "expected Ready detection, got stderr: $(cat stderr.log)"
else
  finish_ok
fi

# ---- 18. hook input missing transcript_path field → graceful exit ----
start "missing transcript_path → state removed, clean exit"
make_state 2 30
# Hook input has only session_id, no transcript_path.
stdout=$(echo '{"session_id":"test-session-abc"}' | run_hook)
rc=$?
if [[ $rc -ne 0 ]]; then
  finish_fail "expected exit 0, got $rc (stderr: $(cat stderr.log))"
elif [[ -f .claude/auriga-go-ship.local.md ]]; then
  finish_fail "state file should have been removed"
elif ! grep -q "transcript not found or unspecified" stderr.log; then
  finish_fail "expected graceful missing-path message, got: $(cat stderr.log)"
else
  finish_ok
fi

# ---- 19. transcript_path is a dead symlink → treated as missing file ----
start "dead-symlink transcript → state removed"
make_state 2 30
ln -s ./no-such-target.jsonl ./deadlink.jsonl
stdout=$(make_hook_input ./deadlink.jsonl | run_hook)
rc=$?
if [[ $rc -ne 0 ]]; then
  finish_fail "expected exit 0, got $rc"
elif [[ -f .claude/auriga-go-ship.local.md ]]; then
  finish_fail "state file should have been removed"
else
  finish_ok
fi

# ---- 20. real-schema regression: fixture mirrors actual Claude Code transcript ----
# Insurance against regressing to .role-based filters. The fixture at
# tests/fixtures/real-transcript-marker.jsonl uses .type == "assistant" at
# the top level (not .role), which is the only correct selector in real
# Claude Code JSONL transcripts.
start "real-schema fixture: .type==assistant marker detection"
make_state 3 30
FIXTURE_PATH="$HERE/fixtures/real-transcript-marker.jsonl"
stdout=$(make_hook_input "$FIXTURE_PATH" | run_hook)
rc=$?
if [[ $rc -ne 0 ]]; then
  finish_fail "expected exit 0, got $rc (stderr: $(cat stderr.log))"
elif [[ -f .claude/auriga-go-ship.local.md ]]; then
  finish_fail "state file should have been removed — Ready marker not detected. stderr: $(cat stderr.log)"
elif ! grep -q 'detected <ship-done>Ready</ship-done>' stderr.log; then
  finish_fail "expected Ready detection in stderr, got: $(cat stderr.log)"
else
  finish_ok
fi

# ---- summary ----

echo ""
echo "─────────────────────────"
echo " $PASS passed, $FAIL failed"
echo "─────────────────────────"

[[ $FAIL -eq 0 ]]
