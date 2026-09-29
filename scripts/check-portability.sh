#!/bin/sh
# Runtime-portability rule (README "Runtime support"). Two checks, both must be empty.
#
#   library layer (the exported surface) : web standards only; no Deno.*, no node:*
#   CLI layer                            : node:* builtins fine; Deno.* never
#
# (`interop/` was the other node:-permitted layer until 1.7.0, when the bridge
# to upstream binaryen left `src/` for the comparison suite. Its exemption went
# with it: left in, it would let a new `src/**/interop/` import node: unseen.)
#
# node: builtins are portable across Deno, Node and Bun but NOT to the browser,
# which is why they are confined to the CLI layer. Deno.* is never permitted --
# it works on one of the four supported targets.
#
# Both greps must skip JSDoc: doc comments legitimately show consumers writing
# `import { writeFile } from "node:fs/promises"`, and a check that cries wolf
# gets disabled.
status=0

deno_hits=$(git ls-files 'src/*.ts' 'main.ts' \
  | xargs -I{} git grep -nE '\bDeno\.[a-zA-Z]' -- {} 2>/dev/null \
  | grep -vE ':[0-9]+:[[:space:]]*\*')
if [ -n "$deno_hits" ]; then
  echo "Deno globals in shipped source:"; echo "$deno_hits"; status=1
fi

node_hits=$(git ls-files 'src/*.ts' \
  | grep -vE '/(tools|cli)/' \
  | xargs -I{} git grep -nE "^[[:space:]]*(import|const|let)\b.*['\"]node:" -- {} 2>/dev/null)
if [ -n "$node_hits" ]; then
  echo "node: imports outside the CLI layer:"; echo "$node_hits"; status=1
fi
exit $status
