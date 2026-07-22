#!/usr/bin/env bash
#
# build.sh - Linux/macOS equivalent of build.cmd
#
# Compiles source/*.ts into stage/, then runs postbuild.js to combine and
# minify the four release bundles (rip/norip x xfer/noxfer).
#
# Any arguments are passed through to tsc, so `./build.sh --clean` and
# `./build.sh --force` work the same way they do in build.cmd.

set -euo pipefail
cd "$(dirname "$0")"

if [ ! -d node_modules ]; then
    echo "==> Installing build dependencies"
    npm install
fi

echo "==> Compiling TypeScript"
node node_modules/typescript/bin/tsc --build source "$@"

echo "==> Combining and minifying release bundles"
node postbuild.js

echo "==> Done"
ls -la release/ftelnet.*.min.js
