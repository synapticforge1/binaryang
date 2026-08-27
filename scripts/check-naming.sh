#!/bin/sh
# MUST: a bare upstream project name (binaryen, wabt) may appear in a path ONLY
# where upstream compatibility is the subject (compat/, interop/). The qualified
# forms binaryen-ts / wabt-ts are permitted -- the -ts suffix is what
# distinguishes our port from the project it ports.
#
# Empty output means the rule holds.
#
# NOTE: the original one-liner (grep -v '(binaryen|wabt)-ts') was correct only
# BEFORE the merge. Once src/binaryen-ts/ and src/wabt-ts/ exist, that exclusion
# matches the DIRECTORY component and discards every file in both trees, so the
# check silently passes on everything. It must strip the permitted components
# and test what remains.
git ls-files | awk '
{
  n = split($0, c, "/")
  for (i = 1; i <= n; i++) if (tolower(c[i]) ~ /compat|interop/) next
  for (i = 1; i <= n; i++) {
    x = tolower(c[i])
    gsub(/binaryen-ts/, "", x); gsub(/wabt-ts/, "", x)
    if (x ~ /(^|[-_.])(binaryen|wabt)([-_.]|$)/) { print; next }
  }
}'
