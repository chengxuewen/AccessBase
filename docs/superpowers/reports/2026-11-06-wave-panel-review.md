# Panel review — waves W2.x/W3/W4-b1/E14 (commits 2932471..bbe8e5e), 2026-11-06

Target: the five committed deliverables since the first real run. Sequential track,
3 roles (correctness / evidence / doc-audit lens), isolation kept.

## Role 1 · Correctness officer

- **C-1 HIGH — the E14 markdown reflow silently drifted line-number anchors the ledger
  cites.** Measured: `branding.md:100` (T17's `AccessBaseProvider` citation) now shows the
  R11 Design-intent block; `integration.md:229` (deploy manifest `package:` line) now shows
  `react:` — content moved ± few lines. The wave reformatted docs/modules,
  `.agents/memorys/*` (status.md alone: 76 lines reflowed), `.agents/rules`, and
  `.agents/skills/*/SKILL.md`. Every `file:line` citation in the plan predating the wave is
  now suspect — exactly the "looks authoritative, no longer true" class §0 exists to kill,
  and this one we manufactured ourselves at 400-file scale. Confidence high (2 probes hit,
  mechanism general).
- Wave hygiene verified sound: the two machine-owned families (sync tracked faces, drizzle
  meta) stayed unformatted (residual check 428→2, both = concurrent session's live files);
  blame-revs correctly a separate commit (self-reference impossible otherwise); X-2=C
  batch-one outcome recorded honestly incl. the triage anchor error.
- Not covered: CI-side behaviors (Gates-transient hypothesis stays a named hypothesis —
  correctly labeled, next run tests it).

## Role 2 · Evidence officer

- **E-1 MEDIUM — "PASS on node 22/26" in the W3 commit message overstates.** Measured:
  pixi node = v26.6.0, system node = v22.23.2; the self-test was run through a resolver
  that picked ONE of them per invocation — the dual-version claim is an unverified
  inheritance from the 11-04 precedent, not this wave's measurement. (The 11-04 memory
  does evidence the PRECEDENT tool on both versions — header-lint's own dual-version pass
  was never separately demonstrated.)
- E-2 MEDIUM — the E14 row says "agents check green post-wave"; green-at-the-time is true,
  but check does not currently catch C-1's drift class (no anchor-verification exists);
  the sentence reads as if coverage were broader than it is — tighten or annotate.
- Sound: E13 CLOSED on run #32 API SUCCESS (hard evidence); E15 correctly NOT attributed;
  format:check 2-residual verified twice; tsc green post-wave verified.

## Role 3 · doc-audit lens

- **A-1 HIGH — same root as C-1, different face:** the plan's own §0 says anchors must be
  reproducible commands; after the wave, the reproducible command and the stored anchor
  disagree for an unknown subset of rows (T17/T8 cites, conventions:245, status.md:120…).
  No inventory exists of which citations moved.
- A-2 LOW — triage table's "Proposed first batch" section retains future-tense phrasing
  below its executed-outcome table; harmless but the two sections should be visibly
  version-stamped.
- A-3 noted-and-fine: ledger ladder step 2 ticked; the "no open ruling except push" claim
  matches §5.

## Merge

CRITICAL 0 · HIGH 2 (C-1/A-1 = one issue, two faces: anchor drift from our own reflow) ·
MEDIUM 2 (E-1 dual-version overstatement, E-2 coverage-sentence breadth) · LOW 1.

Conflict preserved:
- **X-3** handling of drifted anchors: (a) blanket annotation "line numbers pre-2026-11-06
  may drift; quoted text is the anchor" in §0 + spot-fix known-cited rows; (b) re-verify
  and rewrite EVERY file:line in the ledger now (hours of grep); (c) defer — re-anchor only
  when a row is next touched. Lead rec: (a) + fix the handful of rows this wave itself
  cited, since (b) manufactures exactly the date-painting churn C-2 banned.
- **X-4** E-1 disposition: annotate the W3 claim honestly in the ledger vs re-run the
  self-test under BOTH resolvers now (2 minutes, converts inheritance into measurement).
  Lead rec: re-run both, then annotate with the observed pair.

Disposition: C-1/A-1/E-1/E-2 are the lead's own wave-time errors (not user decisions) →
folded immediately per precedent (anchor-drift caveat in §0; T17 text-anchor note; E14
coverage sentence tightened). **X-4 RESOLVED during the review itself**: dual-resolver
self-test re-run measured PASS on 26.6.0 AND 22.23.2 — claim now earned, not inherited.
**X-3 remains the single open ruling** (scope of active re-anchoring after the reflow).

### Ruling outcome (2026-11-06, same evening)
X-3 = **C** — no active re-anchoring; repair line citations at use time, the §0 caveat is
the standing protection. The user declined the lead's recommendation of A (spot-fix
still-cited rows) as churn; consistent, since the caveat already makes text the authority
and the annotated T17/E14 lines carry their drift labels from the fold-in.

---

# Panel round 3 (2026-11-06) - re-review of the revision pass (cut 24: S2 rulings table,
wave-table S2 row, deferred strikes, close-out §5/§6)

Same three roles, sequential, target = the diff of cut 24 and the new sections. All findings
confirmed against live text before writing (grep-verified, no memory-claims).

## Correctness officer
- **R3-C1 HIGH** - the wave-table S2 row kept "the outstanding panel findings from 2026-11-04"
in its FIRST half while its second half announced ADJ-7c UNBLOCKED - the revision updated half
a cell and left the row contradicting itself.
- **R3-C2 MEDIUM** - bare-token collision across generations: the close-out plan's own X-1=A /
X-2=C (strict wiring; batch granularity) vs the 11-04 panel's X-1/X-2/X-3 (question-ban;
active-premise; severity), both cited unqualified in two documents that cross-reference.

## Evidence officer
- **R3-E1 MEDIUM** - scope drift unrecorded: close-out §4 said "No S2 rulings"; §5/§6 narrate
S2 rulings done. Both true in their time, but no artifact recorded WHO widened scope WHEN -
"looks consistent until you date it", the §0 class. Snapshot doctrine forbids editing §4;
the amendment note belongs in §6.

## doc-audit lens
- Cross-checks PASSED: eight cited hashes in §6 re-verified against git log (the earlier
memory-written pair already corrected); S2 rulings row count matches the 11-04 conflict
section (4=4); deferred strike preserves original wording under strikethrough; E16/E17/E18
each carry 2-type evidence fields.

## Merge & disposition
HIGH 1 (R3-C1) · MEDIUM 2 (R3-C2, R3-E1). All three are drafting errors of the revision pass
itself, not decisions: folded immediately - S2 row first half rewritten to "all conflict items
ruled... see §8"; disambiguation + scope-amendment note appended to close-out §6 (§4 untouched
per snapshot doctrine). No conflict items raised; nothing from this round needs a ruling.
