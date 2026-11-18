---
name: mechanism-porting
description: "Execute the adoption of an EXTERNAL mechanism after a user ruling: verify the source, extract the mechanism (never the content), fit-check this repo's constitution, land minimally, and ledger the provenance. Use when a ruling says to port/adopt a mechanism from another repo or a community source — or when the user says 移植/采纳这个机制. Discovery and design are NOT done here."
---

# mechanism-porting — adjudicated adoption executor

> Third leg of the four-part loop: `think-before-act` (whether/approval) →
> `expert-panel-review` (adversarial review) → `adjudication-walkthrough`
> (rulings) → **this skill** (execute an already-ruled adoption). Ported from
> MediaServo's mechanism-porting (2026-11-17 adoption ruling #9), rewritten
> for this repo's target surfaces and ledger location.

## Three-way separation of powers

- **Discovery** belongs to `skill:ecosystem-scan` / audit lenses — NOT here.
- **Design and selection** belong to `skill:think-before-act` + a USER RULING
  via `skill:adjudication-walkthrough` — NOT here.
- **Execution after the ruling** is this skill's only job. "The community
  does it" is never a ruling. If the source conflicts with this repo's
  constitution, the user decides whether to rewrite or drop it.

## Six-step method

1. **Verify the source** — priority: a locally installed, working config >
   upstream official docs > third-party articles. A mechanism seen only in an
   article MUST be re-verified against a working implementation before landing.
   Cite the donor commit/URL and observed output.
2. **Extract the MECHANISM, not the content** — transplanting a role table,
   taxonomy wording, or prompt text verbatim is a violation (copyright AND
   fitness). Restate the *judgment path* in this repo's own vocabulary.
3. **Fit-check against this repo's constitution** — English prose policy,
   append-only memory with C/D/PIT numbering, gates-first (never hand-check
   what a gate proves), generated layers are never hand-edited, user-start
   gate, and any declared quotas/anchors. Write the fit verdict explicitly.
4. **Minimal adaptation plan** — two columns, LANDING (exact file paths) and
   GATE (which existing gate verifies it + the pre-registered criterion from
   the proposal card). No new gate without its `--self-test` pair (CONSTRAINTS.md).
5. **Land through the gates** — follow `rule:edit-safety`: read before edit,
   red/green demo for every new/changed gate, `bash accessbase.sh ci` at
   delivery, execution log appended to the ruling plan.
6. **Ledger the provenance** — one row in `docs/reference/donor-ledger.md`:
   donor / destination / mode (verbatim | adapted | mechanism-only) / ruling
   ID / license with attribution duty. If any text-level overlap exists, say
   so honestly; "mechanism-only" is not a cover for unattributed copying.

## Boundary

No ruling → no porting. No discovery here. No hand-waving on license — a CC BY
donor needs attribution, an Apache-2.0 donor with NOTICE has derivative
attribution duties. When in doubt, ledger the overlap and let the user rule.
