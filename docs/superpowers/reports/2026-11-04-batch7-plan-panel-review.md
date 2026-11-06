# Panel Review — Batch 7 (Qoder adaptation) rulings and revision pass on the governance plan

> **Provenance:** tracked copy per ADJ-7e (2026-11-04). Artifact reviewed: the tracked plan at
> `docs/superpowers/plans/2026-11-04-agent-governance-port.md` (reviewed while it still lived
> under gitignored `.omo/plans/`).

**Date:** 2026-11-04 (evening; after the post-adjudication revision pass)
**Artifact under review:** `.omo/plans/2026-11-04-agent-governance-port.md` — the new Batch 7
section, the three `AMENDED` notes folded into Batches 2/3/4, the 11-ruling
"Qoder-adaptation adjudications" section, and the four added porting-conduct rules.
**Panel gate (per expert-panel-review):** plan / cross-batch ruling review → Standard, 3 roles
(2 fixed core + 1 mounted `doc-audit` lens).
**Track actually used: SEQUENTIAL.** The user asked for team/parallel mode; it is unavailable on
this host and that was measured, not assumed: the `Agent` tool exposes only
`subagent_type: Browser | CodeReview`, and `~/.qoder-cn/cache/experts/<this session>/metadata.json`
is an "Agent Team / v1 / Single-leader agent session" whose `agents/` and `inboxes/` are both
empty. This is the second on-record data point for the deferred **P0-b** sub-agent probe
(blocks ADJ-7k option C and the memory-bridging item).
**Isolation:** each pass re-read the artifact and re-collected evidence with fresh commands; no
pass was fed a previous pass's conclusions.

## Per-role findings

### Pass 1 — correctness officer (assume the rulings are WRONG; falsify)

- **C-1 [CRITICAL]:** ADJ-7d's new `rule-ref-lint` scan (forbid host-private paths in
  rules/skills) has a blast radius the plan never sized. Measured on the current tree
  (excluding `zh/`, excluding `.refinfo/`): **22 files match** — 16 under `.agents/rules/`
  (`common/{hooks,agents,performance,git-workflow}.md`, `rules/README.md`, and **eleven**
  per-language `hooks.md` under typescript/swift/rust/python/php/perl/kotlin/java/golang/dart/
  csharp) and 6 under `.agents/skills/` (book-to-skill `SKILL.md` ×12 occurrences + its
  README/CHANGELOG/docs). ADJ-7d's deliverable list names only five files to fix. Landing the
  gate as written turns `agents check` red on 22 files the same commit. Worse: in
  `book-to-skill` those host path tables ARE the skill's function (it is a cross-host installer:
  `~/.copilot/skills`, `~/.claude/skills`, `.github/skills`, `-a qoder` absent from its roster) —
  rewriting them destroys the skill and forks it from upstream. The ruling needs a policy for
  "host names that appear as the artifact's subject matter" vs "host names asserted as fact".
- **C-2 [CRITICAL]:** ADJ-7c's acceptance #7 requires the moved graphify text to be
  "byte-identical to the upstream wording", but the body contains **20 intra-step references**
  (`Step 0/2.5/3/4/4.5`, and `the --update runbook (#1361)` — an upstream issue number). Once the
  11 `### Step` blocks are split across `references/` files, those pointers cross file
  boundaries and MUST be rewritten. The two acceptance criteria cannot both hold. Either the
  invariance claim narrows to "no semantic rewrite of instructions" (links may be adjusted), or
  the split must stay inside one file.
- **C-3 [MEDIUM]:** ADJ-7j makes `.qoder/rules/**` a TRACKED generated face, but the plan never
  states the invariant that makes that safe: the Qoder mapper must be **machine-independent** (no
  `$HOME`, no absolute paths, no per-host enabled-set inference). `AGENTS.md`-style faces satisfy
  it today; `rules-links` has never been run through that requirement. Without it, every other
  clone/CI run is red on a face that is now checked instead of skipped.
- **C-4 [MEDIUM]:** ADJ-7i's `hostMemoryProbe()` copies `hooksProbe`'s shape but not the part
  that makes that shape useful — `hooksProbe` prints an executable fix (`bash bootstrap.sh` /
  the one-line git config). The memory probe has no repair action defined, so the yellow flag
  lands as an unpromptable complaint. Needs a named action (move the entry into
  `.agents/memorys/<file>` per the ADJ-7i split table, then delete the host file).
- **Explicitly not covered by this pass:** rulings' strategic merits (they are the user's, and
  this pass attacks mechanism, not preference); runtime behaviour of the not-yet-written Qoder
  mapper; the 30,000-char skill limit beyond its one log sample (handed to pass 2).

### Pass 2 — evidence officer (unproven claims in the revised plan)

- **E-1 [HIGH]:** "Facts established … #1 — Qoder loads skills from `.agents/skills/`" is stated
  as fact but rests on **elimination + a byte-size match in a load log** (`codebuddy` occurs 0×
  in the client binary; `.qoder/skills` and `~/.qoder-cn/skills` do not exist; the truncated
  graphify size matches the file on disk). Official docs name only `.qoder/skills/`. The plan
  itself now carries a conduct rule requiring an evidence class on every relied-upon host
  behaviour — this entry violates the rule added in the same revision pass. Downgrade the wording
  to "measured on this machine via elimination; undocumented path, watch-item".
- **E-2 [HIGH]:** The Global-constraints addition asserts "type stripping is on by default in
  22.18+" and instructs CI to resolve `node-version: '22'` to ≥22.18. Only one point was actually
  measured: the generators run on system node **22.23.2**. The 22.18 boundary is recalled, not
  tested, and it is exactly the class of unverified external-interface detail this repo files as
  PIT-076. Either measure it or cite Node's changelog, otherwise drop the specific number and
  keep the safe instruction ("pin a Node version that is known to run the generators; verify in
  the job itself").
- **E-3 [MEDIUM]:** Two fix lists are short by real occurrences: ADJ-7k lists one `question()`
  site in `doc-audit` while it appears at **both :296 and :353**; ADJ-7d's deliverable omits the
  eleven per-language `hooks.md` files that the scan will hit (see C-1).
- **E-4 [MEDIUM]:** "D122 mirror topology ⇒ GitHub Actions `pull_request` triggers are
  effectively dead" is inference from `git remote -v` showing Gitee only. Whether the Gitee-side
  mirror forwards PRs, and whether it ever fails or lags, was not observed. The plan uses this to
  discount ADJ-7f's value; the claim needs an observation or an explicit "assumed, unverified".
- **E-5 [MEDIUM → conflict item]:** ADJ-7b's headline premise is "Qoder truncates past 100,000
  chars across active rules". The official sentence is verbatim ✓, but "active" is undefined:
  if it counts only what is injected at a given moment, 79 rules may not exceed it, and the
  hard-constraint justification for an asymmetric face collapses into a noise argument. The plan
  does register this as P0-a(iii) — but the ruling table still states it as a hard premise.
- **E-6 [LOW, checked-clean]:** every file:line citation introduced by the revision pass was
  re-opened and matched: `skills-index.mts:33` and `:121`, `rules-links.mts:82` and `:2-4`,
  `agent-targets.json:10`/`:26`, `agent-links.mts:57` (+`hooksProbe`, ADJ-3b at `:56`),
  `gate-mcp.mts:32/:92`, `tool-routing.md:26-28`, `lesson-memory.md` trigger table,
  `expert-panel-review:24-38`, `doc-audit:296`, `edit-safety.md:49`.
- **Explicitly not covered:** whether the counts (22 files / 20 refs / 12 occurrences) stay valid
  after the deferred edits — they were measured against the working tree at review time, and the
  tree is being modified by a parallel session (see D-2).

### Pass 3 — doc-audit lens (numbering, cross-refs, dependency graph)

- **D-1 [MEDIUM]:** Batch 2's AMENDED note ends "Rationale recorded as its own D-entry
  **(ruling 7b)**" at line 212, but that note is about **ADJ-7j** (tracked `.qoder/rules`); 7b is
  the projection-scope ruling that separately needs its own entry. Mis-attribution will produce
  two D-entries cited for the wrong decision.
- **D-2 [HIGH]:** Batch 7 needs ≥3 new D-entries (7b scope narrowing, 7j tracked/generated
  refinement, 7c upstream-fork note) plus possibly 7d's conduct rule, and `decisions.md` ends at
  **D126** — but no number allocation is recorded, while `pitfalls.md` was written again at
  17:57 during this session (now **PIT-090**, was 089 an hour ago; `decisions.md` untouched at
  21:02). Parallel authoring plus `memory-aggregate`'s `duplicateNumbers` = **hard red** is a
  live collision path. Reserve the block explicitly (e.g. D127-D130 claimed for Batch 7).
- **D-3 [MEDIUM]:** the Acceptance list has 7 demos but omits two new gates introduced by the
  rulings: ADJ-7a's strengthened point-7 / inoperative revival, and ADJ-7h's heuristic
  no-measurable-counts lint. Per CONSTRAINTS.md, a check claimed as enforced without a negative
  demonstration counts as not done — the same defect that made Batch 3's CI line false (the
  AMENDED banner documents it; do not recreate it).
- **D-4 [LOW]:** the header says results live in "the two 'Adjudication results' sections", but
  only one section carries that exact title; the second is "Qoder-adaptation adjudications
  **(Batch 7 candidates)**", and "candidates" is now stale since Batch 7 has a real definition.
- **D-5 [LOW]:** the dependency graph line for Batch 7 lists 7e<7f, 7d<7b, 7a‖7c, 7j needs
  7b+7f, while the body's internal order is `7e → 7f → (7a ‖ 7c → 7d) → (7b+7g+7j) → (7h,7i,7k)`.
  Not contradictory, but the graph silently drops 7g/7h/7i/7k — a reader trusting the graph will
  under-order the batch.
- **D-6 [LOW]:** ADJ-7d bundles two different defects under one action: host-private PATH strings
  (`~/.claude/agents`) and host-specific CAPABILITY naming (`web/hooks.md`'s PostToolUse
  recommendation — which does not match the path scan at all). One is lintable; the other is a
  wording review. Recording them as one deliverable will make the gate's coverage look broader
  than it is.
- **Explicitly not covered:** anything about the plan's earlier batches beyond the three AMENDED
  notes; `.omo/reports/` history consistency; the actual code of the generators (pass 1/2 scope).

## Merge (single pass, lead)

| #   | Grade    | Finding                                                                                                                 | Origin                             | Status                                                                                |
| --- | -------- | ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------- |
| C-1 | CRITICAL | 7d's new lint hits 22 files; fix list covers 5; book-to-skill's host tables are its function                            | pass 1 + pass 2 (E-3 corroborates) | OPEN — needs a subject-matter-vs-assertion policy + exemption list before 7d can land |
| C-2 | CRITICAL | 7c acceptance #7 (byte-identical) contradicts 20 intra-step cross-references                                            | pass 1                             | OPEN — narrow the invariance claim or keep the split in one file                      |
| D-2 | HIGH     | No D-number reservation; parallel session already moved PIT 089→090; `duplicateNumbers` is hard red                     | pass 3                             | OPEN — reserve D127-D130 for Batch 7                                                  |
| E-1 | HIGH     | "Qoder loads `.agents/skills`" asserted as fact on elimination evidence; breaks the conduct rule added in the same pass | pass 2                             | OPEN — re-label evidence class (grading disputed → X-3)                               |
| E-2 | HIGH     | Node "≥22.18" boundary is recalled, not measured; written into Global constraints as a CI premise                       | pass 2                             | OPEN — measure or de-specialize                                                       |
| C-3 | MEDIUM   | No machine-independence invariant for the now-tracked `.qoder/rules` face                                               | pass 1                             | OPEN — add to 7j deliverables                                                         |
| C-4 | MEDIUM   | `hostMemoryProbe` lacks the executable-fix that makes hooksProbe's shape work                                           | pass 1                             | OPEN                                                                                  |
| E-3 | MEDIUM   | Fix lists short: `question()` ×2 sites; eleven per-language hooks.md                                                    | pass 2                             | OPEN (overlaps C-1)                                                                   |
| E-4 | MEDIUM   | Gitee-mirror PR-invalidation is inference, not observation                                                              | pass 2                             | OPEN — mark assumed or observe                                                        |
| E-5 | MEDIUM   | "active" in the 100,000-char budget undefined, yet 7b states it as hard premise                                         | pass 2                             | OPEN — see X-2                                                                        |
| D-1 | MEDIUM   | Batch 2 AMENDED cites "(ruling 7b)" where the note is about 7j                                                          | pass 3                             | FIXABLE NOW (one-line)                                                                |
| D-3 | MEDIUM   | Acceptance list missing 2 demos (7a revival, 7h heuristic lint)                                                         | pass 3                             | OPEN — add demos #8/#9                                                                |
| D-4 | LOW      | Header says "two 'Adjudication results' sections"; second title differs and says "candidates"                           | pass 3                             | FIXABLE NOW                                                                           |
| D-5 | LOW      | Dependency graph drops 7g/7h/7i/7k present in the body order                                                            | pass 3                             | FIXABLE NOW                                                                           |
| D-6 | LOW      | 7d mixes lintable path strings with non-lintable capability naming                                                      | pass 3                             | OPEN — split the deliverable                                                          |
| E-6 | —        | All 11 file:line citations in the revision pass verified correct                                                        | pass 2                             | CLEAN                                                                                 |

Dedup note: C-1 and E-3 are the same defect seen from two briefs (mechanism vs completeness);
merged as one item with both origins, not counted twice.

## Conflict items (preserved, not smoothed)

- **X-1 — scope of the `question()` ban.**
  - Correctness stance: `adjudication-walkthrough` forbids `question` because of a **tool** defect
    (JSON escaping mangles option formatting, three incidents). A defect of the tool applies
    wherever the tool is used, so ADJ-7k's extension to `doc-audit`'s finding presentation is
    sound.
  - Evidence stance: the ban's text is self-limiting ("FORBIDDEN **for this protocol**"), and
    `doc-audit`'s `question()` usage has **no recorded failure**. Extending a narrow, incident-
    backed prohibition to a different workflow without its own incident is an unproven
    generalization.
  - Consequence either way is small (plain text works in both), but the reasoning differs and the
    plan should record which justification is used.
- **X-2 — strength of ADJ-7b's premise.**
  - Stance A (as ruled): 158,112 chars > the documented 100,000 limit ⇒ full projection fails
    mathematically, so an asymmetric face is forced.
  - Stance B (adversarial): the limit counts "all **active** rule files"; if "active" means what a
    host injects at a given moment (always-on + matched globs + model-chosen bodies), 79 rules may
    never be simultaneously active and the hard constraint dissolves — leaving only a noise
    argument, which would have favoured symmetric projection.
  - This is decision-relevant, not stylistic: if P0-a(iii) resolves toward B, ruling 7b should be
    re-opened. Keep both readings in the plan until measured.
- **X-3 — severity of E-1.**
  - Evidence officer: HIGH — it is the load-bearing premise of ADJ-7g/7i/7j (a face we do not
    generate, a probe we cannot enforce, a limit we cannot see), asserted as fact.
  - Correctness reading (as it would have filed it): LOW — a labelling issue in a corrections
    list; the underlying behaviour was reproduced, only its classification is overconfident.
  - Unresolved deliberately: the two roles disagree about whether "reproducible on this machine"
    is enough to write "fact" in a document that also just adopted a rule demanding an evidence
    class.

## Run record

- Artifact: governance plan, revision pass of 2026-11-04 evening (Batch 7 + 3 AMENDED notes +
  4 conduct rules).
- Roles: correctness officer, evidence officer, `doc-audit` lens (mounted for plan
  self-consistency). Sequential track; three separate passes, fresh evidence per pass.
- Verdict: **not clean.** 2 CRITICAL, 3 HIGH, 7 MEDIUM, 3 LOW. Three items are one-line text fixes
  (D-1, D-4, D-5); the rest change Batch 7's deliverables or acceptance list and therefore need
  rulings, not edits.
- Handoff: findings and the three conflicts go to `adjudication-walkthrough`, one at a time,
  CRITICAL first.
- Not claimed by this review: that the rulings themselves are wrong. Every finding attacks
  mechanism, coverage, or evidence — none re-opens a user decision except X-2, which is explicitly
  conditional on a measurement the plan already scheduled.
