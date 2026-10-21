#!/bin/bash
# Builds TRACON.app (menu bar app + widgets) and ad-hoc signs it. Usage: ./build.sh [--install]
set -e
cd "$(dirname "$0")"

ARCHS="--arch arm64 --arch x86_64"
swift build -c release $ARCHS
OUT=$(swift build -c release $ARCHS --show-bin-path)

BUNDLE="TRACON.app"
rm -rf "$BUNDLE"
mkdir -p "$BUNDLE/Contents/MacOS" "$BUNDLE/Contents/Resources"
cp "$OUT/TraconBar" "$BUNDLE/Contents/MacOS/TraconBar"
cp Info.plist "$BUNDLE/Contents/Info.plist"

APPEX="$BUNDLE/Contents/PlugIns/TraconWidget.appex"
mkdir -p "$APPEX/Contents/MacOS"
cp "$OUT/TraconWidget" "$APPEX/Contents/MacOS/TraconWidget"
cp WidgetInfo.plist "$APPEX/Contents/Info.plist"

# Sign the widget first with its sandbox entitlements; --deep would strip them.
codesign --force -s - --entitlements Widget.entitlements "$APPEX"
codesign --force -s - "$BUNDLE"
echo "Built $BUNDLE"

if [ "$1" == "--install" ]; then
  DEST=/Applications; [ -w "$DEST" ] || { DEST=~/Applications; mkdir -p "$DEST"; }
  rm -rf "$DEST/$BUNDLE" && cp -R "$BUNDLE" "$DEST/" && echo "Installed to $DEST/$BUNDLE"
fi
