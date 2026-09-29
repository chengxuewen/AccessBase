# R-Audit Batch Implementation Plan — Tamper-Evident Audit Chain + Sanctioned Erasure

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or executing-plans. Steps use checkbox (`- [ ]`) tracking. **Controller commits — subagents do NOT run git.**

**Spec (binding):** `docs/superpowers/specs/2026-09-28-r-audit-tamper-evidence-and-erasure-design.md` (rev.3 RATIFIED; U1-U9 rulings embedded). This plan decomposes spec §6 into 8 tasks; design decisions D1-D8 there are NOT re-openable.

**Goal:** audit_logs rows become content-hash-sealed at insert; day-anchored global roots make tampering detectable and retained-pruning harmless; a receipt-bound ledger makes RTBF erasure cryptographically distinguishable from tampering; `/audit/verify` (platform-only) reports it all.

## Global Constraints

- Pure-additive to wire surface EXCEPT: `AuditLog`/`AuditLogEntry` drop `hash`/`previousHash` (spec D4, breaking internal API — single consumer) and DELETE /users/:id gains optional body flag.
- TDD RED-first per task; gates at close: vitest ≥1250 all green, 4×tsc 0, eslint 0-new, e2e chromium unchanged-pass (verify button spec added), D126 gates hold (`grep -L 'Implementation status'` empty; seed stays 26 — **zero new permission codes**, verify route reuses `audit:read`).
- New chain file ⇒ `scripts/migrate.sh` SENTINELS entry + ops-test count flip (10→11) + dev `accessbase.sh db:push` — one commit.
- Advisory lock key **727242**, `pg_try_advisory_xact_lock` as FIRST statement inside `db.transaction()` (never session-scope — PIT: pool holds session locks across checkins).
- Node-pg returns `count(*)` as string — Number() both fields.
- NODE_ENV=test never registers anchor worker/backfill (Q4c B3 pattern); no startup side effects in `buildApp()` (route-guard static lock).
- Fire-and-forget telemetry swallow remains scoped to auth-events only; EVERY funnel emit here (audit.erased) rides the caller tx and MUST NOT swallow (Q4c invariant).
- Language: English everything persisted. No `as any`. Baseline counts flip only in T8 close-out.

## File structure

| Act | Path | Owns |
|---|---|---|
| Mod | `packages/identity/src/db/schema.ts` | audit_logs +row_hash/anchor_id/erased_at/erasure_id; new auditChainAnchors, auditErasures tables |
| Gen | `packages/migration/drizzle/0010_*.sql` + meta | chain file (v7 ritual) |
| Mod | `scripts/migrate.sh` + `apps/server/src/__tests__/ops-migrate.test.ts` | SENTINELS row_hash probe; count flip |
| New | `packages/audit/src/hashing.ts` + `packages/audit/src/__tests__/hashing.test.ts` | canonicalJson, rowHash, merkleFold, receiptHash — pure, zero deps |
| Mod | `packages/audit/src/logger.ts` `types.ts` + pkg tests | delete in-memory chain; rowHash?; export hashing from index |
| Mod | `apps/server/src/app.ts` | AuditStorage write: createdAt+rowHash; wire anchor worker + backfill lifecycle |
| New | `apps/server/src/utils/audit-anchor.ts` (+test) | worker: xact lock, fold, mark, export file, prune-mark coordination |
| Mod | `apps/server/src/utils/retention-sweeper.ts` (+test) | mark anchors `pruned_at` (same tx, before DELETE) |
| New | `apps/server/src/utils/audit-verify.ts` (+test) | verify service: re-fold anchors, row content-check, erasure receipts, unanchored watchdog |
| Mod | `packages/identity/src/managers/UserManager.ts` (+test) | `eraseAuditData` funnel + `audit.erased` emit on caller tx |
| Mod | `packages/identity/src/services/events.ts` | union + `audit.erased` |
| Mod | `apps/server/src/routes/users.ts` + `routes/audit.ts` + `packages/identity/src/hooks/authorize.ts` (routePermissions — real map location; NOT utils/) | eraseAudit flag mapping; GET /v1/audit/verify + platform belt inline check |
| Mod | `apps/server/src/routes/metrics.ts` (or utils) + `config.ts` + `.env.example` + `docker/prometheus/rules.yml` | 2 instruments, 3 config keys, 2 alerts |
| Mod | `apps/admin-ui/src/pages/Audit.tsx` + `api/audit.ts` + locales + `e2e/audit-viewer.spec.ts` | Verify button + report rendering |
| Mod | docs (security.md, self-service.md, webhook.md event list, error-codes-reality if new codes, CHANGELOG) | T7 |

---

### Task A1: Schema + migration 0010

**Files:** schema.ts (table defs above), generate 0010, migrate.sh, ops test.
- [ ] Step: write table defs per spec D2/D5 VERBATIM (anchors: id bigserial PK, day date, seq int, first_id/last_id uuid, row_count int, root/prev_root text, pruned_at ts null, anchored_at default now, UNIQUE(day,seq); erasures: uuid PK, tenant_id varchar(64), subject_user_id uuid, requested_by uuid, legal_basis text, receipt_hash text, rows_affected int, events_scrubbed int default 0, created_at). audit_logs: `row_hash text`, `anchor_id bigint`, `erased_at ts`, `erasure_id uuid` — all NULLable, no FKs (audit table has none today; keep posture).
- [ ] Step: `pnpm db:generate` (config out: dir), inspect SQL: zero DROPs, indexes sane; snapshot v7 shape.
- [ ] Step: migrate.sh SENTINELS += probe `row_hash`; ops-migrate test: legacy-stamp case asserts 0010 pending; fresh case asserts 11 files applied. Run: `vitest run apps/server/src/__tests__/ops-migrate` RED→GREEN.
- [ ] Step: dev db:push on `accessbase` dev db + scratch smoke (create db, apply 0010 via migrate.sh fresh, verify 11/11, drop). Commit-ready.

### Task A2: @accessbase/audit hashing core (pure)

- [ ] RED `hashing.test.ts`: canonicalJson order-independent (insertion-order-shuffled objects equal; nested arrays order-SENSITIVE; Date→ISO; number-vs-string distinct); rowHash stable over the spec D1 field set; merkleFold(root of N hashes) deterministic + single-leaf edge; receiptHash same concat semantics.
- [ ] GREEN `packages/audit/src/hashing.ts` (zero deps, crypto only) + export from index.
- [ ] RED→GREEN logger API change: delete `previousHash`/`hash` from types + logger (`verifyIntegrity` absent already — flows-verified); buffer path unchanged semantics; existing logger/storage tests adapt (report each adaptation). tsc both.

### Task A3: Write path seals rows

- [ ] RED app-level: build app (NODE_ENV!=test? use injected auditStorage spy OR set env per existing app-test pattern) → perform 2 audited requests → storage receives entries with `createdAt` ISO matching entry.timestamp and `rowHash === hashing.rowHash(entry)`; row lands with both columns.
- [ ] GREEN app.ts AuditStorage.write: add `createdAt: new Date(e.timestamp)`, `rowHash` (import hashing from @accessbase/audit — the SAME module the verifier uses). Identity package NOT touched.
- [ ] Check: async-buffer path still hashes AT INSERT inside storage (logger's computed hash removed per A2 — rowHash is storage's job now: single canonical call site).

### Task A4: Anchor worker + backfill + sweeper prune-mark + config/metrics

- [ ] RED audit-anchor unit (fake db handle scripted): first tick folds pending (hash NOT NULL, anchor_id NULL, older than grace) into root + anchor row (prev_root chain across ticks) + marks anchor_id SAME tx; try-xact-lock false → early return zero writes; empty pending → no anchor row; export path set → fs append `root` after insert (same tick).
- [ ] RED backfill: NULL row_hash legacy → oldest-first batches of 1000, hash over CURRENT columns, skips `erased_at NOT NULL`; second pass zero-work.
- [ ] RED sweeper: mark fully-expired anchors `pruned_at` in same tx BEFORE DELETE; crash-between simulation (mark throws after delete-prepared → nothing half-applied — assert single tx).
- [ ] GREEN wiring in app.ts inside the `nodeEnv!=='test'` gate (clone dispatcher lifecycle: start, stop→onClose); config 3 keys (`AUDIT_ANCHOR_INTERVAL_SECONDS|AUDIT_ANCHOR_GRACE_SECONDS|AUDIT_ANCHOR_EXPORT_PATH`) + .env.example; metrics 2 instruments + rules.yml 2 alerts (AccessbaseAuditAnchorStalled, keep file's not-wired note).

### Task A5: Erasure funnel + event + users route

- [ ] RED identity unit: eraseAuditData(txFake): receipt = receiptHash over ordered row_hashes of matched non-NULL-hash rows; UPDATE ALL matched rows (incl NULL-hash) per D4 column whitelist; ledger row counts rowsAffected + legacySkipped + events_scrubbed; `audit.erased` emitEvent on SAME handle; second erase of same subject = zero rows no-op.
- [ ] RED (U3): events matched `payload->>'id' = subject OR payload->>'email' = <email captured BEFORE scrub>` → tombstoned; delivery rows untouched; NOTE: auth.login.* payloads store email → capture subject email BEFORE the audit scrub (order matters — user row still present inside the delete tx? DELETE route cascade runs in routeTx — the users row exists when erase runs: capture there).
- [ ] GREEN UserManager + events union + DELETE /users/:id: body `eraseAudit?: true` + `legalBasis: string` (schema-declared!) → required-when-flag (400 else) → routeTx(erase → existing delete cascade). Emit order: audit.erased BEFORE user.deleted? spec silent — choose AFTER cascade-in-tx tail, document choice.
- [ ] Wire tests in users.test.ts; conflict-mapper untouched unless new throw tags (report).

### Task A6: /audit/verify + platform belt + UI

- [ ] RED service unit (scripted fakes): happy green report {chainOk:true, prunedFrom...}; tampered row (hash mismatch, no erasure) → firstFailure row-mismatch w/ id+day/seq; forged erased_at without ledger → orphan-erasure; backdated unanchored row past grace → unanchored; pruned anchors skipped + prunedFrom = min day; partial (rows>100k) flag.
- [ ] RED route: 403 TENANT_PLATFORM_ONLY for non-default belt (inline first-check pattern tenants.ts, message string `TENANT_PLATFORM_ONLY`), 200 + audit:read for default, malformed window 400, defaults last-30d, 90d cap.
- [ ] GREEN audit-verify.ts (reads anchors ordered day,seq; per anchor SELECT rows BY `anchor_id = X` membership — NULL-hash legacy rows inside an anchored range classify `pending-backfill`, NEVER row-mismatch (B1); recompute-vs-stored only for hashed rows; pruned path; watchdog count query); route GET /v1/audit/verify + routePermissions entry (audit:read — NO new code).
- [ ] B2 lock discipline: erasure routeTx FIRST statement `SELECT pg_try_advisory_xact_lock(727242)` — on false map to retryable 409 (same-key serialization with the anchor worker closes the 40P01 window); anchor worker catches 40P01 → skip tick, retry next interval, never crash.
- [ ] B3 redact: `legalbasis` added to packages/audit/src/types.ts redactor list (lowercase); eraseAuditData must not log legalBasis (docblock-enforced).
- [ ] B4 export hygiene: anchor tick re-appends anchors not yet in the export file (tail-check by day/seq) — crash-between-commit-and-append self-heals next tick; gap-free guarantee stated in module docblock.
- [ ] admin-ui: api/audit.ts verify() + Audit.tsx button (audit:read gate) → result Alert green/red with counts; en/zh keys parity; e2e audit-viewer extension: mock OK + FAIL payloads, button hidden for non-perm. Dedicated `remoteAddress` per PIT-083.

### Task A7: Docs wave

security.md §19.17 supersede sentence (prev-hash-in-row design → day-anchored roots; capability boundary verbatim from spec D7); self-service.md RTBF paragraph (90d retention + erasure receipts + 17(3)(e)); webhook.md event list += audit.erased; identity-sdd/audit-sdd header discharge lines; CHANGELOG.

### Task A8: Gates + live-fire + close-out (controller)

- [ ] Full vitest + 4×tsc + eslint + e2e chromium (workers=1; no backend on 5101; ≥ new baselines).
- [ ] LIVE-FIRE per spec §4 ledger: scratch PG → boot → actions → anchors ≤6min → curl verify chainOk:true → psql-tamper a row → verify false @ that id → erase user → verify true (+receipts) → shorten retention → sweep → verify true w/ prunedFrom. Record actuals; NOT-covered list explicit.
- [ ] Memory: status line, baselines flip, report discharge, PIT entry if new class found.

## Execution & parallelism

T-A1→A2→A3→A4→A5→A6 mostly serial (schema→hashing→write→anchor→erasure→verify stack on each other). A2∥A1 possible (hashing pure). A6 admin-ui part parallel with A5. Controller commits per task. Lane budget: ≤2 concurrent vitest runners (CPU).

## Known spec-inherited watchitems (do not "fix" silently — report if hit)

- jsonb `payload->>'id'` match on user.* events assumes subject id key 'id' — verified true for user.created/updated/suspended/deleted; auth.login.* carries email (matched separately). Non-user events with unrelated 'id' payloads MUST NOT match — predicate also requires `type LIKE 'user.%' OR type LIKE 'auth.login.%'` (add to funnel WHERE).
- `String(new Date(e.timestamp))` vs PG round-trip: store Date object, let pg serialize; compare in verify by recomputing over the STORED timestamptz's ISO form — writer and reader must agree on `toISOString()` formatting (writer computes hash from ISO of its own Date BEFORE insert; verifier recomputes from stored value's ISO — equal only if ms-precision round-trips: verify in A3 RED with a real-pg probe).
- Anchor fold order must equal verify re-fold order (`ORDER BY created_at, id` exact, both sides).

## Completion criteria

8 tasks committed; spec §4 T-matrix rows 1..11 all landed as named tests; live-fire ledger recorded; D126 gates + new baselines flipped in close-out commit; report discharge line added.

---

## Review record (2026-09-28)

- **Momus flows: OKAY** — 30+ file references verified (spec RATIFIED rev.3, chain 10 files→0010 11th, ops count matches, single-consumer breaking premise holds, audit:read reuse precedent `'GET:/api/v1/events'` exists verbatim). Non-blocking: authorize path drift → corrected in File-structure table (hooks/authorize.ts:29).
- **Momus blockers: APPROVE-WITH-FIXES** — all absorbed into task steps above: B1 MED (verify re-fold must key by anchor_id membership; NULL-hash rows classify pending-backfill, never row-mismatch — RED case added), B2 MED (erasure routeTx takes advisory 727242 first statement; 40P01 → retryable 409; worker catches and skips tick — deadlock window closed), B3 LOW (legalbasis into redactor list + no-logging docblock), B4 LOW (export self-heal tail-check), B5 = flows' path note (fixed). Verified clean: ms timestamptz round-trip (probe still mandated), erase-before-cascade ordering via UserManager.delete(db?) widening, tombstone predicate sufficient over all 16 payload shapes (double-protected: uuid global uniqueness + LIKE filter), drizzle 0.31 vocabulary (0009 bigserial + composite precedents), xact-lock rollback release, int8-as-string (Number() doctrine incl. anchor_id raw selects), sweeper mark-then-delete single-tx, D126 (TENANT_PLATFORM_ONLY row exists), SENTINELS/ops-flip/db:push trio.
