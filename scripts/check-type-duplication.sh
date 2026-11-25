#!/usr/bin/env bash
# check-type-duplication — D137 guard (2026-11-25).
#
# Why: two @types/node copies once entered ONE program simultaneously (via
# `/// <reference types="node" />` in dependency .d.ts — @types/pg pulled
# 20.19.43, @alicloud/tea-typescript pulled 12.20.55) and the repo ran TWO
# TypeScript compilers (root 5.6.3 vs every package 5.9.3). The same source
# then got two verdicts, and @types/node@20's `typesVersions <=5.6` branch
# changed Buffer's shape per compiler → intermittent red that looked like a
# source bug. Fix = pnpm.overrides {'@types/node@12': '20.19.43'} + TS
# unified at 5.9.3; memory: .agents/memorys/decisions.md D137.
#
# The census measures the PROGRAM (tsc --listFiles), never the store — orphan
# .pnpm variant dirs survive installs and would make a store-level count lie.
#
# Exit 0 = exactly one @types/node per program AND one compiler version.
# Reverse demo (CONSTRAINTS.md 33-42): drop the override → census prints 2 → red.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

fail=0
census() {
  local label="$1" dir="$2"
  local copies
  copies=$( (cd "$dir" && pnpm exec tsc --noEmit --listFiles 2>/dev/null || true) \
    | grep '/node_modules/@types/node/' \
    | sed -E 's#.*/([^/]+)/node_modules/@types/node/.*#\1#' \
    | sort -u )
  local n
  n=$(printf '%s\n' "$copies" | grep -c . || true)
  echo "  ${label}: ${n} @types/node program cop$( [ "$n" = 1 ] && echo y || echo ies )"
  printf '%s\n' "$copies" | sed 's/^/    - /'
  [ "$n" = 1 ] || { echo "  ✗ ${label}: expected exactly 1 @types/node in the program (D137)"; fail=1; }
}

echo "type-duplication census (D137):"
census "packages/identity" "packages/identity"
census "root" "."

# One compiler everywhere (root + every package lane).
vers=$(pnpm -r exec tsc --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | sort -u)
root_ver=$(pnpm exec tsc --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+')
echo "  compilers: ${root_ver} (root) / $(printf '%s' "$vers" | tr '\n' ' ')"
if [ "$root_ver" != "$vers" ] || [ -n "$(printf '%s\n' "$vers" | sed -n '2p')" ]; then
  echo "  ✗ compilers diverge (root ${root_ver} vs packages ${vers}) — unify at one TS version (D137)"
  fail=1
fi

if [ "$fail" = 0 ]; then
  echo "type-duplication: clean (one @types/node per program, one compiler)"
fi
exit "$fail"
