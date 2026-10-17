#!/usr/bin/env bash
# One command for all checks. Usage: scripts/check.sh [--fast]  (--fast = lint + guards only)
set -euo pipefail
cd "$(dirname "$0")/.."
FAST=0; [ "${1:-}" = "--fast" ] && FAST=1

node -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>23||(a===23&&b>=6)?0:1)' \
  || { echo "Node >= 23.6 required (the engine runs TypeScript via Node type stripping)" >&2; exit 1; }

NAMES=(); RESULTS=()
step() { # name cmd...
  local n=$1; shift
  echo "=== $n"
  if "$@"; then RESULTS+=(pass); else RESULTS+=(FAIL); fi
  NAMES+=("$n")
}

install() { [ -d node_modules ] || npm ci --no-audit --no-fund; }
stray() { ! find . \( -name node_modules -o -name .git -o -name dist -o -name .tmp.driveupload \) -prune -o \
  -type f \( -name '*-e' -o -name '*.orig' -o -name '*.rej' -o -name '*.bak' \) -print | grep .; }
read_only() { # the engine must never write, move, lock or delete anything in ~/.claude* or ~/.gemini; state.ts writes only ~/.config/tracon
  ! grep -n -E '\b(writeFile|appendFile|mkdir|rmSync|rm\(|unlink|rename|copyFile|ftruncate|truncateSync|chmod|chown|createWriteStream|utimes|symlink)' \
    -r --exclude=state.ts packages/avalokita-engine/src
}

step "install" install
step "typecheck-engine" npx tsc --noEmit -p packages/avalokita-engine
step "typecheck-ui" npx tsc --noEmit -p packages/tracon-ui
step "stray-files" stray
step "engine-read-only" read_only
if [ $FAST = 0 ]; then
  step "engine-tests" npm test
  step "ui-build" npm run build -w tracon-ui
fi

echo; printf '%-26s | %s\n' step result; printf -- '---------------------------+-------\n'
rc=0
for i in "${!NAMES[@]}"; do printf '%-26s | %s\n' "${NAMES[$i]}" "${RESULTS[$i]}"; [ "${RESULTS[$i]}" = FAIL ] && rc=1; done
exit $rc
