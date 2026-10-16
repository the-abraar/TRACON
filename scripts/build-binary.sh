#!/usr/bin/env bash
# Compile standalone macOS binaries (Flight Deck embedded). Needs bun. Usage: scripts/build-binary.sh  -> release/tracon-macos-{arm64,x64}.zip
set -euo pipefail
cd "$(dirname "$0")/.."
npm run build -w tracon-ui >/dev/null
UI=$PWD/packages/tracon-ui/dist
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

# bun embeds a file only when it is imported with { type: "file" }; map each URL path to its embedded copy
{
  n=0; map=""
  while IFS= read -r f; do
    n=$((n+1)); echo "import f$n from \"$f\" with { type: \"file\" };"; map+="\"${f#"$UI"}\": f$n, "
  done < <(find "$UI" -type f)
  echo "globalThis.TRACON_UI_FILES = { $map };"
  echo "await import(\"$PWD/packages/tracon-cli/bin/tracon.js\");"
} > "$TMP/entry.js"

rm -rf release && mkdir release
for arch in arm64 x64; do
  mkdir "$TMP/$arch"
  bun build --compile --target="bun-darwin-$arch" "$TMP/entry.js" --outfile "$TMP/$arch/tracon" >/dev/null
  (cd "$TMP/$arch" && zip -q "$OLDPWD/release/tracon-macos-$arch.zip" tracon)
done
ls -lh release
