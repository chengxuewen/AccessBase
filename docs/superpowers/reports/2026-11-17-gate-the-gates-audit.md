# Gate-the-Gates Audit — first execution of the concurrent `pixi run ci` (2026-11-17)

**Action item #11-a from the MS-increment adoption plan v2.** Three questions,
each answered with command output (C1 discipline — no pass claim without live
output).

## Q1 — Does the full chain run on a developer machine?

**Answer: YES (first-ever real run).**

```
$ pixi run ci > /tmp/pixi-ci-first-run.log 2>&1; echo "pixi-ci-exit=$?"
pixi-ci-exit=0
...
✨ Pixi task (ci in default): echo 'ci chain: all gates green': ...
ci chain: all gates green
```

- The chain is `pixi.toml [tasks] ci depends-on = [typecheck, lint, test,
  agents-check]` (concurrent form) — all four dependencies completed, aggregate
  echo ran, exit 0. Full output retained at `/tmp/pixi-ci-first-run.log` for
  the session; this report records the command and its exit code.
- **Validation trap #1 (caught before reporting):** a naive
  `grep -cE 'error|Error|FAILED'` over the log returned 415 — but inspection
  showed every hit was the eslint warning text "Only these console methods are
  allowed: warn, error" (one per warning line). The exit code is the authority;
  `error`-shaped text in warning prose is not a failure. No real error/failure
  lines in the log.
- **Validation trap #2 (same family, from G2):** an exact-list-membership check
  (`'conventions.md' in instructions[]`) reported "C1 not injected"; the entry
  is the full path `.agents/memorys/conventions.md` (instructions[0:3] verified).
  Two verifier mistakes in one day are exactly the PIT-226/228 disease this
  audit was commissioned to hunt. Both were caught by re-checking the checker —
  file as a PIT candidate; escalate to a gate if it recurs (lesson-memory
  escalation ladder).

## Q2 — Do two consumers share an incomplete list (false parity)?

**Answer: not reproduced in this pass; one structural note.**

- `instructions-links` and `agent-links` consume different lists (paths vs
  layer registry); `constraints-index` derives CONSTRAINTS.md from the pixi ci
  depends-on, and `agent-links` does NOT parse that generated region — so the
  MS failure mode (generator + checker agreeing on the same incomplete `GATE_RE`)
  has no direct analogue today.
- Structural note (LOW): layer counts are printed by hand in text surfaces
  (root CONSTRAINTS.md had "8 layers" until G2 replaced it with a counting
  command; the adopted plan v1 said "9/10 layers" wrongly). No machine consumer
  reads those literals, so no false parity — but every literal is a future
  drift candidate. Counting commands are now the rule.

## Q3 — Coverage gaps between verify / full chain / pre-commit?

**Answer: three distinct surfaces, one accepted gap.**

| Surface | Runs | Does NOT run |
|---|---|---|
| pre-commit | agents sync + stage 4 tracked faces + agents check (layers + budget) | typecheck / lint / test |
| `bash accessbase.sh ci` (serial) | typecheck → lint → test → agents check | — |
| `pixi run ci` (concurrent, audited here) | same four as concurrent dependencies | — |
| CI governance job | sync-then-diff over tracked faces, CI=1 agents check | (separate jobs do build/test/typecheck on the mirror — D122 topology) |

- Accepted gap: pre-commit deliberately omits typecheck/lint/test (ruling 8,
  light-subset design) — a stale-but-consistent state can be committed and only
  caught by `ci`. This is a KNOWN, accepted tradeoff, not a defect; report it
  so nobody mistakes pre-commit green for full-chain green (C1).

## Addendum (same day, after G1′ started) — PHANTOM GREEN FOUND (PIT-095)

**Q1's answer must be qualified: the `pixi run ci` run was real (exit 0, all
four dependencies + echo ran), but `agents check` had been PHANTOM GREEN for
~13 days.** While landing the check-leaks layer, a planted force-add file
failed to redden the chain: the dispatcher printed ONLY header-lint WARN lines
and no `[check] summary` rows at all.

Root cause: `scripts/agents/header-lint.mts` (landed by a parallel session in
close-out W3) put its CLI entry at MODULE TOP LEVEL without an
`import.meta.main` guard. Importing it from `agent-links.mts` with argv `check`
called `process.exit(0)` during import — before the remaining layers ran,
before any summary printed, before the aggregate exit code was computed.
Everything registered after header-lint was dead code.

Consequences: G2's acceptance record ("agents-check-exit=0") was a phantom
green; 5 rules-links mdc drifts + 1 memory-aggregate drift (from G2 source
edits with no real sync) had been hidden. Fix: wrapped the CLI block in
`if (import.meta.main)`; the very next run exposed the real drift (exit 1,
all 11 summaries), then `agents sync` + probe removal produced the FIRST
verified aggregate green: all 11 `[check]` rows printed, exit 0.

New canary condition (machine-grade C1): **a run whose stdout lacks the full
layer roster is not a pass — it is a short-circuited chain.** Filed as PIT-095,
including the prevention item (every layer's CLI entry must be guarded; check
for it in the layer registry).

## Disposition

- #11-a CLOSED: Q1 answered by first real run (green); Q2 no analogue found;
  Q3 gap documented and accepted.
- #11-c (census + fail-log) may now land at the CI AGGREGATE point with the
  shape informed by this report: census line over typecheck/lint/test/agents-check
  results; fail-log per gate into a gitignored directory; skips visible and
  never counted as green.
- Two PIT candidates filed in the plan's G2 execution log (verifier mistakes);
  escalate only on recurrence.
