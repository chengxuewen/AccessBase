# Plan: 4A Compliance Batch — 2026-11-23 (rev.2 — panel-run-2 absorbed, P-3..P-8 ruled)

**Date:** 2026-11-23 · **Status:** PROPOSED rev.2 (panel run 2 BLOCK resolved by user rulings P-3..P-8; execution gated on explicit user go)
**Parents:** spec `specs/2026-11-23-4a-compliance-batch-design.md` (rev.4) · panel report `reports/2026-11-23-4a-compliance-panel-review.md` (runs 1+2) · D130 · adjudication record `plans/2026-11-23-4a-optimization-adjudications.md`
**rev.2 change log:** PC-1/PC-2/PC-3 CRITICALs + CONFLICT-3..7 resolved (P-3=B manager-funnel enqueue · P-4=A gap-aware cursor · P-5=A platform destinations · P-6=B staged low-lock seq · P-7=B prod fail-fast trustProxy · P-8=B SET NULL + dead-letter); PH-1..PH-9 + MEDIUM findings folded into tasks as binding requirements; test enumerations hardened per test-lens.

## 0. Decisions in force

Roadmap D130 (R1/R2/R3/R5/R7/R8) · D-2=A (decision in D1 hash) · D-4=B (/api/v1/authzen) · D-5=A (flat group names) · P-1=C (split transport) · P-2=B (dedicated SET key, same JWKS) · **P-3=B** (manager-funnel CAEP enqueue, emitEvent precedent) · **P-4=A** (gap-aware cursor, 10-min timeout skip) · **P-5=A** (platform-only export destinations; platform belt + `audit_export:write` + apikey deny; SSRF stack) · **P-6=B** (staged low-lock seq column) · **P-7=B** (prod fail-fast trustProxy boot hook) · **P-8=B** (clientId SET NULL + dead-letter + bounded retention).

Panel fact corrections (run 2, do NOT re-litigate): seq-vs-seq commit inversion is the fatal cursor hazard (PC-1) · SCIM disable = 3 call sites incl. 2 PATCH arms (PC-2) · export SELECT had no tenant predicate (PC-3, killed by P-5 construction) · `ADD COLUMN bigserial` = full rewrite + AEL (PH-6) · ALLOWED_SCOPES lacks 'groups' (PH-1) · retention sweeper hard-DELETEs (PH-3) · erasure misses caep_deliveries (PH-5) · routePermissions unmapped = passthrough; apikey '*' bypasses (sec M-2) · `?? ['*']` at authenticate (sec M-3) · Consent SCOPE_I18N lacks groups (sec M-4) · oidc-provider internals locally unverifiable until pnpm install (evid A4 — T5 gate).

---

## T0 — Migration 0014 (staged low-lock seq; blocks T1/T2/T4)

**Files:** `packages/identity/src/db/schema.ts`; hand-written seq section + drizzle-generated rest in `packages/migration/drizzle/0014_*.sql` (mixed authorship per 0006-0008 precedent; snapshot aligned); `scripts/migrate.sh`; `__tests__/ops-migrate.test.ts`.

**Steps:**
1. schema.ts: auditLogs += `decision jsonb NULL` + `seq bigint NOT NULL DEFAULT nextval('audit_logs_seq')` (schema expresses final state); oidcClients += caepEndpointUri; apiKeys += cidrAllowlist; NEW `caepDeliveries` (bigserial id · tenantId · `clientId uuid NULL` FK→oidc_clients **ON DELETE SET NULL** [P-8] · eventType · subjectId · jti unique · status/attempts/nextAttemptAt/lastError/responseStatus/deliveredAt · deadReason text · createdAt; partial index status='pending'); NEW `auditExportDestinations` (**platform-level [P-5]**: id · url · secretEncrypted (v2 envelope) · active · `lastDeliveredSeq bigint` · `skippedSeq bigint[]` [P-4 ledger] · timestamps; unique(url) host-normalized; NO tenantId FK).
2. 0014 SQL = metadata-only ALTERs (3 NULL columns) + 2 CREATE TABLE + **staged seq [P-6]**: `ADD COLUMN seq bigint NULL` → batch backfill via ctid cursor loop → `CREATE SEQUENCE audit_logs_seq OWNED BY audit_logs.seq` + setval(max+1) → `ALTER COLUMN seq SET DEFAULT nextval(...)` → `ADD CONSTRAINT chk NOT VALID` → `VALIDATE` → `SET NOT NULL`. Every step idempotent + resumable.
3. migrate.sh SENTINELS += six independent probe lines (per-line format; new-table probe = 0008 form).
4. ops-migrate.test.ts SAME commit: file count 14→15 · **table count 25→27 (:180 + titles :168,:258)** · 0014 sentinel-warn count 6.
5. Forward-only reversibility stated; lock posture: all steps second-level locks, no rewrite.

**RED:** ops-migrate (counts + sentinels); I: staged seq resumable at each step boundary; backfill leaves zero NULLs; SET NOT NULL succeeds after VALIDATE.

---

## T1 — CAEP/RISC SET push (P-1=C · P-2=B · **P-3=B manager-funnel** · P-8)

**Files:** `config.ts` (SET key pair, prod fail-fast, dev ephemeral); `oidc/provider.ts` (loadJwks publishes SET public JWK, distinct kid); NEW `utils/set-signer.ts`; NEW `utils/caep-dispatcher.ts` (own drainer, CTE FOR UPDATE SKIP LOCKED, dead-letter@10 + `deadReason`, null-clientId branch → immediate dead 'client deleted' [P-8]); **`packages/identity/src/managers/UserManager.ts`** (changeStatus suspend arm + delete: insert caep_deliveries on the SAME DbLike/tx handle — emitEvent precedent [P-3]); `routes/clients.ts` (caepEndpointUri create+edit, strict https both arms); admin-ui Clients field; undici connect-hook peer-IP re-check on the SET fetch.

**Binding semantics:** SET signed at delivery (fresh iat/exp; jti stable from row); `typ=secevent+jwt`, aud=client_id, exp≤300s, txn=row id, events map, sub_id iss_sub. Mapping: suspend/SCIM-any-arm → `risc:account-disabled`; delete → `risc:account-purged` (session-level awaits sid, ledger). Manager-funnel enqueue covers users routes + **both SCIM PATCH arms (scim.ts:623-626,704-708)** + SCIM DELETE + future paths by construction; same-tx enqueue (no crash window). Delivered/dead TTL cleanup scrubs subjectId (PH-5: delivered+90d/dead+90d rows deleted or subjectId-nulled; pending rows deliver then age out; legal-basis window documented). Independent of webhook kill-switch/prune. Tenant-suspend cascade → disclosure in T6 (ledger for events).

**RED:** U: SET profile (typ/aud/exp/txn/**sub_id/events**/jti); **P-2 wire proof: jwtVerify via JWKS kid pubkey + `/.well-known/jwks.json` contains BOTH kids**; https reject create+edit. I (real PG): suspend via **each of the 5 funnel sites** (users PATCH/DELETE, SCIM PATCH×2, SCIM DELETE) → caep_deliveries row + **webhook_deliveries stays EMPTY (mechanism-independence, dual-table assertion)**; kill-switch off still delivers; **age-prune-replayed old rows still deliver**; **concurrent claim → no double delivery**; forced retry keeps jti; dead-letter@10 + null-clientId dead; rebinding URL refused at connect (controllable-DNS fake).

---

## T2 — Audit Decision + gap-aware cursor export (D-2=A · **P-4=A** · **P-5=A**)

**Files:** `packages/audit` (types += identifier-free `decision:{decision,matchedCode,scope?}` — schema-rejects extras incl. the spec's stray `via` [evid A6]; hashing += decision, null→undefined INSIDE rowHash; middleware reads stash); `utils/permission.ts` (stash on JWT allow+deny AND apikey allow AND **apikey deny PERM_003 arm** [PH-9]); `app.ts` (seal passes decision; insert mapping carries decision — necessary so backfill hashes it [evid L-2]); `utils/audit-anchor.ts` (backfill SQL += decision — UPDATE block audit-anchor.ts:167-183 [evid A5]); `utils/audit-verify.ts` (`decision ?? undefined` + NULL-decision post-migration heuristic warn); NEW `utils/audit-exporter.ts`; NEW `routes/audit-export-destinations.ts`.

**Binding semantics:**
- Platform-only destinations [P-5]: CRUD gated by **platform belt + NEW write-level code `audit_export:write`** in routePermissions + **apikey lane hard-denied** (carve-out) + url change re-SSRF; secret one-time reveal (webhook precedent).
- **Gap-aware cursor [P-4]:** per tick `seq > lastDeliveredSeq ORDER BY seq LIMIT batch`; advance ONLY through the first gap (max contiguous seq); gap persisting >10 min → loud log + append seq to `skippedSeq` + advance past. `SET lastDeliveredSeq = GREATEST(...)` monotonic guard; per-destination claim (SKIP LOCKED or single-flight) — no regression, no double-send (sec M-1). Export failure backoff + dead-letter semantics aligned to webhook precedent.
- **SSRF stack [PH-4/P-5]:** destination URL → webhook-url guard + connect-hook peer re-check + `redirect:'manual'` + https strict; rebinding RED.
- Payload: `{schemaVersion:1, destinationId, watermarkSeq, timestamp, rows:[...]}` **HMAC over the full envelope** [sec L-1]; rows = OCSF-aligned, `actor:{user_id}` ONLY (**no email — no source column** [PH-2]); erased rows exported in scrubbed form with `erased:true` marker (receivers warned pre-erasure copies may exist) [PH-2]; new destination initializes `lastDeliveredSeq = current max(seq)` (no history replay in arbitrary order; history export = explicit opt-in, documented) [PH-3]; retention interplay documented (export best-effort within retention window; destination-down > retention = documented loss).
- D-2 ripple: hashing + seal + insert + backfill + verifier + types, all identical normalization; type bans null.
- Write-amplification load check (named vehicle: scratch-DB bench script).

**RED:** U: identifier-free shape; decision changes rowHash; **legacy NULL-decision invariance via old/new pick**; seal-null vs verifier-undefined parity; stash on all four arms (JWT allow/deny, apikey allow/deny). I: backfill+insert carry decision; **fatal-inversion recovery: seq=100 slow-commit delivered after 101 seen** (cursor held at gap); rollback-hole timeout skip + skippedSeq ledger; GREATEST no-regression; concurrent exporters no double-send; HMAC envelope verified at sink; erased-row marker; new-destination starts at max(seq).

**Checkpoint B battery (executable [test H5]):** scratch DB → pre-0014 snapshot rows (NULL decision, row_hash via OLD pick) → apply 0014 → run anchor backfill → `/audit-logs/verify` window covering legacy rows returns chainOk:true and zero row-mismatch → scripted as ops-style test (commands + green criteria in-file).

---

## T3 — AuthZEN PDP (D-4=B · PH-9 fixes)

**Files:** NEW `routes/authzen.ts`; NEW `utils/authzen-resolve.ts`; reality-catalog rows; integration.md boundary.

**Binding semantics:** plugin-local gate reads `request.user.scopes` **only when `type==='apikey'`** (JWT lane: defined ruling — JWT callers denied 403 per SCIM precedent, or documented admin-only; default **403 for JWT lane**, 401 for missing bearer, 403 for insufficient scope — matches scim.ts:252-259); **gate treats missing scopes as deny (fix `?? ['*']` at THIS gate — do not touch authenticate [sec M-3])**; '*' keys documented as retaining access + discovery discloses; per-key rate limit **numbers land here** (default e.g. 120/min per key) + batch hard cap 50 → 400. Resolution: subject-exists-in-tenant → catalog whitelist (reject ':') → hasPermission → getUserDataScope null→**false** → isWithinScope subject-bound; BAN data-scope.ts fail-soft arm (module-shape lint/test). **PDP handler stashes decision itself** (JWT-free lane: `{decision, matchedCode:'authzen:evaluate'}`-shaped, identifier-free) so every evaluation audit row carries decision [PH-9]. X-Request-ID all responses; freshness note in discovery.

**RED:** U: unknown subject/code/':'/cross-tenant → false; JWT-lane 403; scope-missing deny; batch cap 400; **per-key rate-limit test (2 keys, independent buckets)**; **per-evaluation audit row with decision non-null**; discovery shape + freshness field. I: real-PG tenant matrix; platform-code false for non-default key. **Interop vectors: run official suite if available after `pnpm install`; else wire-shape assertions tagged 'interop-pending'** [test M4].

---

## T4 — Per-key CIDR (R5 · **P-7=B**)

**Files:** `routes/api-keys.ts` (CIDR validation at CRUD; `[]` rejected 400; null=unrestricted); NEW `utils/apikey-cidr.ts` (v4-mapped normalize then match); `app.ts` authenticate branch + `scim.ts` preHandler (both lanes); **NEW post-migration boot hook** [P-7]: prod && TRUST_PROXY boolean-true && any key has non-empty allowlist → **throw** (dev: WARN); admin-ui API keys field; manual audit emit for GET-lane denials.

**RED:** U: v4-mapped matches; `[]`/malformed rejected; null unrestricted. I: both lanes blocked from non-allowlisted IP; **prod boot-refusal RED (env matrix: prod+allowlist+bool-trustProxy → process throws)**; dev WARN file.

---

## T5 — Groups claim (D-5=A · PH-1 · sec M-4 · evid A4 gate)

**Files:** `GroupManager.ts` += getGroupNamesForUser (dual-table tenant predicate, no kind filter); `oidc/adapter.ts` (GetUserFn returns tenantId; `claims(use, scope)` — groups only when `scope?.includes('groups')`); `oidc/provider.ts` claims config += `groups:['groups']`; **`routes/clients.ts` ALLOWED_SCOPES += 'groups'** [PH-1] (per-client opt-in = client's own scope string, enforced by provider — verify post-install); `app.ts` getUser wiring (tenantId thread); **`apps/admin-ui/src/components/Consent.tsx` SCOPE_I18N += 'groups' + en/zh i18n `scope.groups`** [sec M-4]; claim cap 50 + deterministic sort + `groups_truncated:true` (oauth2-proxy truncation caveat documented); integration.md oauth2-proxy reference + hardening checklist.

**GATE [evid A4]:** `pnpm install` FIRST; verify oidc-provider scope-⊆-client enforcement from node_modules source before sign-off.
**RED:** U: tenant-confined; scope-gated (absent without scope); **negative: client WITHOUT groups in scope requesting groups → rejected/no claim**; cap + deterministic truncation marker; consent renders groups label. I (inject round): authorize with groups scope → id_token/userinfo carry groups; without → absent.

---

## T6 — Docs & reconciliation

integration.md (oauth2-proxy/AuthZEN/CAEP/destinations consumer guides incl. tenant-cascade CAEP disclosure [corr M-5] + dedup/ordering contract) · security.md (SET receiver checklist; PDP boundary; **trustProxy hard precondition + boot-refusal runbook** [P-7]; export HMAC envelope + erasure/retention semantics) · webhook.md (schemaVersion scope) · citation fixes (evid A5/A6, F-19/F-20/F-22/F-26/F-29) · reality catalog += APIKEY_IP_001/AUTHZEN family/export codes · CHANGELOG · Implementation status headers (D126 gate) · e2e mock roster updates for new fields (Clients/ApiKeys/destinations) [test M1].

---

## Execution order & checkpoints

```
T0 ──┬─▶ T1 ────────────────┐
     ├─▶ T2 ─▶ T3 ──────────┤
     └─▶ T4 ────────────────┼─▶ T6 ─▶ 终审 wave ─▶ baselines flip
T5 (parallel; pnpm-install gate first) ─┘
```
- Per task: RED → implement → review → fix-round → scoped re-review.
- **Checkpoint A (after T0):** eyeball 0014 (staged seq SQL + snapshot parity); destinations/caep table final columns.
- **Checkpoint B (after T2, before T3):** scripted hash-invariance battery (defined in T2) green on real PG.
- app.ts serialized merges (T1/T2/T3/T4). Orphaned-suite enumeration: hashing.test 11→12 field loop; verify/seal/anchor/logger ripple listed in T2 fix-round [test M2].

## Global gates

Full vitest (PG-up) · 4×tsc · eslint touched-files 0-new · e2e chromium (**+ destinations CRUD/secret-reveal spec** [test H6]) · live-fire (T0 migrate staged-seq; T1 delivery batteries; T2 invariance+exporter) · coverage floors (new modules ≥87% server zone same-commit [test lens]) · no `as any` · secrets env-only. Baselines flip same-commit (ADJ-7h).

## Ledger / deferred (explicit)

Session-level `caep:session-revoked` (sid round-trip) · tenant-suspend cascade CAEP events (disclosure only, T6) · per-tenant export destinations (first multi-tenant SaaS customer) · erasure notification on export channel · history-export opt-in · syslog/OTLP sinks · AuthZEN search · SCIM ETag (R4 separate) · SAML IdP (R6 sales-gated) · ReBAC/mTLS/Kerberos/CAS/full-OCSF.

## Finding disposition (panel run 2)

PC-1→P-4=A · PC-2→P-3=B · PC-3→P-5=A · PH-1→T5 files · PH-2→T2 semantics · PH-3→T2 semantics · PH-4→P-5/T2 SSRF stack · PH-5→T1 TTL+scrub · PH-6→P-6=B · PH-7→T0 ops-migrate · PH-8→per-task RED hardening · PH-9→T3 gate/stash · CONFLICT-3→P-7=B · CONFLICT-4→P-8=B · sec M-1..M-5, L-1..L-4, evid A4..A6, test M1..M6, corr M-4/M-5, migration LOWs → folded above. NO code landed.