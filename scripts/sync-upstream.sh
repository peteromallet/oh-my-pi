#!/usr/bin/env bash
# Sync the arnold fork with upstream oh-my-pi, then rebuild the branded binary.
# Usage: scripts/sync-upstream.sh [--test-only]
set -euo pipefail
cd "$(dirname "$0")/.."

echo "── fetching upstream + origin"
git fetch origin main
git fetch upstream main 2>/dev/null || { echo "no 'upstream' remote; add: git remote add upstream https://github.com/can1357/oh-my-pi.git"; exit 1; }

BEHIND=$(git rev-list --count HEAD..upstream/main)
echo "── upstream is $BEHIND commits ahead"
[ "$BEHIND" = "0" ] && { echo "already up to date."; exit 0; }

echo "── merging upstream/main"
if ! git merge --no-edit upstream/main; then
  echo ""
  echo "CONFLICTS — resolve, then: git add -A && git commit"
  git diff --name-only --diff-filter=U
  exit 1
fi

echo "── typecheck + onboarding tests"
cd packages/coding-agent
bun run check:types || exit 1
bun test test/onboard-scan.test.ts test/onboard-scene-items.test.ts test/onboard-models-yml.test.ts

echo "── rebuilding natives (only if rust sources changed) && binary"
cd ../..
if git diff --name-only HEAD@{1} HEAD 2>/dev/null | grep -q "^packages/natives/"; then
  bun --cwd=packages/natives run build
  mkdir -p ~/.omp/natives/17.4.0
  cp packages/natives/native/pi_natives.darwin-arm64.node ~/.omp/natives/17.4.0/
fi
cd packages/coding-agent && bun scripts/build-binary.ts

echo "── done. smoke: dist/omp --version && arnold --onboard"
