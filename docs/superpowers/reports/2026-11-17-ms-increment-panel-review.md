# Panel Review — MS-Increment Adoption Plan (2026-11-17)

**Panel:** parallel track, 3 read-only members, true isolation (each in its own
context), per the `expert-panel-review` discipline: correctness officer /
evidence officer / doc-audit lens. Lead merged in a single pass; disagreements
preserved as conflict items (no majority smoothing).

**Target:** the 11 adjudications (10×A + 1×B) and batch structure recorded in
`.omo/plans/2026-11-17-ms-increment-adoption.md` (v1).

**Headline verdict:** all 11 rulings stand — no mechanism was overturned; the
factual bases of #2/#5/#11 were verified on the ground. The PLAN DOCUMENT,
however, is not fit for execution: no acceptance criteria, scale-literal drift,
panel reports untracked. Rulings right, document rough — the live-fire pattern
recurs.

## Findings (merged, deduped, graded)

### CRITICAL

- **C-1** #10 "not always-on" conflicts with the instructions-links full-layer
  injection (`scripts/agents/instructions-links.mts:10-13`): a rule file under
  `.agents/rules/common/` is auto-injected into the opencode always-on face; the
  only exclusion mechanism is directory-level (zh/ precedent). Same family:
  `.agents/rules/common/constraints.md:23` still cites the STALE `.omo/plans/`
  path AND claims the pre-commit hook is "PLANNED / not yet installed" — both
  false today. RESOLVED by post-panel adjudication: option C (accept
  always-on, self-limiting scope text, +1.2% of the 291KB face); the stale
  constraints.md line is folded into G2 as a mandatory fix.
- **C-2** Numbering/literal drift chain (the ADJ-7a/7h disease recurring in the
  ruling document itself): "layer 10" is actually layer 11 (header-lint holds
  #10, close-out W3); the plan's own corrections section says "9 layers" (10 in
  truth); root CONSTRAINTS.md says "8 layers" (stale twice); "13 scripts" has
  no clean counting basis (operational scripts actually 20; the orphan
  hypothesis was NOT supported by a 7/20 spot check — zero orphans in sample).
- **C-3** The three panel reports (from the 2026-11-17 MS-increment analysis)
  were never persisted — P2 backlog unauditable, silently-dropped candidates
  cannot be excluded. Ironic: the deferred backlog itself lists "dismissal
  log". THIS FILE closes that gap for the adoption panel; the analysis-panel
  distillation is reconstructed in the v1 plan's Corrections + this report's
  sources.
- **C-4** None of the three batches carried acceptance criteria — G1 is all
  gate work with not one red/green demonstration requirement, violating our
  own verification discipline (ADJ-7f precedent).

### HIGH

- **H-1** #11-a (three-question audit) is a hard precondition of #11-c
  (census/fail-log): the mount point is the CI aggregate (MS parity:
  `all-gates.sh:21-33,124-132`), NOT the agent-links dispatcher (which
  orchestrates only 1 of the 4 ci gates). RESOLVED by adjudication B: G1
  proceeds WITHOUT #11-c; census lands as a follow-up mini-batch after the
  audit report.
- **H-2** check-leaks first run = 21 live hits (measured), three distinct
  decision classes, not a "sweep": (i) 18 `.superpowers/sdd/**` process
  reports — tracked-then-ignored history debt; (ii) `.omo/omo.jsonc` — a
  .gitignore rule-ORDER bug (the `!.omo/omo.jsonc` un-ignore at L68 is
  overridden by the later `.omo` at L75); (iii) `apps/server/src/fastify.d.ts`
  + `packages/identity/src/fastify.d.ts` — product source declarations hit by
  over-broad `*.d.ts` rules (.gitignore:109/113). Disposition list required
  before the gate can land without blocking all commits (pre-commit runs
  agents check).
- **H-3** #9 "no content copies — clean backfill window" is FALSIFIED by four
  finds: (a) CONSTRAINTS.md Never#1/#5/#6 near-verbatim from MS CONSTRAINTS;
  (b) `scripts/sync-official-refs.sh` = same template instantiated twice (69
  vs 82 lines, parallel comments) AND carries a bare `PIT-14` citation
  violating our ADJ-1b prefix rule; (c) expert-panel-review is content-level
  from RCH D22 (properly attributed — the attribution was done right);
  (d) MS is Apache-2.0 WITH a NOTICE file (4(d) attribution duty on derivative
  distribution). Actual license risk rated LOW (same-author private repos,
  slogan/template-level overlap, no distribution signs) — but the ledger's
  first batch will contain non-clean entries. Ruling #9's wording amended to
  "mechanism-level predominant, N known slogan/template overlaps, ledger them
  all". The bare PIT-14 fix is folded into G3's backfill.
- **H-4** #6 acceptance ritual had NO operational checklist (recitation set,
  sample pointer-chains, pass line, double-failure window all undefined) — the
  very "claims-passed-without-output" family that ruling #3 just outlawed.
  Checklist now in plan v2.
- **H-5** No execution-log mount point declared; plan home undecided (ADJ-7e
  precedent: plans live tracked under `docs/superpowers/plans/`, working
  copies migrate on the first execution commit).

### MEDIUM (folded into plan v2)

- TRIGGERS row grammar must anticipate `rule:` rows (skill rows + rule rows)
  or G3's team-execution registration turns the G1 gate red on landing day.
- #8-B dangling parts: quota loses its time anchor (MS anchors were "per
  quarter") — re-anchor as per-batch; recheck criterion needs a carrier
  (doc-audit cycle or event).
- "skill-lint check 10" slot collision: the 11-04 plan reserved #10 for
  ADJ-7c's skill_budget (apparently not landed as designed — graphify SKILL.md
  still 39KB). Plan v2 says "append one check"; G1 must also rule on the 7c
  residue.
- "C-1" collision: the conventions C-series to be created by ruling #3 vs the
  existing panel-finding numbering — v2 specifies provenance formatting.
- #2 corpus expansion risk: MS's ghost-cite scans docs/scripts/www repo-wide;
  ours scans 4 targets. Aligning corpora ⇒ docs/ dangling count unmeasured;
  first run must measure before hard-failing.
- The two open-items ledgers (11-04 plan vs this plan) don't cross-reference;
  deferred backlog now bridges.
- D107/D108 VOID semantics: ours is "never assigned", not MS's "assigned then
  withdrawn" — registry wording must preserve the original meaning; AGENTS.md
  NOTES sentence updates alongside (or the #6 pointer-chain traces into a
  contradiction).

## Conflict item (preserved)

**G1 timing:** the correctness officer argued both sides — "no G1 sanction
until #11-a reports" (census shape depends on it) vs "G1 minus #11-c can
proceed" (four components have zero dependency on the audit). RESOLVED by
user adjudication (B): G1-minus-census proceeds; census is a post-audit
mini-batch.

## Post-panel adjudications (2026-11-17, user-ruled one by one)

1. C-1 resolution: **C** — accept always-on with in-text self-limitation;
   revisit a per-file exclusion mechanism only if on-demand rules accumulate
   (≥5 or so).
2. Sequencing: **B** — G2 → G1' (∥ audit) → census mini-batch → G3.
3. Full revision authorized: **A** — this report persisted, plan rewritten to
   v2 with acceptance criteria, corrections, and the 21-hit disposition list.

## Not covered (explicit)

- The 2026-11-17 analysis panel's three reports were received as teammate
  messages only; this file records their DISTILLED findings (via the adoption
  plan and this panel's cross-checks), not their full text.
- MS-side truth of MS:C46 / PIT-226 was not independently re-verified by this
  panel (the correctness officer located 7 of the mechanisms' source
  implementations; three citations remain unlocated — flagged in that
  officer's report).
- `pixi run ci` "never executed" is a negative claim; all available evidence
  is consistent with it but shell history is not exhaustable.
