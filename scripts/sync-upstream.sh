#!/usr/bin/env bash
# Sync upstream skills in one shot.
#
# Replaces the manual loop of:
#   npx skills add <repo> --skill <name> --agent claude-code codex --yes
#
# Invoked via: npm run sync-upstream
#
# WHY `skills add --skill <name>` loop instead of `skills update <names>`:
# Bug in vercel-labs/skills CLI. Verified against source
# (src/cli.ts:754 + src/update-source.ts:52 on main): the update command
# reads each tracked skill's `source` from skills-lock.json and internally
# executes `skills add <source> -y` WITHOUT preserving `--skill <name>`.
# So for any source repo containing multiple skills, `skills update foo`
# ends up installing every skill in foo's source repo, not just foo.
# Ben2pc/g-claude-code-plugins ships six skills (claude-code-agent,
# codex-agent, deep-review, gemini-agent, ip-diagnosis, parallel-implementation,
# test-designer); we only track five of them. Using `skills add --skill
# <name>` per tracked skill preserves the curated allowlist semantics.
set -euo pipefail

cd "$(dirname "$0")/.."

# Tracked skills sourced from Ben2pc/g-claude-code-plugins.
# Keep in sync with the entries in skills-lock.json whose source matches.
SKILLS=(
  claude-code-agent
  codex-agent
  deep-review
  parallel-implementation
  test-designer
)

echo "→ Re-syncing tracked skills..."
for skill in "${SKILLS[@]}"; do
  echo "  • $skill"
  npx -y skills add Ben2pc/g-claude-code-plugins \
    --skill "$skill" \
    --agent claude-code codex \
    --yes \
    > /dev/null
done

echo ""
echo "→ Working tree after sync:"
git status --short

if [ -z "$(git status --porcelain)" ]; then
  echo ""
  echo "✓ Already up-to-date with upstream. Nothing to commit."
  exit 0
fi

echo ""
echo "Next steps:"
echo "  1. Review:  git diff"
echo "  2. Branch:  git checkout -b chore/sync-upstream-\$(date +%Y%m%d)"
echo "  3. Commit:  git add -A && git commit -m 'chore: sync upstream skills'"
echo "  4. PR:      gh pr create --fill && gh pr merge --squash --delete-branch"
