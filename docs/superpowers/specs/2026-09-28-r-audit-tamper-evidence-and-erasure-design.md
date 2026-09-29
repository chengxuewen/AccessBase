# R-Audit Batch — Tamper-Evident Audit Chain + Sanctioned Erasure (DG-2 + DG-8b)

**Date:** 2026-09-28 | **Status:** RATIFIED rev.3 — dual-Momus + scoped re-review #2 all absorbed (S1-S4 + orphan-dup cleanup); user rulings U1-U9 all=A: platform-only verify (U1), erasure explicit opt-in w/ legal basis (U2), events scrubbed same-tx w/ `events_scrubbed` ledger column (U3), legacy backfill baseline-trust (U4), writer-clock timestamps + NTP prereq (U5), possession-proven channels exempt-and-marked (U6), forgot-password ungated self-help (U7), audit.erased broadcast (U8), anchor-root export retained (U9) | **Ruling basis:** plan `docs/superpowers/plans/2026-09-28-batch-r1-quick-win-safety-net.md` §"Decision gates — RULED" rows DG-2(A)+DG-8b(A+B)





## 1. Problem

The design (security.md §19.17) promises tamper-evident audit logs via a SHA-256 hash chain. Reality: `packages/audit/src/logger.ts` computes `hash`/`previousHash` per entry (lines 52-63, 116-127) but the server's `AuditStorage` (`apps/server/src/app.ts:374-398`) persists only the 12 plain columns — `audit_logs` has **no hash columns** (`packages/identity/src/db/schema.ts`, auditLogs table). There is no integrity verifier, no DB-level immutability, and user deletion (`UserManager.ts:245` hard cascade) leaves the subject's email/IP in historical `requestBody`/`ip` — so GDPR erasure is simultaneously promised-nowhere and broken-everywhere.

Fixing the chain naively (recompute-on-read over mutable rows) would make RTBF erasure indistinguishable from tampering. This spec designs both **in one hash format** — the binding constraint from the ruling.

## 2. Goals / Non-goals

**Goals**
- G1: Every persisted audit row carries a content hash; any post-hoc modification of a row's protected content is *detectable* by an integrity endpoint.
- G2: Chain survives process restarts and **multiple nodes** without a shared in-memory head (the current in-memory `previousHash` is a fiction on restart/scale — replaced, see D2).
- G3: Retention pruning (existing daily sweeper) never reads as tampering.
- G4: A sanctioned erasure (RTBF) is technically executable AND cryptographically distinguishable from tampering.
- G5: Capability boundary stated in docs: detects application-layer and single-row edits by privileged app users; does NOT defend against a DB superuser who rebuilds whole spans — and the export mechanism that mitigates that is explicitly out of scope but named.

**Non-goals**
- WORM storage, external timestamping (RFC 3161), log shipping/SIEM, Merkle-tree proofs for third parties, per-row encryption, DB-role separation (app role keeps INSERT/SELECT/limited UPDATE — see D4 for why), retroactive hashing decisions for pre-existing rows beyond the D6 default.
- No events/webhook outbox coverage (different table family, different guarantees; audit only).

## 3. Design

### D1 — Hash = per-row content hash; chain = per-day anchored list (no per-row prev pointer)

Row hash covers protected content only:

```
row_hash = SHA256( canonicalJson({tenantId, userId, action, resourceType,
           resourceId, requestBody, responseStatus, requestId, ip, userAgent,
           createdAt: e.timestamp.toISOString()}) )   -- WRITER-supplied timestamp, see D4/B1
```

`canonicalJson` = recursive stable sort of object keys (jsonb storage reorders keys — plain `JSON.stringify` over a jsonb value is NOT reproducible; see R1 test lock). Rows are ordered within a day by `(created_at, id)`; no cross-row hash dependency in the row itself.

**B1 fix (BLOCKER, flows+blockers both live):** the write path must PERSIST the writer's timestamp instead of letting `defaultNow()` assign it — `AuditLogEntry.timestamp: Date` already exists (`packages/audit/src/types.ts:28`, set by middleware) and is currently discarded at persistence. The hash therefore commits to `e.timestamp` and the row stores the same value → exact round-trip. Multi-node consequence: day-bucketing and the grace window then depend on writer clocks — accepted (clock skew bounded by ops, NTP-assumed; alternative RETURNING-then-UPDATE rejected — breaks hash-at-insert atomicity and opens a NULL-hash race with the anchor worker).

**Why not prev_hash-in-row:** a per-row chain pointer requires a single writer knowing the current head — impossible multi-node without hot contention (DG-4 commits to multi-node), and hostile to erasure (a tombstone UPDATE would break the pointer of its successor — precisely the DG-8b conflict). A daily *anchor* folding the ordered row hashes gives the same "any edit detected" property at day granularity while keeping rows independently writable and erasable.

### D2 — Anchors: one table, one job, advisory-locked

```
audit_chain_anchors (
  id           bigserial PK,
  day          date NOT NULL,           -- UTC day of created_at
  seq          integer NOT NULL,        -- 1..n within a day (roll at ~5000 rows)
  first_id     uuid NOT NULL, last_id uuid NOT NULL,
  row_count    integer NOT NULL,
  root         text NOT NULL,           -- SHA256 of concat(row_hash_1..n), ordered
  prev_root    text,                    -- root of (day,seq-1); day seq1 links to last anchor of previous day
  pruned_at    timestamptz NULL,        -- B4: retention sweep marked this anchor fully pruned
  anchored_at  timestamptz NOT NULL default now(),
  UNIQUE (day, seq)
)
```

Anchor worker (new `apps/server/src/utils/audit-anchor.ts`, **pool ownership = retention-sweeper precedent**: lazy own pool via `makeDb()`, `stop()` wired to onClose, NODE_ENV=test never registers — Q4c B3 + PIT-082 eager-pool lesson): every 5 min (config `AUDIT_ANCHOR_INTERVAL_SECONDS` default 300):

1. Open `db.transaction()`; FIRST statement: `SELECT pg_try_advisory_xact_lock(727242)` — on false, roll back and exit silently (another node owns this pass). **B2 fix (BLOCKER):** xact-scoped lock, NOT session-scoped: the repo has no connection-pinning idiom (grep pool.connect/getClient = 0) and migrate.sh's session discipline (single pinned psql, :60,:88) does not transfer to node-pg Pools — a session lock would strand on a returned-to-pool connection and self-deadlock the node forever. COMMIT auto-releases.
2. Fold ALL unanchored rows older than the **grace window 90s** (`anchor_id IS NULL AND row_hash IS NOT NULL AND created_at < now() - grace`) across ALL tenants, ordered `(created_at, id)`, rolling ~5000 per anchor. (B7: per-tenant iteration was a draft leftover — the ledger is global, one chain, strictly stronger.)
3. Insert anchor with `prev_root` = previous anchor's root; in the SAME transaction set `audit_logs.anchor_id` for folded rows. Crash between insert and marking = rollback of both — anchor never half-exists.

First-ever anchor: `prev_root` = GENESIS sentinel documented in code. Fresh installs with no unanchored rows: tick no-ops.

**Retention interaction (B4, BLOCKER):** `retention-sweeper.ts:46` DELETEs audit rows by age with default ON (365d, `?? 365`, boot+60s then 24h) — without treatment, every swept anchor re-folds short forever and G3 is violated. Fix: before the DELETE, in the SAME transaction, mark anchors whose every folded row is about to be deleted (i.e. anchor `day` entirely below the retention horizon) `pruned_at = now()`; mark-first so a crash between mark and delete leaves *skip*, not *alarm*. Verifier skips `pruned_at NOT NULL` anchors and reports the `prunedFrom` boundary (D7).

### D3 — Migration 0010 (drizzle-kit v7 ritual, D124)

- `audit_logs`: ADD `row_hash text` (NULLable — see D6), `anchor_id bigint NULL`, `erased_at timestamptz NULL`, `erasure_id uuid NULL` (B3: D4's UPDATE names it — must exist in the migration).
- New tables per D2/D5.
- Chain file via `pnpm --filter @accessbase/migration… db:generate` (v7 snapshot ritual), **plus**: `scripts/migrate.sh` SENTINELS entry for 0010 (N-batch discipline — probe `row_hash` column), ops test expectation flip **10→11 chain files** (current head 0009; B7/flows count correction), `accessbase.sh db:push` on dev DB (conventions reaffirmed), journal untouched, snapshot table-qualified where clauses intact.

### D4 — Write path: hash at insert; erase gets a narrow UPDATE

- `AuditStorage.write` (app.ts:382-396) adds `rowHash` computed by the SAME `canonicalJson`+SHA256 util (new `packages/audit/src/hashing.ts` exported; server imports it — single implementation for writer AND verifier, drift = T-1/T-8 cross-check) AND persists `createdAt: e.timestamp` (B1 fix, see D1).
- `AuditLogger`'s in-memory chain (`previousHash` :26,59-62) is **deleted** — it is the fiction this batch exists to bury. `AuditLog`/`AuditLogEntry` types drop `hash`/`previousHash` (audit types.ts:41-42) and gain `rowHash?`. The async buffer path (:110-134) and direct path (~:246) both stop threading a prev pointer. (Flows correction: there is no `verifyIntegrity` to remove — the phantom citation is struck; verification never existed, which is the finding.) Audit package tests updated accordingly (breaking-but-honest internal API change; the package has one consumer).
- Erasure UPDATE (D5) touches ONLY `requestBody` (jsonb), `userId`, `ip`, `userAgent`, `erased_at`, `erasure_id` — **never** `row_hash`, `anchor_id`, `created_at`, `action`, `resourceType/resourceId`, `responseStatus`, `requestId`. Column-level separation is what lets verifier distinguish "provenance preserved, content destroyed on purpose" (row has `erased_at` → row_hash is expected to MISMATCH the content; verifier checks the ERASURE RECEIPT instead, D5) from tampering (no erased_at but content≠hash → alarm).

### D5 — Sanctioned erasure ledger + admin funnel

```
audit_erasures (
  id             uuid PK default gen_random_uuid(),
  tenant_id      varchar(64) NOT NULL,
  subject_user_id uuid NOT NULL,      -- the user being forgotten
  requested_by   uuid NOT NULL,       -- acting admin
  legal_basis    text NOT NULL,       -- free text, required ("GDPR Art.17" etc.)
  receipt_hash   text NOT NULL,       -- SHA256 of ordered affected row_hash set — binds the ledger to the rows
  rows_affected  integer NOT NULL,
  events_scrubbed integer NOT NULL default 0,
  created_at     timestamptz NOT NULL default now()
)
```

`UserManager.eraseAuditData(subjectUserId, { requestedBy, legalbasis }, db?)` — new manager funnel (K/Q2b discipline: mutation lives in the manager, routes map errors):
1. Select target rows `WHERE user_id = subject` (tenant-scoped via caller's tenantId) **AND `row_hash IS NOT NULL`** (B6: legacy un-hashed rows cannot enter a receipt — see D6 for their treatment).
2. Compute `receipt_hash = SHA256(concat(row_hash ORDER BY created_at, id))` over the ORIGINAL `row_hash` values — the receipt fingerprints exactly the pre-erasure set. Rows excluded by step 1's filter are counted `legacySkipped` and reported (NOT silently).
3. One transaction (routeTx/Q2b pattern): insert ledger row; UPDATE **ALL** subject rows `WHERE user_id = subject` per D4 scrubbing — PII removal is the point, so scrubbed rows include the un-hashed legacy ones — `requestBody`→`'{}'::jsonb`, `userId`→`'[ERASED]'` (explicit placeholder; the column is varchar(64)), `ip`→NULL, `userAgent`→NULL, `erased_at=now()`, `erasure_id=<ledger id>`. Only the receipt-covered subset (step 1's filter) is provable by recomputation; scrubbed-but-unhashed rows carry `erasure_id` too and classify as `erasedLegacyUnhashed` (privacy satisfied; provenance provability is the accepted baseline-trust gap). `erasure_id` is the LINK the verifier walks (see verification procedure below).
4. Emit `audit.erased` on `DomainEventType` (union extension — T3 precedent makes this cheap; ops subscription material; payload = {subjectUserId, rowsAffected, legacySkipped} — ids survive, no PII).
5. **(U3) Same transaction: scrub the outbox.** `UPDATE events SET payload = '{"erased":true}'::jsonb WHERE payload->>'id' = subject OR payload->>'email' = <captured email>` (user.* funnels carry the subject id; R1-T3 auth.login.* carry the email value — capture it into the ledger call before it disappears from users). Ledger gains `events_scrubbed integer NOT NULL DEFAULT 0`. Webhook delivery status/attempts rows untouched; §2's non-goal line covers the CHAIN only — erasure spans both tables.


**Verification of erased rows (B3 fix — set membership must be COMPUTABLE, not digest-oracle):** `row.erased_at NOT NULL` → (a) require `row.erasure_id` non-NULL and a matching ledger row; (b) recompute: `SELECT row_hash FROM audit_logs WHERE erasure_id = $ledger ORDER BY created_at, id` → SHA256 concat → equals `ledger.receipt_hash`; (c) require the row's provenance columns (`action`, `resourceType`, `resourceId`, `requestId`, `responseStatus`, `created_at`, `row_hash`, `anchor_id`) untouched — they are the non-touched side of D4's column split. Hand-set `erased_at` without ledger = FAIL (no receipt resolves). Superuser forging BOTH ledger and rows by rebuilding whole spans = the documented D7 boundary, unchanged.

Trigger: the existing DELETE /users/:id route (admin delete, hard cascade) gains an **explicit opt-in body flag `eraseAudit: true`** + `legalBasis` string — default OFF. Rationale: deleting a user must not silently destroy forensic history (a privileged user could nuke evidence by deleting the account); RTBF is a legal call, make the caller say it. The 409/error mapping rides conflict-mapper only if new throw tags appear — record in T-plan.


### D6 — Legacy rows: backfill once at boot, then never

New rows all carry `row_hash`. Pre-0010 rows have NULL. Boot/backfill (idempotent): hash NULL rows OLDEST-first in batches of 1000 per anchor-worker tick (before that tick's fold, so backfilled rows anchor promptly) — over *current* content, i.e. **trusts** the existing table as the baseline (state this honestly in docs: tamper-evidence starts when evidence collection starts). The anchor chain begins at the first anchored day. Verifier reports `legacyPreChain` count rather than failing on them.

**Backfill × erasure interlock (B6):** the backfill skips rows with `erased_at NOT NULL` — a scrubbed legacy row hashed later would commit a hash to destroyed content that no receipt covers. Such rows are counted `erasedLegacyUnhashed` in the verify envelope and are an accepted residue of the baseline-trust posture (their provenance columns still anchor once hashed… they never are — say so: they remain permanently outside the chain, listed honestly; a fresh RTBF request after backfill completes erases them under a proper receipt if ops demands closure).
(Anchor-before-backfill ordering enforced by the fold filter `row_hash IS NOT NULL` + backfill-first-per-tick. Alternative — refuse boot until backfilled — rejected: blocks large installs.)

### D7 — Verify endpoint

`GET /api/v1/audit/verify?from=<date>&to=<date>` (defaults: last 30 days; window cap 90 days/request). `preHandler: app.authenticate` + `requirePermission('audit:read')` (**zero new permission codes**; authorize.ts routePermissions entry added same commit; `audit:read` already exists at `permissions-seed.ts:25` [flows count correction — not :191] and is TENANT_BINDABLE `permission-partition.ts:39`).

Response envelope `{success, data: {from, to, rowsChecked, rowsErased, erasedLegacyUnhashed, legacyPreChain, anchorsChecked, prunedAnchors, prunedFrom: date|null, unanchoredRows, chainOk, firstFailure: {day,seq,kind:'row-mismatch'|'anchor-mismatch'|'orphan-erasure'|'unanchored',rowId?} | null, partial, durationMs}}`. 200 even when `chainOk:false` — a verification result is not an error (health-report posture; alerting is the caller's job). Service: page anchors in window → for each anchor re-fold row hashes (incl. D5's erasure-receipt recomputation) and compare root + prev_root; `pruned_at NOT NULL` anchors are SKIPPED (their rows are gone by policy — the anchor itself remains the proof-of-existence record) and set `prunedFrom = min(pruned day)`. Then the **B5 hole-closer**: one in-window query `count(*) FROM audit_logs WHERE row_hash IS NOT NULL AND anchor_id IS NULL AND created_at < now() - ${grace}` > 0 → `chainOk:false, kind:'unanchored'` (backdated forged inserts invisible to anchor-page-over — this check also doubles as the anchor-worker stall watchdog). Read-only; lazy via managers' shared handle — no new Pool (PIT-081).


Tenant posture: DEFAULT tenant verifies the global chain (anchors are global); non-default tenants get a **scoped** verification limited to their own rows within each anchor — which per-anchor root cannot isolate (a tenant's rows interleaved in the fold). DECISION: cross-tenant scoped verify is OUT; `audit:read` for non-default tenants already scopes their audit *listing*, but `/verify` is platform-only: add to the platform belt list (`TENANT_PLATFORM_ONLY` pattern, tenants.ts precedent) — record in docs + error-codes-reality.

Capability-boundary paragraph (mandatory, docs): app-layer single-row/field edits = detected; row deletion = detected (anchor row_count + fold mismatch); full-span DBA rebuild = NOT detected without external copies — mitigation named (anchor table + periodic export of last anchor root to config `AUDIT_ANCHOR_EXPORT_PATH`, write-only file, ops rotates it off-box; implementation of the exporter = IN, one fs write per anchor; consuming it off-box = ops story).

### D8 — Config & ops

`config.ts`: `auditAnchorIntervalSeconds` (default 300), `auditAnchorGraceSeconds` (90), `auditAnchorExportPath` (optional; unset = no export). `.env.example` three keys. `warnDegradedChecks`: no new entries (nothing bricks if unset). metrics.ts: `accessbase_audit_anchor_last_root_ok` (0/1 set at anchor time on export failure) + `accessbase_audit_verify_total{result}` — two instruments, M5 posture, no extra scrape-time DB. `docker/prometheus/rules.yml` sample: `AccessbaseAuditAnchorStalled` (>3× interval no new anchor, warning).

## 4. Testing matrix (RED-first per site)

| # | Lock | Layer |
|---|---|---|
| T-1 | `canonicalJson` stability: jsonb-key-order inputs → same hash across writer/reader; nested arrays unchanged | unit |
| T-2 | anchor fold order determinism: rows with identical `created_at` → stable `(created_at,id)` order across two computes | unit |
| T-3 | tamper detection: insert 3 rows → anchor → UPDATE one `action` → verify FAILS at that row (real-PG integration, scratch db pattern of session-rotate/oidc integration) | integration |
| T-4 | erasure passes: erase funnel → verify OK; ledger receipt recomputes equal (D5 procedure); forged `erased_at` without ledger → FAILS; erase incl. legacy NULL-hash rows → `legacySkipped` counted, none enter receipt; (U3) matching events rows payload-tombstoned same tx, delivery status rows intact | integration |
| T-5 | retention coexists: sweeper marks fully-swept anchors `pruned_at` (mark-first, same tx) → verify OK, `prunedFrom` reported; crash-between-mark-and-delete still skips not alarms | integration |
| T-6 | multi-node proxy: two concurrent anchor transactions — loser's `pg_try_advisory_xact_lock` returns false immediately, exits silently (assert NO fold, NO anchor insert); winner completes; commit auto-releases (follow-up tick succeeds) | integration |
| T-11 | backdated forged INSERT (anchor_id NULL, old created_at) → verify FAILS with kind 'unanchored'; healthy chain zero false-positive | integration |
| T-7 | route tests: /verify permission belt (non-default 403), audit:read ok, malformed range 400 envelope | unit |
| T-8 | write path: new rows carry row_hash equal to the standalone hashing util (single-implementation cross-check); AuditLogger internal-chain removal keeps existing storage tests green (adapted) | unit |
| T-9 | e2e: Audit page button hidden without audit:read, report renders for mock OK/FAIL | e2e mock |
| T-10 | backfill: legacy NULL-hash rows get hashed oldest-first, chain starts after; second boot zero-rework | integration |

Live-fire ledger (post-impl, report): fresh-PG boot→login→actions→anchor within 6 min→verify via curl 200 chainOk:true→edit one row via psql→verify false→erase user→verify true→sweep forward→verify true. NOT covered: off-box anchor-export rotation (ops).

## 5. Known risks the review must attack

- **R1 key-order drift** writer(jsonb-in) vs verifier(read jsonb-back): canonicalJson must be order-independent *and* type-aware (Date ISO vs string; jsonb numbers). T-1/T-8 aim at it; a miss = false alarms in prod. (PIT jsonb family precedent.)
- **R2 ordering tiebreak** — after the B1 fix the writer supplies PER-ENTRY timestamps (`e.timestamp`), so flush-batch rows no longer share one `defaultNow()` instant; identical timestamps remain possible at ms-collision. Fold order stays `(created_at, id)` with the uuid tiebreak, deterministic across reads; drift between anchor-time ORDER BY and verify-time ORDER BY = mismatch. T-2.
- **R3 erase-vs-anchor race**: erasure UPDATE lands after a row was folded, before the next anchor — the NEXT anchor re-folds the SAME (now erased) row → root changes vs history?? NO — anchors fold each row exactly once (anchor_id set); erased rows are never re-folded; verification of an erased row uses the receipt. Ensure the fold query filters `anchor_id IS NULL` AND the erasure funnel refuses rows with `anchor_id IS NULL` fresher than grace (they might be mid-anchor). Race window review point.
- **R4 backfill hash ≠ writer hash** if any legacy `requestBody` is non-canonical (e.g. double-encoded JSON strings from the old jsonb-string seam era). Backfill trusts content as-is; if the shape surprises, row hashes simply commit to current bytes — acceptable per D6 baseline-trust posture; verifier must reuse the same util.
- **R5 performance**: verify re-hashes up to 90 days of rows in-request. 5000 rows/anchor ≈ 50ms hash work; cap window 90d + LIMIT on rows checked per request (100k) with `partial:true` flag. Document.

## 6. Delivery shape (plan-fragment for the executing batch)

1. 0010 migration + SENTINELS + ops test flip + schema types (identity)
2. `hashing.ts` in @accessbase/audit + AuditLogger internal-chain deletion + package test adaptation (breaking types — single-consumer)
3. write-path hash (app.ts) + backfill + anchor worker + lifecycle (app.ts/onClose) + **retention-sweeper mark-first change (B4: mark `pruned_at` in the same tx before the age-DELETE — `retention-sweeper.ts:46`)** + config 3 keys + metrics 2 instruments + rules.yml
4. erasure ledger + `eraseAuditData` funnel + DELETE /users event flag + emit `audit.erased` + event catalog
5. /audit/verify route + service + belt + error reality + api client + Audit page button + e2e mocks
6. docs: security.md §19.17 correction (the design's prev_hash-in-row scheme is REPLACED by day-anchored roots — supersede explicitly, this is the design doc eating its own draft), self-service.md RTBF paragraph, webhook.md event, CHANGELOG, status/conventions batch line, identity-sdd header if it claims the old chain
7. gates + live-fire battery (section 4 ledger)

---

## Review record (2026-09-28)

- **Momus flows: OKAY** — 3 non-blocking corrections applied: phantom `verifyIntegrity` citation struck (D4/Fact-checklist), seed cite :191→:25 + ops count 7→8→**10→11** (D3/D7/Fact), and the DG-2-ruling-vs-D7 deviation surfaced to the user as DECISION-PENDING below.
- **Momus blockers: APPROVE-WITH-FIXES** — B1 createdAt-at-hash-time false premise (fixed: writer timestamp persisted, D1/D4); B2 session-scope advisory lock on pooled connections = self-deadlock (fixed: xact-scoped lock as first statement in tx, D2, T-6 rewritten); B3 erasure_id un-migrated + digest-membership uncomputable (fixed: D3 column, D5 recomputation procedure, `[ERASED]` placeholder pinned); B4 G3 dangling pruned-reference vs default-ON sweeper (fixed: pruned_at column, mark-first same-tx sweeper change, prunedFrom envelope, T-5); B5 backdated-insert detection hole (fixed: unanchoredRows check, kind 'unanchored', T-11); B6 erase×backfill race (fixed: row_hash IS NOT NULL filter + legacySkipped + erasedLegacyUnhashed honest residue, D6); B7 global-fold wording + pool-shape pin + phantom strike (absorbed).
- **User ratifications (U1-U9, all A, 2026-09-28):** U1 explicitly SUPERSEDES the DG-2 ruling wording "K-T1 tenant predicate" (platform-only holds — tenant rows interleave in global folds; per-tenant chains would be a design fork). U2 delete≠destroy-evidence threat model confirmed opt-in erasure. U3 closed the events-PII hole the §2 non-goal wording had left open. U4 baseline-trust backfill. U5 writer clock + NTP deployment prereq documented. U6/U7 possession-proven channels exempt-and-marked; forgot-password path ungated (reset email = control proof). U8 broadcast retained (zero-PII payload). U9 anchor-root export retained (the only answer to whole-span DBA rebuild).

- Post-rev.2 self-review: no new placeholders; every B-fix names its file:line or PG-behavior basis; T-matrix has **11 locks** (T-1..T-11; the earlier "12" miscount corrected).
- **Scoped re-review #2 (spec delta, 2026-09-28): APPROVE-WITH-FIXES** — orphan duplicates from the rev.2 half-apply cleared (stale D1 hash block, duplicate D2 table+worker text with pre-B2 session-lock wording, duplicate D3 lines, superseded D5 verification paragraph, superseded D7 envelope); S1 stale R2 defaultNow wording fixed; S2 `events_scrubbed` added to the D5 ledger table def; S3 retention-sweeper B4 change now numbered in §6 delivery item 3; S4 lock count fixed. Nothing user-facing changed; U1-U9 stand.


## Fact checklist (controller-verified 2026-09-28, all grep'd this session)

- audit_logs 12 cols, zero hash fields — `packages/identity/src/db/schema.ts` auditLogs excerpt ✅
- audit:read exists (`permissions-seed.ts:25` [corrected], TENANT_BINDABLE `permission-partition.ts:39`, routePermissions audit.ts routes) ✅ — verify endpoint reuses, no triple-registration change needed
- chain head = 0009, 10 files (0010 next; ops flip 10→11) ✅
- sweeper default ON 365d, boot+60s/24h, own-lazy-pool precedent app.ts:253-266 ✅
- advisory key 727242 free repo-wide (only 727241, migrate.sh:60,:88 — session-scope there, NOT transferable to pool per B2) ✅
- logger chain lines: 26, 52-63, 110-134, ~246 ✅; audit types hash fields :41-42 ✅ (NO `verifyIntegrity` — flows pass: the earlier claim was phantom, method does not exist) ✅corrected
- `AuditLogEntry.timestamp: Date` exists (audit types.ts:28) and middleware sets it; write-map discards it — B1 evidence ✅ (app.ts:382-396 maps 10 cols, created_at left to `defaultNow()` schema.ts)
- dispatcher DI pattern + NODE_ENV=test gate to clone: `webhook-dispatcher.ts:148-152` + app.ts wiring ✅
- anchor_id/erasure columns absent everywhere (fresh): schema grep ✅
- UserManager.delete hard cascade: `:245 d.delete(users)` ✅
- events DomainEventType union closed list (auth.* extension precedent T3): events.ts:17-29 ✅ — `audit.erased` joins same way
- webhook deliveries store NO bodies (out of scope confirmed): `webhook_deliveries` columns status/attempts/lastError/responseStatus only ✅

---

## REV.4 AMENDMENT (2026-09-29, live-fired D-ERASE-1) — STATUS: PROPOSED, awaiting user ruling

**Defect (live-fire battery, A8):** the erasure funnel matches `audit_logs.user_id = subject` — the ACTOR column. A subject who never acted (created by an admin, never logged in) legally no-ops with zero ledger rows, while the admin's CREATE/UPDATE rows that EMBED the subject's email/uuid in `requestBody` survive fully scrubbed-looking. RTBF without mention-coverage is theater: the subject's PII persists in actor rows.

**Measured blast radius (scratch, 13 audit rows):** 1 mention-row (the CREATE) — small surface, per-row receipt impact trivial.

**Proposed predicate (rev.4):** the funnel's target set becomes the UNION of
1. actor rows: `user_id = subject` (existing, unchanged), and
2. mention rows: `request_body::text LIKE '%' || <subjectEmail> || '%'` OR `request_body::text LIKE '%' || <subjectUuid> || '%'` (both captured pre-scrub; email is the stable mention token, uuid the absolute one).

**Receipt consequences:** the receipt set GROWS to cover mention rows — receipts issued before rev.4 cover actor-rows only and remain valid against their recorded membership (receipt_hash binds the set it was computed over; nothing retroactively breaks). Scrub for mention rows follows the SAME D4 column whitelist (requestBody → '{}'); row_hash/anchor_id untouched → verify treats them via the ledger receipt exactly like actor rows.

**Redaction interplay:** `requestBody` of the mention row is REPLACED by '{}', so the subject's email disappears from the table; `audit_erasures.legal_basis` and the receipt remain the only records — consistent with U2/U3.

**Cost:** funnel predicate +2 OR arms; receipt test fixtures +1 mention-row case; no schema/migration change. ~half day incl. tests.

**Alternatives rejected:** (b) document actor-only boundary — leaves the headline RTBF promise hollow (the flagship scenario "admin creates user, user exercises erasure" scrubs nothing).
