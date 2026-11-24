# Expert Panel Review — 4A Compliance Batch Spec rev.2

**Date:** 2026-11-23 · **Artifact:** `docs/superpowers/specs/2026-11-23-4a-compliance-batch-design.md` (rev.2)
**Gate:** Deep (architecture-level + security-critical) — 4 roles, 2 fixed core + 2 mounted lenses.
**Track:** parallel isolated subagents (each received ONLY the spec + its adversarial brief; no cross-role leakage).
**Method:** expert-panel-review; merge once, grade CRITICAL→LOW, disagreements PRESERVED (no majority smoothing).

## Roles

| Role | Agent | Lens |
| ---- | ----- | ---- |
| Correctness officer | code-reviewer | falsify the design |
| Evidence officer | evidence-critic | verify every file:line anchor |
| Security lens | identity-security | security-hardening |
| Migration/dependency lens | db-migrations | doc-audit-style (numbering, cross-refs, dependency graph) |

## Verdict

**BLOCK as approved.** The cryptographic/schema anchors are solid (D-2 hash invariance, FK facts, claims mapping, chain head all verified true), but the approved transport rulings **D-1=B and D-6=A rest on a false premise**: the existing webhook dispatcher cannot carry CAEP SETs or audit export without new schema objects and engine changes that exceed the ratified "three ALTERs" migration scope. Two conflict items are preserved for user adjudication. The plan document must NOT be written until the pivotal transport architecture is re-ruled.

## Merged findings (graded, deduped)

### CRITICAL

- **F-01 [correctness] — CAEP cannot ride the existing dispatcher; conflicts with D-1=B / D-6=A.** `webhook_deliveries.endpoint_id` is a NOT NULL FK to `webhook_endpoints` (schema.ts:590-592); CAEP destination lives in `oidc_clients.caep_endpoint_uri`. Fanout SQL JOINs only `webhook_endpoints` (webhook-dispatcher.ts:126-132); body hardcoded `{id,type,createdAt,data}`+HMAC (:256-275); claim CTE spec-locked (:109-119). SET needs a JWT body, `application/secevent+jwt`, per-client `aud`. A shadow webhook endpoint is actively harmful (secret_encrypted NOT NULL :565, unique(tenantId,url) :574, fanout sends ALL subscribed events as generic JSON). Requires a new delivery table or engine generalization → exceeds D-6 "three ALTERs". **Task graph not orderable as approved: T0 content depends on the un-ruled T1 mechanism.**

### HIGH

- **F-02 [correctness] — T2 seal fact wrong; D-2 ripple list incomplete.** Default drizzle insert mapping (app.ts:540-551) does NOT carry rowHash/createdAt — the seal wrapper output (app.ts:56-82) is dropped; production rows are hashed by the anchor backfill (audit-anchor.ts:154-157; audit-verify.ts:180-183 treats NULL as pending-backfill, masking the gap). D-2 ripple "hashing+seal+verifier+types+tests" MISSES the insert mapping + backfill SQL field set. If verifier includes decision but backfill does not → every row row-mismatch post-migration. spec §2 "seal at storage boundary" is mis-evidenced.
- **F-03 [correctness] — cursor-exporter has no orderable cursor; conflicts with D-6=A.** `audit_logs.id` is a random UUID (schema.ts:197); createdAt non-unique + commit-order can invert vs timestamp order → `createdAt > cursor` drops rows. Export-state options (exported_at per-row UPDATE = write amplification + races with anchor/erasure; cursor table/seq column = new schema object) both exceed "three ALTERs". "The audit table IS the durable queue" lacks a dequeue key.
- **F-04 [correctness+security] — per-key CIDR defeated two ways.** (a) SCIM uses the same ab_ keys but its own preHandler (scim.ts:236-256, "never app.authenticate" app.ts:608) → a CIDR check at app.ts:214-231 is bypassed via /api/v1/scim/v2/*. (b) TRUST_PROXY=true → Fastify trustProxy:true trusts the whole XFF chain (app.ts:90-96, config.ts:157) → request.ip is client-supplied → spoof an allowlisted IP. Fix: trustProxy must be hop-count or explicit trusted-proxy CIDR; T4 precondition, not caveat; cover the SCIM lane.
- **F-05 [security] — SSRF DNS-rebinding TOCTOU inherited by SET delivery.** webhook-url.ts:18-21 self-acknowledges the rebinding window "deferred to integration day" (unfixed); :28-29 30s DNS cache widens it; dispatcher resolves once (:242) then fetch re-resolves (:267), no IP pin. A registered caep_endpoint_uri with short-TTL DNS alternating public/loopback/link-local sends signed SETs (carrying iss_sub) to internal/metadata services. spec §6 "SSRF guard must still apply" is currently a false promise. Fix: undici connect-hook re-check of the actual peer IP (or resolve-once + connect-by-IP).
- **F-06 [security] — erasure PII residue via decision.** Scrub whitelist clears requestBody/userId/ip/userAgent (UserManager.ts:409-419); mention predicate scans ONLY requestBody (:365-368). If decision carries subject/resource identifiers: rows mentioning the subject only in decision are never targeted; targeted rows retain the subject UUID in decision after scrub. Fix: pin decision shape IDENTIFIER-FREE `{decision, matchedCode, scope?}`; stash-point schema rejects extra fields; RED test asserts post-erasure decision intact + identifier-free.
- **F-07 [correctness+security] — AuthZEN PDP three traps.** (a) fail-soft pollution: resolveUserRowScope is caller-bound + null→tenant-wide-all (data-scope.ts:48,52-57); reusing it makes the PDP fail-OPEN. Must be subject-bound + fail-closed (getUserDataScope null→false), ban the data-scope.ts fail-soft arm, verify subject tenant membership first. (b) scope gate `scopes.includes('*')` (permission.ts:52-59): natural extension `|| includes(required)` grants PDP to ALL existing '*' keys; gate only runs when routePermissions has a mapping (authorize.ts:80-93). (c) route-specific scope matching is a NEW mechanism, not an extension (evidence O-2). SCIM plugin-local scope precedent exists (scim.ts:236-256).

### MEDIUM

- **F-08 [correctness] — CAEP delivery hostage to webhook kill-switch + age-prune.** webhooks_enabled=false → dispatcher tick returns before fanout (webhook-dispatcher.ts:201) → compliance SETs stop. PRUNE_SQL deletes events by age (:134,194); eventId onDelete cascade (schema.ts:587-589) → pending SET deliveries cascade-deleted after 7 days, no dead-letter. Revocation signals must be independent of the webhook kill-switch/prune.
- **F-09 [correctness+security] — SET profile under-specified.** session-revoked with iss_sub account subject + user.suspended payload {id,email,status} (UserManager.ts:481-485) has no sid → account-level semantics, not CAEP session subject. Missing typ=secevent+jwt, aud=target client_id, short exp, txn, jti persistence (retry must reuse jti; dispatcher is at-least-once :344-347). Same key signs access JWT + id_token → cross-token confusion risk.
- **F-10 [correctness+migration] — schemaVersion on the wrong channel.** T2 says "add version to dispatcher delivery body" but D-1=B audit export uses the cursor-exporter, NOT the dispatcher. Changing the dispatcher body breaks the published webhook HMAC contract for existing consumers; zero benefit to audit export. Compat strategy absent from §6.
- **F-11 [security+correctness] — decision pre-seal downgrade undetectable.** No version marker (D-2=A); apikey allow arm records no decision (permission.ts:60); unmapped routes pass (:33). A row whose decision is missing pre-seal is hash-identical to legacy NULL → verifier cannot assert "post-migration gated rows must have decision". Also seal passes responseStatus bare (app.ts:72) vs verifier ?? undefined (audit-verify.ts:193) — decision null-vs-undefined divergence = mass false positives. Fix: apikey arm records decision; verifier heuristic warn; lock write+verify same normalization; type-layer ban null.
- **F-12 [security] — export rowHash is not authentication.** rowHash is unkeyed SHA-256 (hashing.ts:28-30); anyone can forge a self-consistent row. Export receivers need per-endpoint HMAC (webhook precedent :263-265); rowHash is chain provenance only.
- **F-13 [correctness] — export vs RTBF erasure ordering undefined.** Export payload "raw row retained" (ip/userAgent/requestBody PII) reaches third parties before erasure; no ordering or receiver-deletion story. A compliance gap in the compliance batch.
- **F-14 [security] — https not enforced for caep_endpoint_uri.** webhook-url.ts:144 allows http; clients create arm uses ^https?:// (clients.ts:114-117) while edit arm requires https (:318) — inconsistent precedent. SETs are signed identity-lifecycle signals; plaintext leaks disable/purge events + sub. Enforce https on create+edit.
- **F-15 [security] — PDP rate-limit + write-amplification DoS.** Global limit 100/min per-IP + skipOnError fail-open (app.ts:176-184); batch /evaluations loop + per-evaluation audit row + export delivery → unbounded growth via one proxy IP. Fix: per-key limit + batch hard cap (413/400) + load test. 30s permission cache → ≤30s revocation lag; disclose freshness in discovery/doc.
- **F-16 [security+correctness] — CIDR [] vs null + v4-mapped.** [] → cidrVerdict empty=disabled='ok' (cidr.ts:86-91) → silent unrestricted; CRUD must reject [] or define deny-all. ::ffff:1.2.3.4 takes the v6 path, dotted tail fails → v4 CIDR never matches (cidr.ts:34-50); dual-stack locks out legit keys. Normalize v4-mapped (webhook-url.ts:116-121 precedent). Test matrix must cover mapped form.
- **F-17 [security+correctness] — groups claim tenantId source gap.** findAccount GetUserFn is (id) only (adapter.ts:27,182-194); getUser query takes name/email not tenantId (app.ts:325-333). getGroupNamesForUser(userId, tenantId) tenantId must come from users.tenantId in the same query, not DEFAULT_TENANT. Three seams to change (claims() zero-arg, GetUserFn projection, getUser query).
- **F-18 [security] — groups scope global + claim uncapped.** ALLOWED_SCOPES is global (clients.ts:19), not per-client → any registered client can request groups; flat names expose org chart to all RPs; memberships unbounded → token/header overflow. Fix: per-client scope opt-in, consent disclosure, claim hard cap (e.g. 50) + overflow marker.
- **F-19 [evidence] — §2 CIDR-reuse claim is phantom.** webhook-url.ts:4-8 explicitly "this is NOT utils/cidr.ts" (independent impl, fail-CLOSED vs cidr.ts fail-open). cidr.ts imported only by routes/auth/shared.ts:12. AUTH_IP_002 is at shared.ts:123, not login.ts. R5 reuse of cidr.ts is fine, but "shared with SSRF guard" is false.
- **F-20 [evidence+migration] — SENTINELS/ops citation mislocated.** SENTINELS array is migrate.sh:109-122 (spec's 108-119 truncates the 0013 dual sentinels :120-121). ops file-count expectations live in ops-migrate.test.ts:183,220,254,273 (toHaveLength(14)), NOT migrate.sh (dynamic count). Inherited from data-scope spec:53. T0 must update the test too.
- **F-21 [migration] — stale "open" markers contradict §5 RESOLVED.** spec:59 (§3 title "§5 questions unresolved"), :67 (T0 "Open: consolidated vs split"), :13 (R2 "queue shape open") all contradict ratified D-1/D-6. "Dual/triple SENTINELS" wording vs ratified "triple". rev.2 changelog claimed §3 updated but left residue.
- **F-22 [evidence] — overstated facts.** Audit middleware has NO /api/v1 prefix filter (all non-GET/HEAD, app.ts:570-590); "denial only pino-warn" false (3 paths: PERM_001 warn, PERM_002 warn, PERM_003 no-warn); scope gate is '*' only (route-specific is new-build).

### LOW

- **F-23 [correctness]** batch /evaluations audit granularity (middleware logs one row per POST; "audit row per evaluation" needs manual emit); extractResourceType returns 'v1' for /api/v1/* (middleware.ts:25-37) → OCSF activity naming inherits garbage.
- **F-24 [correctness]** GET denials not audited (middleware skips GET/HEAD app.ts:572); T4 "mismatch→audit" only holds for writes.
- **F-25 [correctness]** RoleManager group-leg roles row not tenant-pinned (RoleManager.ts:638-643, only groupUsers.tenantId); AuthZEN amplifies into a queryable oracle — defense-in-depth gap.
- **F-26 [migration]** sentinel probe precedent citation off-target: 0008/0013 prove quoted "groups" form; 0014 columns need TEXT→0006 (:112), JSONB→0012 jwks (:119), audit_logs→0010 row_hash (:116) precedents.
- **F-27 [migration]** reversibility posture not stated: NULL-additive ALTERs are metadata-only (safe on large audit_logs), but chain is forward-only (migrate.sh:64, D124) → rollback = new forward migration. State it.
- **F-28 [migration]** T3 "independent" is soft: its audit-row decision shape depends on T2; §7 graph omits T3→T2 edge. T1/T2/T3/T4 all touch app.ts → merge-order coupling (execution discipline).
- **F-29 [evidence]** minor citation precision: 0013 label mentions only groups.kind (also role_permissions.data_scope); loadJwks consumes opts not env directly (config.ts:117-119).

## Conflict items (PRESERVED — no smoothing)

- **CONFLICT-1 (D-3 single key).** Ratified D-3=A (reuse JWT/OIDC RS256 key). Security lens dissent (S1-4): private-key compromise = forge any user session + id_token + broadcast fake account-disabled/purged to all RPs; loadJwks ALREADY supports multi-key publication (provider.ts:77-94), so an independent SET private key + distinct kid in the SAME JWKS is near-zero cost and isolates blast radius. Correctness/evidence did not contest D-3. → User ruling required: keep D-3=A vs split SET key.
- **CONFLICT-2 (D-1/D-6 transport premise).** Ratified D-1=B (reuse dispatcher) + D-6=A (three ALTERs). Correctness F-01/F-03 prove the dispatcher cannot carry SET/audit-export without new delivery-state schema + engine changes beyond three ALTERs. This is a finding-vs-ruling conflict (the ruling rests on a false premise), not role-vs-role. → User ruling required: re-open the transport architecture + migration scope.

## Verified TRUE (not falsified)

- D-2 hash invariance mechanism: canonicalJson drops undefined / keeps null (hashing.ts:40,45); responseStatus ?? undefined convention real (audit-verify.ts:193); jsonb key-reorder resolved by sorting. Legacy NULL-decision rows hash unchanged — CONDITIONAL on all hash points (incl. F-02 backfill) normalizing identically.
- Chain head 0013 (14 files); three target tables/columns as claimed; ops-migrate.test.ts 14 assertions real; D124 generate posture consistent; numbering D130/D-1..D-6/R-series coherent; dependency graph acyclic.
- Core anchors: D1 field set, webhook_deliveries FK, dispatcher body, claims mapping (no groups), api_keys/audit_logs columns, getDepartmentIdsForUser, interaction mount precedent, 0012/0013 multi-table precedent, apikey authenticate branch, suspend/delete funnels.

## Explicitly not covered (panel-wide)

- No commands/tests/migrations run (all static read-only review).
- SET receiver-side validation (R1 deferred); SSF stream-management API; RFC 8417/9493/AuthZEN wire conformance vectors (not checked against spec text).
- oauth2-proxy reference config correctness (no repo code; doc claim only).
- UI fields / e2e / gates baselines / write-amplification quantification / AuthZEN rate-limit design.
- migrate.sh live-fire behavior; 0014 drizzle generate output.
- Tenant-level revocation (tenant.suspended) → per-user SET (spec silent).
- External incident citations (Keycloak 26.7→26.8, Cloudflare 9109, verification-day undici) not re-verified.

## Handoff

Per expert-panel-review → adjudication-walkthrough: the two CONFLICT items + the CRITICAL/HIGH design fixes that change architecture are walked one at a time for user ruling. The remaining MEDIUM/LOW findings are design REQUIREMENTS to fold into the plan/spec (clear correct fixes, not user contests). The plan document is written AFTER the pivotal conflicts are ruled.

---

# Panel Run 2 — EXECUTION PLAN review (2026-11-23)

**Artifact:** `plans/2026-11-23-4a-compliance-batch.md` + spec rev.3. **Gate:** Deep, 5 roles — correctness (code-reviewer), evidence (evidence-critic), security (identity-security), migration (db-migrations), test coverage (test-strategist). Parallel isolated; same output shape; disagreements preserved.

**Verdict: BLOCK.** Plan quality above typical proposals (§0 corrections all verified true; layering mostly right), but 3 CRITICAL + consolidated HIGH findings falsify core guarantees. §0 anchors and precedent claims verified TRUE (0009 multi-table, SKIP LOCKED CTE, dead-letter-10, secret one-time reveal, v4-mapped normalize, admin-ui pages exist).

## CRITICAL

- **PC-1 [corr C-1 + evid A2] — cursor "no-drop" broken under seq-vs-seq commit inversion.** seq is assigned at INSERT, visible at COMMIT; a slow transaction holding seq=100 commits after the exporter delivered past 101 → row 100 never exported (unrecoverable, invisible). The plan's RED locks createdAt-vs-seq inversion — the harmless one — not the fatal seq-vs-seq one. No watermark/lag mechanism anywhere.
- **PC-2 [corr C-2] — CAEP enqueue sites miss SCIM PATCH disable arms.** SCIM disable funnel is THREE call sites: PATCH body active=false (scim.ts:623-626), PATCH Operations replace active (scim.ts:704-708), DELETE (=scim.ts:651). The plan's route-layer three-site list (users PATCH/DELETE + SCIM DELETE) misses both PATCH arms — the IdP-driven disable, the most common enterprise RISC trigger, emits NOTHING. Spec says manager-layer emission, plan says route-layer — contradiction; the route-enumeration approach is what produced this miss.
- **PC-3 [sec C-1] — audit export cross-tenant leak.** Export SELECT has NO tenant predicate; destinations carry tenantId FK (per-tenant registration implied); gating written as "platform or audit:read-gated" (unresolved). A tenant admin registering a destination receives ALL tenants' audit rows (emails, IPs) continuously.

## HIGH (merged)

- **PH-1 [corr H-1 + evid A1] — T5 deadlocks at registration:** `clients.ts:19` ALLOWED_SCOPES excludes 'groups'; T5 file list omits `routes/clients.ts`; "per-client opt-in by construction" unreachable as listed.
- **PH-2 [corr H-2] — erased-row export semantics undefined + payload `email` has no source column** (audit_logs has none; JOIN users impossible post-delete; requestBody scrubbed to {}).
- **PH-3 [corr H-3 + test M3] — retention sweeper hard-DELETEs rows** (retention-sweeper.ts:57-59): destination down > retention → silent pre-delivery loss; NEW destination (cursor=0) replays surviving legacy history in arbitrary backfilled order.
- **PH-4 [sec H-1] — destinations zero SSRF:** no webhook-url guard, no connect-hook, no redirect:'manual', no https in T2's file list/semantics/RED — a blind SSRF write primitive carrying full audit PII.
- **PH-5 [sec H-2] — RTBF erasure misses caep_deliveries:** account-purged is enqueued AFTER erase writes subjectId; delivered/dead/pending rows retain user UUID indefinitely; no TTL, no scrub.
- **PH-6 [corr M-1 + evid A3 + migration] — `ADD COLUMN seq bigserial` is NOT metadata-only:** volatile default → full-table rewrite under ACCESS EXCLUSIVE (lock_timeout caps acquisition, not hold); zero ADD-COLUMN-serial precedent in chain; plan also omits `.notNull()`. Low-lock staged alternative available (bigint NULL → batch backfill → CREATE SEQUENCE OWNED BY + setval → SET DEFAULT/NOT NULL; hand-written SQL acceptable per 0006-0008 precedent).
- **PH-7 [migration] — ops-migrate misses table-count 25→27** (`:180` + titles `:168,:258`) and 0014 sentinel-warn count 6 (per `:211-215` pattern).
- **PH-8 [test H1-H6 + M4] — test-plan gaps:** F-15 per-key rate limit zero tests; kill-switch test proves flag-decouple not mechanism (missing dual-table assertion, age-prune independence, concurrent-claim no-double-delivery); P-2 isolation test can't prove key selection (must jwtVerify via JWKS kid + assert dual kid — plan dropped spec's requirement); Checkpoint B battery not executable (no prep/commands/criteria/vehicle); destinations UI zero e2e (PIT-080 family); F-23 per-evaluation audit + discovery/freshness untested.
- **PH-9 [corr M-2 + test] — T3 gate/audit holes:** JWT-lane scope check undefined (TypeError→500 risk); 401 vs 403 vs SCIM precedent mismatch; PDP evaluation decision has NO stash point (authzen audit rows decision≡NULL, tripping T2's own F-11 heuristic); apikey deny arm (PERM_003) also unstashed [corr M-4].

## MEDIUM (fold into plan as requirements)

sec M-1 cursor regression guard (GREATEST + claim/lease; export dead-letter/backoff) · sec M-2 destinations CRUD gating (routePermissions mapping + NEW write-level code + apikey carve-out + url-change re-SSRF) · sec M-3 `?? ['*']` day-one PDP coverage — fix to `?? []` at the gate + rate-limit numbers land with T3 · sec M-4 consent page groups disclosure (SCOPE_I18N/Consent.tsx/i18n missing from T5) + truncation determinism/docs · sec M-5 redirect:'manual' both new fetchers · sec L-1 HMAC covers {destinationId, watermarkSeq, timestamp, body} · sec L-2 URL host normalization · sec L-3 enqueue inside the same routeTx as delete · corr M-5 tenant-cascade zero CAEP — disclose in T6 at minimum · evid A4 oidc-provider claims/scope-enforcement locally unverifiable (node_modules absent) — pnpm install gate before T5 sign-off + negative RED · evid A6 decision shape via/matchedCode contradiction · evid A5 anchor line-range fix (backfill UPDATE at audit-anchor.ts:167-183) · test M1 e2e mock roster for new fields · test M2 orphaned-suite enumeration (hashing.test 11→12 + verify/seal/anchor/logger ripple) · test M5 rebinding test mechanism (controllable DNS/connect-layer fake) + SET profile sub_id/events assertions · test M6 F-11 heuristic test · migration LOW naming divergence audit_export_cursor vs audit_export_destinations + spec payload-column deviation — record at Checkpoint A.

## CONFLICT items (preserved for adjudication)

- **CONFLICT-3 — trustProxy guard strength:** plan "loud WARN" vs spec "hard precondition" (internal contradiction); security demands prod fail-fast (auth-integrity class, requireJwtSecret precedent; DB-reading check must be post-migration hook, not in env-only warnDegradedChecks).
- **CONFLICT-4 — caep_deliveries.clientId FK:** CASCADE (webhook precedent; silent loss of undelivered revocation evidence on client delete) vs SET NULL + dead-letter (preserve jti trail; oidc_clients has no tenantId to constrain).
- **CONFLICT-5 — export destination tenancy model:** platform-only destinations (b) vs per-tenant destinations with mandatory tenant predicate (a) — bundled with CRUD gating (sec M-2).
- **CONFLICT-6 — seq column strategy:** bigserial ADD COLUMN (rewrite + AEL) vs staged low-lock bigint+sequence (more steps, hand-written SQL).
- **CONFLICT-7 — CAEP enqueue layer:** route-layer enumeration (missed 2/5 sites — falsified) vs manager-layer (UserManager.changeStatus/delete — covers all paths incl. future, but couples identity to CAEP table) vs hybrid (manager-level hook interface, server implements).

## Explicitly not covered (panel-wide)

node_modules absent — oidc-provider/jose/undici/drizzle-kit internals not locally verified (install gate). drizzle generate output for 0014 not run. admin-ui destinations UI, e2e baselines, T6 docs = future work. audit_logs production volume unquantified (lock-window risk sizing). routes/clients.ts DELETE arm existence not checked by migration lens.

## Handoff (run 2)

PC-1/PC-2/PC-3 + CONFLICT-3..7 walked one-by-one (adjudication-walkthrough); PH/MEDIUM folded into plan rev.2 after rulings. Test-lens BLOCK resolved by folding PH-8/PH-9 into per-task RED enumerations.

**DISPOSITION (ruled by user 2026-11-23):** P-3=B (manager-funnel enqueue) · P-4=A (gap-aware cursor) · P-5=A (platform destinations) · P-6=B (staged low-lock seq) · P-7=B (prod fail-fast trustProxy) · P-8=B (SET NULL + dead-letter). All PH/MEDIUM findings folded into plan rev.2 + spec rev.4 (plan governs on conflict). BLOCK lifted; execution gated on explicit user go.