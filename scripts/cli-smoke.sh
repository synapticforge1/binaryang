#!/bin/sh
# Exercise every dispatcher command under one runtime and print the output hash.
#
# $1 is the runtime invocation, e.g.:
#   sh scripts/cli-smoke.sh "deno run -A"
#   sh scripts/cli-smoke.sh "node --experimental-transform-types"
#   sh scripts/cli-smoke.sh "bun"
#
# Node needs --experimental-transform-types, NOT --experimental-strip-types:
# strip-only mode erases types without generating code, so it rejects TypeScript
# enums (33 here) and parameter properties. Both predecessors documented the
# strip flag, and their CLI therefore never ran on Node at all.
set -e
RT="$1"
[ -n "$RT" ] || { echo "usage: cli-smoke.sh '<runtime invocation>'" >&2; exit 2; }
D=$(mktemp -d)
trap 'rm -rf "$D"' EXIT

cat > "$D/t.wat" <<'WAT'
(module
  (func (export "add") (param i32 i32) (result i32)
    (i32.add (local.get 0) (local.get 1))))
WAT

$RT main.ts --version                                  > /dev/null
$RT main.ts wat2wasm      "$D/t.wat" -o "$D/t.wasm"    > /dev/null
$RT main.ts wasm-validate "$D/t.wasm"                  > /dev/null
$RT main.ts wasm2wat      "$D/t.wasm" -o "$D/t.rt.wat" > /dev/null
$RT main.ts wasm-objdump  "$D/t.wasm"                  > /dev/null
cp "$D/t.wasm" "$D/s.wasm"
$RT main.ts wasm-strip    "$D/s.wasm"                  > /dev/null
$RT main.ts wasm-opt      "$D/t.wasm" -o "$D/o.wasm" -Oz > /dev/null
# wasm2ts is a deliberate stub: it must exit non-zero with a one-line message.
if $RT main.ts wasm2ts "$D/t.wasm" 2>/dev/null; then
  echo "wasm2ts unexpectedly succeeded" >&2; exit 1
fi

for f in t.wasm s.wasm o.wasm; do
  [ -s "$D/$f" ] || { echo "empty output: $f" >&2; exit 1; }
done
# The hash the caller compares across runtimes.
sha256sum "$D/t.wasm" | cut -d' ' -f1
