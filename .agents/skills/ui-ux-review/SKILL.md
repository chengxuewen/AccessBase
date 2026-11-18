---
name: ui-ux-review
description: "Structured interface-quality review for the admin-ui surface: three states (empty/error/loading), contrast, focus order, token consistency, anti-template audit. Use when evaluating a UI surface, reviewing a frontend change for usability/accessibility, or checking empty/error/loading states, contrast, focus order, and design-token consistency. Produces an evidence-backed verdict."
---

# ui-ux-review — a repeatable interface-quality bar

> Ported from MediaServo's ui-ux-review (RT-C G3-adjacent ruling, 59-line
> donor blueprint, mechanism-level rewrite). The aesthetic constraints live in
> `skill:design-system` (token mechanics); this skill is the checklist that
> turns "looks off" into evidence-backed findings.

## Trigger Conditions

- Reviewing a UI surface or a frontend diff for quality (not just correctness).
- Asked "is this UI good / accessible / consistent?"
- Before signing off a visual change (the `web-frontend` role hands off here).

## Method (run in order, capture evidence as you go)

0. **Self-serve capture.** Drive the browser yourself (Playwright is in the
   toolchain, `e2e/`) — do not wait for someone to paste screenshots.
1. **Three states.** Inspect the surface in **empty**, **error**, and
   **loading** states — not just the happy path. A surface that only works
   when full of data is not done. Screenshot each reachable state.
2. **Contrast.** Check text/background contrast for primary, secondary, and
   muted text (design-system tokens on their surfaces). Flag any pair below
   the readable threshold; muted-on-white is the usual offender.
3. **Focus order & keyboard.** Tab through interactive elements: order
   matches the visual layout, focus is visible, nothing is keyboard-trapped.
   Note the focus ring.
4. **Token consistency.** Verify styles consume design-system tokens
   (`skill:design-system`); flag raw hex / magic spacing / off-palette values.
5. **Anti-template audit.** Audit the AI-look tells and grade severity
   (heavy / light / none — "none" earns at most 2-3 small suggestions, not a
   redesign); then hierarchy, layering, intentional spacing — not a generic
   uniform card grid. State the reason, not just "looks template-y".
6. **Template test.** Swap in another product's name and content: if the
   surface still works unchanged, the direction is not pushed enough — flag
   it and name the elements that stayed generic.
7. **Verdict.** Reflect (re-open every cited location; all CRITICAL/HIGH,
   sample the rest), then emit a verdict (pass / needs-work) plus a findings
   table: `check | evidence (screenshot / file:line) | rule or token
   violated | severity`. Precision over recall: three verified findings beat
   ten with seven speculative ones — deliberately accepting misses is
   authorised.

## Evidence discipline

- Every finding cites a screenshot or a `file:line`; no evidence → mark it
  "speculation", not a finding (evidence-critic standard, PIT-097 kin).
- Read-only: do not edit the UI under review. Implementation belongs to the
  `web-frontend` role; this review only reports.

## Boundaries

- Functional correctness / tests → `test-harness` and e2e, not here.
- Token mechanics (adding/renaming tokens) → `skill:design-system`.
- This skill reviews; it does not self-approve its own implementation.
