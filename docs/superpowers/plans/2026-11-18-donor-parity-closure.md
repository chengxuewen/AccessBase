# Donor-Parity Closure Plan v2 (panel-revised) — ending report-driven omission

> **Scale figures are point-in-time (2026-11-18) with counting commands**
> (ADJ-7h): donor skills `ls -d .refinfo/MediaServo/.agents/skills/*/ | wc -l`
> (= 37; donor status ledger concurs "Skills 37 true source"); donor roles
> `ls .refinfo/MediaServo/.agents/agents/*.md | wc -l` (= 10); our counts
> from `bash accessbase.sh agents check` layer summaries. "16 unrouted
> skills" is DERIVED: 37 − 15 have-equivalents − 5 openspec (ruled out,
> D123) − 1 ui-ux-review (own ruling below).

> **Provenance:** the user's third omission finding forced a directory-level
> diff (`.agents/agents/`, `.agents/teams/`, 16 skills had NO ruling here).
> v2 folds in the rt-panel review (3 blockers + 4 HIGH + 8 M/L, all closed
> or converted to explicit adjudication points below). Donor reference
> commit: MediaServo `a2c1959` (HEAD at analysis; role/team files stable
> since 2026-10-30 `52c9722`..`c974c80`).

**Status:** ADJUDICATED 2026-11-18 — 4 rulings (A / A+ / A / A) recorded in
the Adjudication record below. Execution NOT yet sanctioned; batches
RT-A → RT-B1(A+ form) → RT-C (three group rounds).

## Baseline findings (v2, corrected per panel)

1. Structural: `.agents/agents/` (10 role files, donor; acceptance-command
   admission rule verified in 10/10) and `.agents/teams/` (routing.md
   four-class + 4 scenario lineups, verified) — absent here.
   **Trigger status CORRECTED (panel B-3)**: DEFERRED row-1's trigger
   ("≥2 recurring EXECUTION batches/week") is NOT satisfied — all four
   recent team sessions were read-only review panels; the register is 0 days
   old and its recheck carrier (repo-audit Full) has never run.
2. Skills (donor 37): 15 HAVE equivalents; 5 openspec = RULED-OUT by our
   **D123** (retire openspec family, 2026-09-23); ui-ux-review = **OWED,
   own ruling point** (panel found the "already ruled" claim had zero
   recorded basis — this plan corrects it); remaining **16 unrouted** (13
   with zero recorded mention; 3 carrying DANGLING references here —
   test-driven-development (skills-router ×4 + skill-router ×4 + a plan),
   api-interface-design (11-04 plan miscalled it existing; expert-panel
   cites it as a lens), context-engineering (tombstone weak refs) — ruling
   out any of the three requires reference cleanup in the same change).
3. Rules domains: superset-compatible (donor cpp = its C++ product; our zh
   legacy mirror). No action.
4. Top-level: donor `.agents/targets.json` ≡ our
   `scripts/agents/agent-targets.json` (HAVE; donor's adds an agents-surface
   field — consumed only if RT-B lands). mcp.json HAVE (ours richer).

## Adjudication record (2026-11-18, ruled one-at-a-time, IDs cited in first commits)

| ID | Point | Ruling |
|---|---|---|
| RT-1818-A | Parity ledger design | **A** — four-state ledger (HAVE / RULED-IN-PENDING / RULED-OUT / OWED); OWED rows carry 3 fields + POINTER; five-field authority stays solely in DEFERRED.md (no duplication, no consistency gate) |
| RT-1818-B1 | Role-layer consumption | **A+ (user upgrade on live evidence)** — post-panel verification found the consumption path EXISTS: donor renders `.codebuddy/agents/` for CodeBuddy to natively register (targets.json agents_target, verified), and this session's team tool exposes `subagent_path`. RT-B1 therefore LANDS role files (rendered via a new agents projection) AND live-fires consumption at the next panel via subagent_path; fallback to plain-A scope if first spawn fails (documented loss ~1h) |
| RT-1818-B2 | Trigger basis + register honesty | **A** — DEFERRED row-1 trigger amended to match reality (review panels + explicit rulings + role-file consumption all count); D-entry same batch; this amendment IS the register's first recheck |
| RT-1818-C | 16 unrouted skills | **A** — by-group adjudication AT EXECUTION (G1→G2→G3, per-skill overlap evidence per round); ruled-out-with-dangling-refs get same-change cleanup (three identified) |

## Batches (v2)

### RT-A — DONOR-PARITY ledger + permanent check

- **Amends RA-1818-1 deliverable** (`.agents/skills/repo-audit/SKILL.md` 2D)
  and the RA-1818 register (`docs/superpowers/DEFERRED.md`) — ruling
  citations required in the first commit.
- `docs/superpowers/DONOR-PARITY.md`: FOUR states — HAVE / RULED-IN-PENDING
  (ruled adopt, port not landed) / RULED-OUT (reason + ruling id) / OWED
  (shape, source, reason; NO trigger fields). Register triangle declared in
  its header: donor-ledger = provenance of what WAS adopted;
  DONOR-PARITY = inventory of ALL donor assets; DEFERRED.md = the only
  place trigger/schedule fields live (2D asset list stays eight; the parity
  check hangs under the existing "donor ledger" asset with a pointer).
- repo-audit 2D gains: "donor-parity: every donor asset in one of four
  states; new OWED requires a ruling within one audit cycle; transitions
  (OWED→ruled→HAVE) update this ledger; a landed port moves its row to HAVE
  and closes the linked DEFERRED row."
- DEFERRED register header gains the recheck note (Full-run cross-link).
- Acceptance (EXISTING gates only, panel F4.1 fix): agents check full
  roster exit 0; TRIGGERS/skill-lint green; ledger row count == counting
  command (37 + agents/ + teams/ + rule domains + top-level files, rule in
  file). The parity check itself is the pre-registered recheck for RT-B1/C
  and later batches, NOT for RT-A.

### RT-B1 — routing + agent-lint + role rendering (A+ form) + lint-boundary table

- **Post-adjudication recheck insertions (2026-11-18 复审, evidence-based):**
  (R-1) donor's rendered `.codebuddy/agents/` face is TRACKED (git ls-files
  verified) — unlike our gitignored rules/skills mirrors. RT-B1 therefore
  renders the agents face as TRACKED (rationale: role files are repo
  declarations readable by collaborators/CI, not per-machine mirrors) and
  adds the path to generated_tracked; if the first live-fire fails and we
  fall back to plain-A, this decision reverts with it.
  (R-2) dialect normalization is a HARD PRECONDITION: all 10 donor role
  files carry `model: inherit` — the exact token that broke Qoder host-wide
  (donor 63b1b54, per-field probing discipline). The renderer MUST normalize
  or drop the model line per host face (CodeBuddy tolerance unverified —
  covered by the live-fire), never pass the raw donor dialect through.
- `.agents/teams/routing.md` adapted (four classes; lineups: new-feature /
  pre-merge review / cross-package refactor / governance adoption — the
  audit lineup maps to the adjudication class, per donor shape).
- agent-lint as a new governance layer (port donor agent_lint.py checks,
  node .mts): name==stem, unique, body budget, tools verb whitelist,
  read-only negative, skills references resolve — over `.agents/agents/`
  (empty until RT-1818-B1b/c lands files; lint stays green on empty with a
  self-test pair per CONSTRAINTS).
- **Lint-boundary table** (panel #2): agent-lint owns role files wholly;
  rule-ref-lint targets NOT extended (donor role frontmatter is Claude
  dialect — extending would trip ADJ-7d host-private scan; any C/D/PIT in
  role bodies is agent-lint's to check); TRIGGERS grammar NOT extended —
  routing.md never enters the TRIGGERS system, it LINKS to it.
- Acceptance: agent-lint in roster with self-test; routing.md present; the
  three boundary declarations above recorded in the plan's execution log.

### RT-C — 16 unrouted skills: group rulings (no porting)

- Three group cards with per-skill overlap evidence (panel-corrected);
  ruled-out skills that carry dangling references get reference cleanup in
  the same change (three skills identified above).
- Every skill ends as RULED-IN-PENDING / RULED-OUT / OWED→DEFERRED row.
  ui-ux-review gets its own explicit ruling here (correcting the phantom
  "already ruled").
- Acceptance: PARITY ledger states match rulings; DEFERRED rows for any
  OWED; zero silently swallowed; agents check green.

## Verification plan

- V1 RT-A: ledger complete (counting command in file); 2D line live;
  amends-citations present; agents check green.
- V2 RT-B1: agent-lint rostered with self-test; routing.md links (not
  duplicates) TRIGGERS.
- V3 RT-C: 16 + ui-ux-review states recorded; reference cleanup verified.
- V-final: ci census pass=4; full-roster canary.

## Execution log (filled on landing)

**EXECUTED 2026-11-18 — RT-A / RT-B1 / RT-C landed, full chain green (15
layer summaries, exit 0), census pass=4.**

- RT-A: `docs/superpowers/DONOR-PARITY.md` seeded — 37 skills + non-skill
  assets in four states (17 HAVE / 2 RULED-IN-PENDING / 5 RULED-OUT via D123
  / 13 OWED→DEFERRED links); repo-audit 2D gains the permanent parity check
  (four states, ruling-within-one-cycle, transitions on landing); DEFERRED
  header records its first recheck (RT-1818-B2).
- RT-B1 (A+ form): 10 role files written (each with a custom acceptance
  nobody else provides); agent-lint layer landed (name==stem / unique /
  body budget / tools whitelist / read-only negative / skills resolution /
  acceptance-present); roles-links projection to TRACKED
  `.codebuddy/agents/` (byte-equal mirror + orphan detection); routing.md
  adapted (four classes, audit→adjudication mapping); lint-boundary table
  documented (agent-lint owns role files wholly; rule-ref-lint targets NOT
  extended — donor dialect would trip ADJ-7d; TRIGGERS grammar NOT
  extended — routing.md LINKS, never duplicates). **Live-fire scheduled**:
  next panel session spawns roles via subagent_path.
- RT-C: prepared as group cards (G1/G2/G3) — adjudication at execution-time
  as ruled.
- **Implementation findings during landing (all fixed live)**:
  (i) agent-lint's parseFrontmatter call used the WRONG SHAPE (top-level
  fields instead of the `{fm, body}` destructure) — the 20 "empty tools / no
  acceptance" findings were parse artifacts, not real violations. Fixed by
  following skill-lint's working destructure pattern (PIT-095 family: read
  the interface before consuming it — the third same-day instance of
  verify-the-interface).
  (ii) skills-reference semantics corrected live: references to
  RULED-IN-PENDING/OWED skills are LEGAL forward dependencies (the parity
  ledger is their name-fixture); zero-record references are the finding.
  One real finding fixed by correcting the role file itself
  (governance-steward cited rule:evolution-protocol in its skills field —
  moved to the Role section as `rule:`).
- V1: agents check full roster exit 0. V2 pending (first Quick audit already
  landed — `repo-audit-latest.md` IS the V2 output). V3: tombstone + sweep
  spot-checks green. V5: DEFERRED 16 rows verified.
