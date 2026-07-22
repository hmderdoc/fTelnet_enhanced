#!/usr/bin/env bash
#
# deploy.sh - build the bundle and install it into the webv4_custom tree.
#
# The built bundle is committed to webv4_custom so that the web repo is
# self-contained and deployable without this repo checked out, and so that
# `git log` there records exactly which bundle went live and when.
#
# Usage:
#   ./deploy.sh              # install the minified bundle
#   ./deploy.sh --debug      # install the unminified bundle (readable stack
#                            # traces while migrating monkey patches)
#
# Environment:
#   FTELNET_VARIANT   bundle variant to install   (default: norip.noxfer)
#   WEBV4_CUSTOM      destination repo            (default: /sbbs/webv4_custom)

set -euo pipefail
cd "$(dirname "$0")"

VARIANT="${FTELNET_VARIANT:-norip.noxfer}"
DEST_REPO="${WEBV4_CUSTOM:-/sbbs/webv4_custom}"

# The destination mirrors the CDN's layout (bundle beside a fonts/ dir).
# This is load-bearing, not cosmetic: StringUtils.GetUrl() resolves the
# bitmap font PNGs relative to the fTelnetScript tag's own src, stripped to
# the last '/'. Move the bundle without moving fonts/ alongside it and every
# glyph 404s, leaving a blank terminal.
DEST_DIR="${DEST_REPO}/root/ftelnet"

if [ "${1:-}" = "--debug" ]; then
    SRC="release/ftelnet.${VARIANT}.js"
else
    SRC="release/ftelnet.${VARIANT}.min.js"
fi

# The served filename is always the .min.js name, so index.xjs does not need
# to know whether a debug or release build is currently installed.
DEST="${DEST_DIR}/ftelnet.${VARIANT}.min.js"

if [ ! -d "$DEST_REPO/root" ]; then
    echo "error: destination not found: $DEST_REPO/root" >&2
    echo "       set WEBV4_CUSTOM to the webv4_custom checkout." >&2
    exit 1
fi

./build.sh

if [ ! -f "$SRC" ]; then
    echo "error: build did not produce $SRC" >&2
    exit 1
fi

mkdir -p "$DEST_DIR/fonts" "$DEST_DIR/keyboard"
cp "$SRC" "$DEST"

# Everything below is fetched at runtime relative to the bundle's own URL,
# so it all has to sit beside it. Only refreshed when changed, so a repeat
# deploy is quiet.
cp -u release/fonts/*.png        "$DEST_DIR/fonts/"
cp -u release/ftelnet.css        "$DEST_DIR/"
cp -ur release/keyboard/.        "$DEST_DIR/keyboard/"

echo "==> Installed $SRC"
echo "    -> $DEST"
echo "    md5   $(md5sum "$DEST" | cut -d' ' -f1)"
echo "    fonts $(ls "$DEST_DIR/fonts" | wc -l) png"
echo "    plus  ftelnet.css, keyboard/"
echo
echo "Commit the bundle in $DEST_REPO to put it live."
