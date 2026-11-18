# Governed Self-Evolution — how this repo adopts external mechanisms

> Adapted from MediaServo's `development-workflow.md` evolution protocol
> (rulings 2026-11-17 #8-B), trimmed for this repo. **Evolution has the right
> to propose, never the right to execute.** The sequence is always:
> notice → proposal card → user ruling → adversarial review → gated batch →
> execution log. No batch starts without a ruling citation.

## Event triggers (open a proposal card when ANY of these fires)

| Trigger | Example from this repo |
|---|---|
| A gate turns red and the cause is a missing mechanism | PIT-095 phantom green → layer roster canary |
| The same lesson recurs ≥2 times | three verifier-predicate false alarms in one day → verify-the-verifier rule |
| A host dialect changes | a third host reads `.mcp.json` differently (per-field probing, never per-host) |
| A donor publishes a new mechanism | this very MS-increment analysis (2026-11-17) |
| An audit finding recurs | same structural drift twice → event override |

## Proposal card (≤5 open at a time; each card is a finding, not a plan)

Required fields, all of them:

1. 2-3 options with paired pros/cons and ONE recommendation (no "it depends").
2. Source evidence: donor URL/commit + what exactly was observed (command output or file:line).
3. Strategy tag: `harden` (default) / `repair-only` / `innovate` — `innovate`
   must name the NEW judgment path it adds, or it is rejected as fashion.
4. **Pre-registered recheck criteria**: may only cite an EXISTING gate or
   audit line as the pass criterion. Inventing a new metric to grade your own
   adoption is a violation (self-authored exam).
5. The exact ruling ID that will authorize it (assigned at ruling time).

**Ruling-reference enforcement**: a landing batch must cite the ruling ID
in its plan document and its first commit. A batch that cannot name its ruling
is treated as gate bypass and rejected at start. "Continue" / silence is never
a ruling (think-before-act Phase 2).

## Recheck carrier

Rechecks happen in the `doc-audit` cycle or at the triggering event itself —
there is NO quarterly cadence in this repo (ruling #8-B trimmed it). The
carrier is named on the card; a card without a carrier is incomplete.

## Quota anchor

No numeric asset quota is in force (15 skills is small; a hard quarterly cap
would obstruct). If a quota table is ever introduced, anchors are PER BATCH
(or a declared rolling window) — never "per quarter" inherited from a donor.
Replacement never consumes quota: retire one + add one = net zero.

## Scope note

Discovery lives in `ecosystem-scan` / `repo-audit` style audits; design lives
in `think-before-act` + user ruling; execution after a ruling lives in
`mechanism-porting`. This rule defines the LOOP, not those roles.
