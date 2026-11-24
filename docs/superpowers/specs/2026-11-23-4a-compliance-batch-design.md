# 4A Compliance Batch — Design Spec (rev.4 — panel run 2 absorbed; P-3..P-8 ruled; plan rev.2 = execution authority)

Date: 2026-11-23 · Ladder: post-verification-day · Origin: D130 rulings 1/2/3/5/7 + ruling 8 constraint on T2.
Adjudication record: `docs/superpowers/plans/2026-11-23-4a-optimization-adjudications.md`.
Panel report: `docs/superpowers/reports/2026-11-23-4a-compliance-panel-review.md` (4 roles, Deep gate, verdict BLOCK as rev.2).

**rev.3 change log:** Expert panel (correctness/evidence/security/migration) falsified the rev.2 transport premise. Two conflict items re-ruled by user: **P-1=C** (split transport: CAEP delivery table + audit cursor-exporter with a monotonic seq column; D-1/D-6 reopened) and **P-2=B** (dedicated SET signing key + distinct kid in the SAME JWKS; revises D-3=A). False facts corrected (F-02 seal/backfill, F-19 CIDR-not-shared, F-20 sentinel/ops citation, F-22 middleware/scope-gate). Stale "open" markers cleared (F-21). Panel HIGH/MEDIUM/LOW findings folded into §3 as binding design requirements.

**rev.4 change log:** Panel run 2 (5 roles) reviewed the execution plan — verdict BLOCK (PC-1/PC-2/PC-3 + CONFLICT-3..7). User adjudicated: **P-3=B** manager-funnel CAEP enqueue (emitEvent precedent; covers both SCIM PATCH arms + all future paths; §3 T1's route-layer wording SUPERSEDED) · **P-4=A** gap-aware export cursor (advance through contiguous seq only; 10-min gap timeout + skippedSeq ledger; supersedes plain seq-cursor wording in §3 T2) · **P-5=A** platform-only export destinations (NO tenantId FK; platform belt + `audit_export:write`; supersedes §3 T0 destinations shape) · **P-6=B** staged low-lock seq column (supersedes the bigserial ADD COLUMN implication) · **P-7=B** prod fail-fast trustProxy boot hook · **P-8=B** caep_deliveries.clientId SET NULL + dead-letter (supersedes CASCADE). PH-1..PH-9 + MEDIUMs folded as binding requirements. Where this spec's §3 conflicts with plan rev.2, **plan rev.2 governs** (`plans/2026-11-23-4a-compliance-batch.md`).

**Status: panel run 2 resolved; rulings P-1..P-8 in force; execution gated on explicit user go.** NO code landed.

## 0. Rulings

### 0.1 Roadmap (D130, ratified)
R1 CAEP/RISC SET push · R2 audit schemaVersion + Decision + real-time export · R3 minimal AuthZEN PDP · R5 per-key CIDR · R7 groups claim + oauth2-proxy · R8 OCSF-aligned naming (constraint on T2). OUT: R4 SCIM ETag (separate batch), R6 SAML IdP (sales-gated), ReBAC/mTLS/Kerberos/CAS/full-OCSF (deferred).

### 0.2 Design questions (ratified 2026-11-23)
D-2=A (decision in D1 hash via null→undefined) · D-4=B (AuthZEN under /api/v1/authzen) · D-5=A (flat group-name array, all kinds). **D-1, D-3, D-6 SUPERSEDED by panel re-rulings below.**

### 0.3 Panel re-rulings (ratified 2026-11-23, conflict items)
- **P-1=C (supersedes D-1=B transport + D-6=A scope):** split transport. CAEP (low-frequency) → a dedicated `caep_deliveries` table (ordered, retry/dead-letter), independent of the webhook kill-switch and age-prune. Audit (high-frequency) → cursor-exporter over `audit_logs` with a NEW monotonic `seq` bigserial column + a cursor-state record; zero double-write. Shared retry/SSRF primitives only; the spec-locked webhook engine is NOT touched. Migration scope reopened (more objects than "three ALTERs").
- **P-2=B (supersedes D-3=A):** dedicated SET private key + distinct `kid`, public part published in the SAME JWKS via loadJwks multi-key. Isolates the event-signing blast radius from auth-JWT/id_token signing. Receivers fetch one JWKS, verify by kid.

## 1. Scope

IN: migration (audit_logs.decision + audit_logs.seq; oidc_clients.caep_endpoint_uri; api_keys.cidr_allowlist; caep_deliveries table; audit_export_cursor state); dedicated SET key config + signer; CAEP emission + independent delivery; audit cursor-exporter + Decision wiring + export HMAC; AuthZEN evaluation/evaluations/discovery + plugin-local scope; per-key CIDR (authenticate + SCIM lanes) + trustProxy precondition; groups claim (tenant-correct projection) + per-client scope opt-in + claim cap + oauth2-proxy reference; docs wave.

OUT (ledger): full SSF management API + CAEP receiver; syslog/CEF/OTLP sinks; AuthZEN search; SCIM ETag (R4 separate); SAML IdP (R6); ReBAC/mTLS/Kerberos/CAS/full-OCSF.

## 2. Interface facts (CORRECTED per panel, verified 2026-11-23)

| Fact | Evidence |
| ---- | -------- |
| Chain head 0013 (14 files); SENTINELS array at migrate.sh:**109-122** (0013 dual sentinels :120-121); ops file-count assertions live in **ops-migrate.test.ts:183,220,254,273** (toHaveLength(14)), NOT migrate.sh (dynamic count) | `scripts/migrate.sh:109-122`; `apps/server/src/__tests__/ops-migrate.test.ts` |
| **[F-02 CORRECTION]** Default drizzle insert mapping does NOT carry rowHash/createdAt — the seal wrapper output is DROPPED on the default path; production rows are hashed by the anchor BACKFILL. The "seal at storage boundary" claim was mis-evidenced. D-2 must update insert mapping + backfill SQL field set, not just seal/verifier | `apps/server/src/app.ts:540-551` (insert), `:56-82` (seal); `apps/server/src/utils/audit-anchor.ts:154-157` (backfill); `audit-verify.ts:180-183` (NULL=pending) |
| D1 row-hash field set EXACTLY {tenantId,userId,action,resourceType,resourceId,requestBody,responseStatus,requestId,ip,userAgent,createdAt}; canonicalJson drops undefined / keeps null; explicit pick | `packages/audit/src/hashing.ts:14-26,39-50,56-72` |
| `responseStatus ?? undefined` convention at verifier; seal passes responseStatus BARE (null-vs-undefined divergence risk for decision) | `audit-verify.ts:193`; `app.ts:72` |
| audit_logs.id is a RANDOM UUID (no monotonic column); createdAt non-unique → cursor needs a new seq column | `schema.ts:197` |
| webhook_deliveries.endpoint_id NOT NULL FK→webhook_endpoints; eventId NOT NULL FK→events.id (cascade); fanout JOINs only webhook_endpoints; body {id,type,createdAt,data}+HMAC; claim CTE spec-locked | `schema.ts:583-601`; `webhook-dispatcher.ts:109-119,126-132,256-275` |
| webhook kill-switch (webhooks_enabled=false → tick returns) + 7-day age-prune cascade → CAEP must be independent | `webhook-dispatcher.ts:201,134,194`; `app.ts:390-398` |
| **[F-19 CORRECTION]** utils/cidr.ts is NOT shared with the webhook SSRF guard. webhook-url.ts is a SEPARATE fail-CLOSED impl ("this is NOT utils/cidr.ts"); cidr.ts is fail-open per entry, imported only by routes/auth/shared.ts. AUTH_IP_002 at shared.ts:123 | `utils/webhook-url.ts:4-8`; `utils/cidr.ts:3-16`; `routes/auth/shared.ts:12,123` |
| webhook-url SSRF has a self-acknowledged DNS-rebinding TOCTOU window (deferred, unfixed); dispatcher resolves once then fetch re-resolves, no IP pin | `webhook-url.ts:18-21,28-29`; `webhook-dispatcher.ts:242,267` |
| **[F-22 CORRECTION]** Audit middleware = onResponse on ALL non-GET/HEAD (NO /api/v1 prefix filter), exclusion list only. requirePermission has 3 denial paths (PERM_001 warn / PERM_002 warn / PERM_003 no-warn). apikey scope gate is `includes('*')` ONLY — route-specific matching is a NEW mechanism | `app.ts:570-590`; `utils/permission.ts:30-76` |
| SCIM uses ab_ keys via its OWN preHandler ("never app.authenticate") → CIDR check at authenticate is bypassed via SCIM | `routes/scim.ts:236-256`; `app.ts:608` |
| TRUST_PROXY boolean → Fastify trustProxy:true trusts whole XFF chain → request.ip client-supplied | `config.ts:157`; `app.ts:90-96` |
| api_keys NO IP column; audit_logs NO decision column; oidc_clients NO caep column | `schema.ts:477-495,194-220,342-358` |
| OIDC claims profile/email only, no groups; findAccount GetUserFn=(id) only, getUser query takes name/email NOT tenantId | `oidc/provider.ts:193-196`; `oidc/adapter.ts:27,182-194`; `app.ts:325-333` |
| loadJwks: primary private key + extra PUBLIC keys (Q3C); multi-key publication exists; same key signs access JWT | `oidc/provider.ts:45-96,77-94`; `app.ts:192-196` |
| data-scope resolveUserRowScope is CALLER-bound + fail-SOFT (null→tenant-wide all); apikey→all. AuthZEN needs SUBJECT-bound + fail-CLOSED | `utils/data-scope.ts:48,52-57`; `PermissionManager.ts:205-215` |
| GroupManager.getDepartmentIdsForUser (kind filter, dual-table tenant predicate); no user→group-names method; groups.name unique per tenant | `GroupManager.ts:130-144`; `schema.ts:379` |
| Erasure scrub whitelist clears requestBody/userId/ip/userAgent; mention predicate scans ONLY requestBody | `UserManager.ts:409-419,365-368` |
| clients ALLOWED_SCOPES is GLOBAL (not per-client); backchannel create arm ^https?:// vs edit arm https (inconsistent) | `routes/clients.ts:19,114-117,318` |
| interaction mount moved to /api/v1/oidc (host-root unreachable in dev proxy/deploy — P1 precedent) | `app.ts:623-630` |

## 3. Design (panel requirements BINDING)

### T0 — Migration (scope reopened by P-1)

- `audit_logs.decision JSONB NULL` (identifier-free shape, see T2) + `audit_logs.seq BIGSERIAL` (monotonic cursor key; F-03).
- `oidc_clients.caep_endpoint_uri TEXT NULL`; `api_keys.cidr_allowlist JSONB NULL`.
- NEW `caep_deliveries` table (bigserial id ordered; tenantId; clientId FK→oidc_clients; setJti; payload/SET; status/attempts/nextAttemptAt/lastError/deliveredAt; dead-letter) — independent of webhook_deliveries FKs (F-01).
- NEW `audit_export_cursor` state (per-destination last-delivered seq + receiver registry) OR exported-marker; shape finalized at re-review (F-03).
- SENTINELS: TEXT probe→0006 precedent (migrate.sh:112), JSONB→0012 jwks (:119), audit_logs col→0010 row_hash (:116), new tables→0008/0009 precedent; ops-migrate.test.ts 14→N updated SAME commit (F-20).
- Reversibility: NULL-additive ALTERs metadata-only (safe on large audit_logs); chain forward-only (migrate.sh:64, D124) → rollback = new forward migration (F-27, state it).
- Granularity: one multi-object migration vs split (columns vs new tables) — re-review detail; D-6=A "three ALTERs" is VOID.

### T1 — CAEP/RISC SET push (R1, P-1=C, P-2=B)

- **Dedicated SET key (P-2=B):** separate private key file + config; loadJwks publishes its public JWK with distinct kid in the same JWKS; SET signer uses it. Rotation procedure covers the second key.
- **SET profile (F-09):** `typ=secevent+jwt`, `iss`=OIDC issuer, `aud`=target client_id, short `exp`, `txn`, `jti` persisted on the delivery row (retry reuses jti; at-least-once). CAEP `session-revoked` vs RISC `account-disabled`/`account-purged`; subject semantics resolved (account-level events use RISC account subject; session-revoked requires sid — if absent, emit account-disabled rather than a malformed session-revoked; M2).
- **Independent delivery (P-1=C, F-08):** caep_deliveries drainer, NOT the webhook dispatcher; unaffected by webhooks_enabled kill-switch and age-prune; own dead-letter.
- **SSRF (F-05):** caep_endpoint_uri validated by webhook-url guard AND an undici connect-hook re-check of the actual peer IP (close the rebinding TOCTOU) — or resolve-once + connect-by-IP. https enforced on create+edit (F-14).
- Emission at UserManager suspend/delete + SCIM DELETE funnels (verified true).

### T2 — Audit schemaVersion + Decision + cursor-export (R2 + R8, P-1=C)

- **Decision shape IDENTIFIER-FREE (F-06):** `{decision:'allow'|'deny', matchedCode, scope?}` — stash-point schema rejects extra fields (no subject/resource UUIDs) so erasure mention-predicate/scrub need no extension; RED test asserts post-erasure decision intact + identifier-free.
- **Decision in D1 hash (D-2=A) with FULL ripple (F-02):** hashing.ts field set + pick; seal wrapper; **default insert mapping (app.ts:540-551)**; **anchor backfill SQL (audit-anchor.ts:154-157)**; verifier (audit-verify.ts:186-198); types; tests. ALL hash points normalize decision identically (null→undefined; type-layer bans null; F-11/L4). Legacy NULL-decision rows hash unchanged — RED-lock invariance.
- **Pre-seal completeness (F-11):** apikey allow arm records `{decision:'allow', via:'apikey-scope'}`; verifier heuristic warns on post-migration gated-route NULL-decision rows.
- **Cursor-exporter (P-1=C, F-03):** export by monotonic `seq` (not createdAt); cursor-state advances only on delivered; at-least-once; independent of webhook kill-switch/prune.
- **Export authentication (F-12):** per-receiver HMAC secret (webhook precedent); rowHash is chain provenance ONLY, not transport auth.
- **schemaVersion on the EXPORT payload (F-10):** NOT the webhook dispatcher body (D-1=B export bypasses dispatcher; changing webhook body breaks existing consumers). OCSF-aligned naming (R8): actor.user / src_endpoint.ip / activity / result; raw row retained.
- **Erasure ordering (F-13):** define export-vs-erasure ordering + receiver-deletion story (compliance batch must not leak PII pre-erasure).

### T3 — Minimal AuthZEN PDP (R3, D-4=B)

- Plugin at `/api/v1/authzen`, exposing `/access/v1/evaluation`, `/access/v1/evaluations`, `/.well-known/authzen-configuration` (discovery advertises full URLs).
- **SUBJECT-bound + fail-CLOSED (F-07):** dedicated resolution path; getUserDataScope(subject, code, key.tenantId) null→false; verify subject tenant membership first; **ban importing data-scope.ts fail-soft arm**; unknown subject/code→false. resource.type+action.name→code via catalog whitelist (reject ':' in inputs; S3-3).
- **Plugin-local scope (F-07):** `authzen:evaluate` accepted ONLY inside the authzen plugin (SCIM precedent scim.ts:236-256), NOT a global scope→route map; existing '*' keys retain access (documented); key minting must write scopes explicitly (NULL ?? ['*'] trap).
- **Rate-limit + batch cap (F-15):** per-key limit + batch hard cap (413/400); write-amplification load test; disclose ≤30s cache freshness in discovery/doc.
- Every evaluation audited (identifier-free decision, T2 synergy); batch audit granularity manual (F-23); X-Request-ID echoed.
- Capability boundary doc: code-level + users-row-level, NOT per-resource-instance.

### T4 — Per-key CIDR (R5)

- api_keys.cidr_allowlist; check request.ip via cidr.ts in BOTH authenticate apikey branch AND the SCIM preHandler lane (F-04).
- **trustProxy precondition (F-04):** TRUST_PROXY must be hop-count or explicit trusted-proxy CIDR (not boolean true) for CIDR to be meaningful; elevate from caveat to hard precondition; document.
- **[] vs null (F-16):** CRUD rejects empty array (400) or defines deny-all; do NOT route through cidrVerdict empty=disabled semantics. null=unrestricted (backward compat).
- **v4-mapped normalization (F-16):** expand ::ffff:x.y.z.w before matching (webhook-url.ts:116-121 precedent); test matrix covers mapped form.
- CRUD validates CIDR at write; denials audited (note GET denials not audited by middleware — F-24, emit manually if required).

### T5 — Groups claim + oauth2-proxy (R7, D-5=A)

- New `getGroupNamesForUser(userId, tenantId)` (dual-table tenant predicate, getDepartmentIdsForUser precedent minus kind filter); flat names, all kinds.
- **tenantId source (F-17):** getUser query takes users.tenantId in the SAME query; thread through GetUserFn + claims() (three seams: adapter.ts:27,187; app.ts:325-333); never DEFAULT_TENANT.
- **Per-client scope opt-in + claim cap (F-18):** groups scope per-client registration whitelist (not global ALLOWED_SCOPES); consent disclosure; claim hard cap (e.g. 50) + overflow marker.
- oauth2-proxy reference config + hardening checklist (strip headers + edge clears; --reverse-proxy + narrow --trusted-proxy-ip; --trusted-ip bypass, forbid direct connect).

### T6 — Docs & fact reconciliation

- Fix spec/record citations (F-19/F-20/F-22/F-26/F-29); integration.md (oauth2-proxy + AuthZEN + CAEP), security.md (SET receiver checklist, capability boundary, trustProxy precondition), webhook.md (schemaVersion scope clarification). Implementation status headers (D126).

## 4. Test plan (AAA; mock-first + real-PG; panel RED locks)

- T0: migrate.sh fresh+idempotent live-fire; SENTINELS probes (correct precedents); ops-migrate.test.ts count updated; seq monotonicity.
- T1: SET claims/signature (typ/aud/exp/txn/jti, verify by kid against JWKS); dedicated-key isolation; jti reuse on retry; independent of kill-switch/prune; SSRF IP-pin rebinding RED; https enforcement; funnel emission spy-count.
- T2: **legacy NULL-decision hash invariance RED** (all hash points incl backfill); decision identifier-free + post-erasure intact RED; pre-seal apikey decision recorded; cursor by seq no-drop (commit-order inversion case); export HMAC; schemaVersion on export not webhook body.
- T3: subject-bound fail-closed (unknown subject→false, NOT fail-soft); plugin-local scope (wrong scope→401/403, '*' documented); tenant confinement; batch cap; X-Request-ID; per-evaluation audit; code whitelist rejects ':'.
- T4: CIDR matrix incl v4-mapped; [] rejected; null unrestricted; SCIM lane covered; trustProxy spoof RED.
- T5: groups tenant-correct (no DEFAULT_TENANT); per-client scope opt-in; claim cap overflow; oauth2-proxy groups no-browser round.
- Gates: full vitest + 4×tsc + eslint touched-files + e2e (Clients CAEP / API keys CIDR UI) + live-fire. Baselines flip at landing, never copied.

## 5. Design questions — RESOLVED + panel re-rulings

D-2=A · D-4=B · D-5=A (ratified). D-1/D-3/D-6 SUPERSEDED: **P-1=C** (split transport + seq cursor + reopened migration), **P-2=B** (dedicated SET key, same JWKS). Remaining implementation details for re-review: caep_deliveries exact columns; audit_export_cursor shape (state row vs exported marker); migration granularity (one multi-object vs split); SET session-subject vs account-subject mapping; export-vs-erasure ordering.

## 6. Risks (panel)

- Transport premise falsified (F-01/F-03) → resolved by P-1=C; migration scope larger than rev.2 claimed.
- Seal/backfill truth (F-02) → D-2 ripple MUST include insert mapping + backfill SQL or silent tamper-evidence break.
- SSRF rebinding (F-05), TRUST_PROXY spoof (F-04), fail-soft pollution (F-07), erasure residue (F-06) → binding design constraints, RED-locked.
- Write amplification (audit export + PDP batch) → load test; audit not sampled.
- Mock-blindness (PIT-080/086) → no-browser inject rounds + real-PG integration are the net.

## 7. Ledger / execution discipline

- NO code landed. Implementation only on explicit user direction after scoped re-review of rev.3.
- Order: T0 → (T1∥T2) → (T3∥T4∥T5) → T6. Soft coupling: T3 audit-row decision shape depends on T2 (F-28); T1/T2/T3/T4 all touch app.ts → merge-order discipline.
- R4 SCIM ETag / R6 SAML IdP OUT of this batch.
- Baselines re-measured at landing; docs carry Implementation status headers (D126).