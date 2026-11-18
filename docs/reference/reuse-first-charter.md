# Reuse-First Charter (summary, attributed)

> Source: MediaServo `docs/governance/reuse-first-charter.md` (their C60
> convention, driven by their PIT-246/238 scars). This is a MECHANISM-LEVEL
> summary in our vocabulary (ruling RA-1818-2); the donor's own scar history
> is theirs.

## Principle

Before building anything with an existing-thing-shaped shadow, produce
evidence that nothing usable exists. Building without that evidence is how a
monorepo grows four versions of the same wheel.

## The consumer projection (what a builder actually does)

1. Inventory the faces (skills/rules/scripts/reference/package scripts) with
   named search commands.
2. Read each candidate's usage note — exists-but-unusable-with-reason counts
   as evidence.
3. Run the candidate's verification command — paper-only candidates are not
   reuse.
4. If nothing fits: one waiver sentence in the plan/commit (what was
   searched, why nothing fits). No waiver, no build.

## Escalation ladder

First offense → review note. Recurrence (≥2) → the gap becomes a proposal
card input via `skill:repo-audit` (maybe the RIGHT fix is making the
existing thing discoverable, not a new thing).

## Boundary

This charter does not block genuinely novel mechanisms — the evolution
protocol's `innovate` tag already forces naming the new judgment path before
any build.
