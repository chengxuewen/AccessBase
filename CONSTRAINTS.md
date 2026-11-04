# Constraints — what "done" means here

Single source of truth for the local quality gate. Two parts:

1. **Anti-gaming rules** (hand-written below) — behaviours that are never allowed
   to make a gate green.
2. **The CI gate list** — GENERATED from the task chain; empty placeholder until
   the chain lands (plan 2026-11-04, Batch 3). Never hand-edit the marker region.

Coding red-lines (`as any` bans, tsc double-green, E2E duty) live in
`AGENTS.md` ANTI-PATTERNS — deliberately NOT duplicated here (ADJ-1a ruling B:
governance file collects only machine-enforceable game rules).

## Never (hand-written)

1. Never commit with `--no-verify` — it bypasses git hooks, and hooks are the
   only thing that keeps generated layers from being committed stale (once the
   Batch 2/3 machinery lands).
2. Never add a suppression comment (`// eslint-disable …`, an empty `catch {}`,
   a skipped test) without a same-line reason naming the invariant it protects.
3. Never let tests silently shrink — deletions, skips, or weakened assertions
   must be justified in the commit message, naming the replacement coverage.
4. Never commit plaintext secrets — credentials go through environment
   variables or gitignored local files.
5. Never hand-edit generated layers or marker regions — `.codebuddy/**`, the
   AGENTS.md skills-directory / agents-memory regions, this file's ci-gates
   region (generation is live since 2026-11-04; repair path is always
   `bash accessbase.sh agents sync`, never a manual edit).
6. Fix the cause, not the gate — a red gate is right until proven otherwise.

## Verification discipline

- Every new or modified gate must be demonstrated once: deliberate violation →
  RED, restored → GREEN; commands and results recorded in the commit message.
- A check reported as "enforced" without a negative demonstration counts as
  not done.
- `--self-test` fixtures (where present) are synthetic and never touch real
  data.
- The aggregate gate: `bash accessbase.sh ci` (or `pixi run ci`) — typecheck +
  lint + test + `agents check`. The pre-commit hook runs the light subset
  (sync + stage + check); `agents check` alone (8 layers) covers governance
  surfaces between commits.

<!-- BEGIN:ci-gates -->
Generated from `pixi.toml` -> `[tasks] ci depends-on` — edit pixi.toml, not this
region. `pixi run ci` requires ALL of these green (pixi runs them concurrently):

1. `typecheck`
2. `lint`
3. `test`
4. `agents-check`
<!-- END:ci-gates -->
