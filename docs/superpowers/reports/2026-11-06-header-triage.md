# Header triage table — W4 first pass (2026-11-06, drafted during run #32's flight)

Input to disposition: plan `docs/superpowers/plans/2026-11-05-s0-s1-closeout.md` W4. Rules
binding: whole-header read before judging (T2-family ×4); REWRITTEN needs 2 evidence types;
a survived verdict may stay `KEPT-HONEST-STALE` — no date-painting (C-2); exemptions derived
from text, not lists (D-d). Last-touch column measured via `git log -1 --format=%ad -- <file>`.
All 37 stale files are COLD (newest stale touch = 11-02, zero parallel-session activity in
docs/modules) — the hot-zone rule changes nothing here; batch order follows evidence-class.

Categories: **(a)** this session's ledger already carries the anchor — rewrite directly;
**(b)** verdict needs its own re-verification pass; **(c)** re-label/exemption candidate
(historical plan-surface or superseded design docs).

| Header | Last touch | Class | Disposition (proposed) | Anchor / what the pass must do |
|---|---|---|---|---|
| monitoring | 09-23 | a | REWRITTEN | T12/P3-A on 3 types: §13.3 wording "rules provided; integration operator-side" |
| secret-mgmt | 09-23 | a | REWRITTEN | plan Tier-2 row verbatim: envelope versioning + re-encrypt live; no EXTERNAL KMS |
| messaging | 09-29 | a | REWRITTEN | T1 evidence reused (webhook-dispatcher SKIP LOCKED + metrics); events/webhooks shipped |
| database | 10-08 | a | **KEPT-HONEST-STALE** | T3: header ALREADY splits retention(consumed)/archival(not) correctly — verdict survived; log only, no edit |
| audit-sdd | 09-29 | a | read-whole-line, likely KEPT | T2: the SUPERSEDED correction lives in the same line; probable no-op, must re-read first |
| error-codes-reality | 11-02 | b | re-verify pass | E6 adjacent; no session anchor yet |
| auth-provider | 10-08 | b | re-verify | Q-ladder waves touched auth surface; needs endpoint scan |
| security | 10-08 | b | re-verify | largest surface; 3 waves landed since (logout/data-scope/verification day) |
| identity-sdd | 09-30 | b→S5 | DEFER-REGISTERED | Tier-1 A3 contract drift is S5's job; header stays, triage row records why |
| ui / frontend | 09-28/23 | b | re-verify batches | big files; needs admin-ui reality pass |
| overview / tech-stack | 09-23 | b | light verify | mostly stable; check package list + wave counts |
| webhook, self-service, notification, ops, infrastructure, concurrency, distributed, backup, build-modes, changelog, file-storage, licensing, i18n | 09-23/28 | b | re-verify in batches | each against current routes/packages inventory |
| admin-sdd, health-check-sdd, i18n-sdd, logging-sdd, migration-sdd, shared-types-sdd | 09-23/29 | b/c | per-package truth | these describe L0 packages that EXIST (admin/health/i18n/logging/migration/types) — NOT exempt; verdicts must reflect "exists as library, zero consumers" (E3/T14 truth), shared-types-sdd → types pkg naming needs check |
| setup-api-plan, setup-ui-plan, docker-dev-plan, p3-supplement | 09-23 | c | exemption candidates | historical plan surfaces; if headers carry superseded/informational text the lint skips them — else re-label with marker (2 min each, evidence = their own bodies vs delivered reality) |

## Proposed first batch (X-2=C: user confirms standard on THIS batch, then batches run)

monitoring · secret-mgmt · messaging · database (KEPT demo) · audit-sdd (whole-line re-read) —
five headers covering all three disposition shapes, every anchor already on the ledger with
≥2 types. Expected diff: 3 rewrites + 1 kept-with-triage-note + up to 1 rewrite if the
audit-sdd re-read contradicts. Commit per wave W4 rule with table/gate validation.

### FIRST BATCH EXECUTED (2026-11-06) — actual outcome, including what the batch caught

| Header | Triage said | Reality on whole-line read | Final disposition |
|---|---|---|---|
| monitoring | REWRITTEN | matched | REWRITTEN (3-type evidence chain inline; log-shipping explicitly not re-checked) |
| secret-mgmt | REWRITTEN | matched | REWRITTEN (T9 2-type anchor; "env-only" superseded, KMS-absence retained as still-true) |
| messaging | REWRITTEN with T1 anchor | **TRIAGE ANCHOR WRONG** — T1 is webhooks/events (webhook.md's territory); messaging is §40 mail/SMS and its 09-28 update text already reads correctly | **KEPT-HONEST-STALE**; T1 anchor reassigned to webhook.md (later batch) |
| database | KEPT demo | matched — retention/archival split survives (T3) | KEPT-HONEST-STALE |
| audit-sdd | likely KEPT after re-read | matched — the SUPERSEDED-by-R-audit correction sits in the same line's second half (T2 family confirmed live again) | KEPT-HONEST-STALE |

Lesson banked: 2 rewrites, 3 kept, 1 triage-anchor error caught by the whole-line-read rule —
the batch did exactly its X-2=C job: proved the standard AND proved the gate does not force
rewrite theater. `grep -m1`-style triage summaries are not evidence; the table rows above were
built by reading what the headers actually say.

## What still must be read before later batches (stated, not assumed)

- The sdd six: current package inventories + the S3 rulings (admin deletion pending) — an
  sdd header must not claim "shipped" for a package ruled for deletion; register the tension.
- Exemption markers: whether setup-*-plan/p3-supplement bodies already contain
  superseded/informational phrasing (lint derives from TEXT — no text, no exemption).
- identity-sdd: stays DEFER-REGISTERED (S5 owns the contract-drift fix; W4 records only).
