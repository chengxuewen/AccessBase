# Batch R1 "Quick-Win Safety Net" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Discharge every decision-free finding from the 2026-09-28 round-2 gap audit in one TDD batch — one live pool leak, one atomicity bug, the auth-event silence, dispatcher blind-spot metrics, and the mechanical doc-honesty wave — while formally registering the decision-gated remainder (R2-R5) for per-batch specs.

**Architecture:** All fixes land inside existing funnels and conventions: manager singletons go through the `utils/managers.ts` memo pattern; events go through `emitEvent(d, …)` (this batch extends the `DomainEventType` union — the one identity-package delta); metrics extend the prom-client root-registry pattern in `routes/metrics.ts`; docs obey the D126 header/count discipline. No new packages, no DB schema changes (events.type is plain TEXT — union extension is type-level only), no new permission codes.

**Tech Stack:** Fastify, Drizzle ORM, prom-client, Vitest, Playwright.

**Audit (spec-equivalent):** `docs/superpowers/reports/2026-09-28-gap-audit-round2.md` — this plan implements its "R1 quick-win safety net" tier verbatim (H1, M2, H5, M3, H4, M19, L3) and registers the rest.

---

## Audit conclusions carried forward (summary — full detail in the report)

- **CRITICAL (all decision-gated, NOT in this batch):** C1 audit hash-chain discarded; C2 TrustedDevice/SsoSession zero-implementation; C3 `idleTimeout` config has no reader (idle/sliding expiry unenforced). → Gates DG-1..DG-3 below.
- **HIGH discharged by this batch:** H1 MfaManager per-request pool churn (T1). **HIGH registered for R2-R3:** H2 OptionsManager unbounded cross-node staleness, H3 envelope-key rotation data-loss, H6 SSO logout-coherence trio, H7 revocation fail-open posture.
- **MEDIUM discharged:** M2 tenant cascade wrong handle (T2), H5/M3 auth events + dispatcher metrics (T3, T4), H4 doc under-claim wave (T5), M19 backchannel UI field (T6). Rest → R4/R5 roadmap.
- **Health:** auth.ts 1959 lines keeps growing — route-split is deliberately NOT in this batch (deferred to its own refactor plan; mixing a 1959-line split into a fix batch inflates blast radius against the PIT-047 dispatch discipline).

## Global Constraints

- Language policy: everything persisted (code, comments, commits, docs) in **English**; chat mirrors user language.
- No `as any`, `@ts-ignore`, `@ts-expect-error`. No new runtime dependencies (prom-client already installed).
- TDD: RED test first per task, GREEN minimal, per `test-driven-development` skill.
- Gates at batch close (report actuals, never extrapolate): `pixi run npx vitest run` baseline **1207 passed** (only grows), `4×tsc --noEmit` = 0 errors, eslint touched-files 0 error / 0 new warnings, e2e chromium **173 passed + 3 skipped 0 failed** (only grows), coverage floors hold.
- E2E/vitest run prefix: `export no_proxy=localhost,127.0.0.1 NO_PROXY=localhost,127.0.0.1`; after back-to-back full runs, 429 red = rate bucket, cool down ≥60s (PIT-083).
- Every new `/login`-shell-fetched endpoint mock must land in ALL mock-API specs (PIT-080 roster).
- Manager instantiation: route code gets managers only via `utils/managers.ts` getters; `vi.mock` proxies THROW on undeclared exports — wrap property reads in try (PIT-082).
- Doc count flips (AGENTS/conventions/status) land in the SAME commit as the counted artifact (D126).
- `buildApp()` stays side-effect-free; new timers/metrics follow the M-batch /metrics five-point contract.

---

## File structure (batch-wide)

| Action | Path | Responsibility |
|---|---|---|
| Create | `apps/server/src/utils/mfa-manager.ts` | sync value-memo `getMfaManager()` over the shared `authDb()` pool + `resetMfaManager()` (T1) |
| Modify | `apps/server/src/utils/managers.ts` | call `resetMfaManager()` from `resetManagers()` (T1) |
| Modify | `apps/server/src/routes/auth.ts:87` | drop closure factory, import memo (T1); emit auth events (T3) |
| Modify | `packages/identity/src/managers/TenantManager.ts:186-193,210` | thread tx handle through suspend cascade (T2) |
| Modify | `apps/server/src/routes/tenants.ts` | wrap suspend-mutation path in `routeTx` (T2) |
| Modify | `packages/identity/src/services/events.ts:17-29` | extend `DomainEventType` with `auth.login.success\|auth.login.failure\|auth.logout` (T3, Momus R1) |
| Create | `apps/server/src/utils/auth-events.ts` | fire-and-forget auth.* event emitter over `authDb()`, with swallow-exception comment (T3) |
| Modify | `apps/server/src/utils/webhook-dispatcher.ts` | outcome counters + true-backlog count/age gauges via one once-per-tick SELECT behind deps injection (T4) |
| Modify | `docker/prometheus/rules.yml` | two webhook alert rules (T4) |
| Modify | `docs/modules/*.md`, `docs/openapi.json`, `docs/superpowers/…`, `CHANGELOG.md`, `AGENTS.md`, `.agents/memorys/conventions.md` | honesty wave + regens (T5) |
| Modify | `apps/admin-ui/src/pages/Clients.tsx`, `apps/admin-ui/src/api/clients.ts`, locales | backchannel field (T6) |
| Modify | `e2e/auth.spec.ts` | login-shell mock roster (T7) |
| Create | `packages/identity/src/services/domain-policy.ts` | pure domain allow/block + alias validators, extracted from dead PasswordProvider (T9) |
| Modify | `apps/server/src/routes/auth.ts` register route + `apps/server/src/config.ts` + `.env.example` | wire domain policy into real registration (T9) |
| Modify | `packages/identity/src/plugin.ts:38`, `packages/identity/src/index.ts:43` | unregister PasswordProvider shell; delete `providers/PasswordProvider.ts` (T9) |
| Modify | `apps/server/src/routes/options.ts` allowlist + login gate + Login.tsx arm | `auth.require_verified_email` switch (T10) |
| Modify | `packages/identity/src/types.ts` (idleTimeout :188/:201/:357/:364; SsoConfig :222/:292/:355; trustedDevices) + `index.ts:171,:121-124` | dead config retirement (T11) |
| Create/modify | `apps/server/src/__tests__/*`, `apps/identity __tests__/*`, `e2e/clients.spec.ts` | RED→GREEN locks per task |

---

### Task 1: MfaManager process singleton (H1 — live pool leak)

**Files:**
- Create: `apps/server/src/utils/mfa-manager.ts` (memo lives HERE, not in managers.ts — managers.ts deliberately avoids static identity imports for the partial-mock link-time rule, its docblock :29-36; a focused module may static-import `MfaManager` exactly as `routes/auth.ts:3` already does)
- Modify: `apps/server/src/utils/managers.ts` (`resetManagers()` calls `resetMfaManager()` — one import line, no roster loop changes)
- Modify: `apps/server/src/routes/auth.ts:87` and the 6 call sites (1543, 1559, 1616, 1631, 1685, 1755)
- Test: `apps/server/src/__tests__/mfa-manager-singleton.test.ts` (create)

**Interfaces:**
- Consumes: `MfaManager(keyHex, databaseUrl?: string | DrizzleDB)` from `@accessbase/identity` (ctor VERIFIED `MfaManager.ts:34-43`: validates 32-byte hex, dials `createDb` when no handle passed — THAT is the leak); shared `authDb()` from `utils/managers.ts` (Q3A pool, sync value-memo, closed by `closeAuthDb` on onClose).
- Produces: `getMfaManager(): MfaManager` from `utils/mfa-manager.ts` — sync value-memo constructing `new MfaManager(config.mfaEncryptionKey, authDb())` (NO new pool — reuses the Q3A one; Momus R3 fix). Throws the existing `'MFA_ENCRYPTION_KEY not configured …'` before memoizing when the key is unset, so the failed slot never caches. `resetMfaManager(): void` clears the memo (does NOT close authDb — it doesn't own it).

- [ ] **Step 1.1 RED:** write `mfa-manager-singleton.test.ts`:

```ts
// import { getMfaManager, resetMfaManager } from '../utils/mfa-manager.js'
// vi.mock('@accessbase/identity') declaring ONLY MfaManager = vi.fn() + authDb-shaped db fake (PIT-082)
// assert: two getMfaManager() calls => ctor called ONCE, same instance, ctor received the authDb() handle
// assert: resetMfaManager() then getMfaManager() => ctor called again
// assert: config.mfaEncryptionKey unset => throws 'MFA_ENCRYPTION_KEY not configured', next call with key set still constructs (slot not poisoned)
// NOTE (Momus R3): MfaManager has NO close() — do not assert close-through-reset; pool ownership stays with authDb()/closeAuthDb.
```

Run `pixi run npx vitest run apps/server/src/__tests__/mfa-manager-singleton.test.ts` → FAIL (export missing).

- [ ] **Step 1.2 GREEN:** create `utils/mfa-manager.ts` (~12 lines: key check → memo → `new MfaManager(key, authDb())`), export `resetMfaManager()`; add the reset call inside `resetManagers()` in managers.ts; in `routes/auth.ts` delete line 87's closure factory and the now-unused `requireMfaKey` if grep shows no other user (the :1755 disable path uses the same factory — it becomes a plain `getMfaManager()` call).

```ts
let mfaManager: MfaManager | undefined;
export function getMfaManager(): MfaManager {
  if (!mfaManager) {
    if (!config.mfaEncryptionKey) throw new Error('MFA_ENCRYPTION_KEY not configured (32-byte hex required for TOTP)');
    mfaManager = new MfaManager(config.mfaEncryptionKey, authDb()); // shared Q3A handle — no new pool (Momus R6)
  }
  return mfaManager;
}

export function resetMfaManager(): void {
  mfaManager = undefined; // does NOT close authDb — it doesn't own it
}
```

Rationale for handle-reuse over owning a pool: one fewer pool owner in the D2/M4 sprawl, and shutdown wiring stays untouched. The memo is module-level (not plugin-closure) so multiple `buildApp()` instances in tests share it — `resetMfaManager()` from `resetManagers()` keeps that seam honest.

- [ ] **Step 1.3** Run the new test + full MFA route suites (`vitest run apps/server/src/__tests__/mfa`) → PASS. Existing route tests that count MfaManager constructions via `mock.results` need `await resetManagers()` in `beforeEach` (Q2a seam, conventions).

- [ ] **Step 1.4 Commit:** `fix(server): memoize MfaManager per process — closes last PIT-081 per-request pool site (R1-T1)`

---

### Task 2: Tenant suspend cascade atomicity + correct handle (M2)

**Files:**
- Modify: `packages/identity/src/managers/TenantManager.ts:180-193,210-230` (`update` + `revokeTenantAccess`)
- Modify: `apps/server/src/routes/tenants.ts` PUT handler (suspend path) — wrap `tenantManager.update` in `routeTx`
- Test: identity `TenantManager.test.ts` extension + server `tenants.test.ts` extension

**Interfaces:**
- Consumes: existing funnel shape `update(id, data, db?)` — CHECK current signature first (`d ?? this.db` pattern, Q2b uniform widening); `bumpAuthState(d, …)`, `revokeTenantAccess(id, d)`, `emitEvent(d, …)`; `routeTx` from `apps/server/src/utils/tx.ts`.
- Produces: `revokeTenantAccess(id: string, d: DbLike = this.db)`; suspend branch of `update` runs bumpAuthState + revoke + emitEvent all on `d`.

- [ ] **Step 2.1 RED (identity):** with a faithful fake db (Q2b factory pattern, transaction-capable), call `update(id, { status: 'suspended' }, txFake)`; assert `bumpAuthState` UPDATE and the sessions/apiKeys revokes ran on `txFake`, not the raw pool handle (record SQL calls per handle — H-T3/mock two-handle precedent from batch G).
- [ ] **Step 2.2 GREEN:** change `await bumpAuthState(this.db, …)` → `await bumpAuthState(d, …)`; `revokeTenantAccess(id)` → `revokeTenantAccess(id, d)`; add `db?: DbLike` trailing param to `revokeTenantAccess` and swap its `this.db` reads for `d`.
- [ ] **Step 2.3 RED→GREEN (server):** PUT `/v1/tenants/:id` status=suspended through `routeTx((tx) => tenantManager.update(id, data, tx))`; test asserts `getUserManager().transaction` entered (spy) for the suspend arm only if current tests already spy that shape — otherwise assert via tx-threaded fake. Mid-failure injection (revoke throws) leaves tenant row NOT suspended (real-PG integration if cheap; unit-level rollback assertion acceptable, note which).
- [ ] **Step 2.4** Run: `vitest run packages/identity apps/server/src/__tests__/tenants`. Commit: `fix(identity,server): tenant suspend cascade uses the caller tx handle and runs atomically (R1-T2)`

---

### Task 3: auth.login.*/auth.logout events (H5 — outbox silence)

**Files:**
- Modify: `packages/identity/src/services/events.ts` — add `'auth.login.success' | 'auth.login.failure' | 'auth.logout'` to the `DomainEventType` union (:17-29). REQUIRED (Momus R1 BLOCKER): `emitEvent` is typed on the union (verified :33 `type: DomainEventType`); without this the wire code will not typecheck. Union-only change — events.type is plain TEXT (schema.ts:489, no CHECK), no migration. Rebuild identity dist before server tsc (dist-sync convention).
- Create: `apps/server/src/utils/auth-events.ts`
- Modify: `apps/server/src/routes/auth.ts` — login success arms (password login via `issueTokenPair` call sites — NOTE: `issueTokenPair` is the shared choke for password/oauth/saml/webauthn arms; wire at the CALL SITES with explicit `method`, not inside the helper, to keep method honest), login failure arms (bad-credentials + `AUTH_LOCKED_001` :~297 + suspended AUTH_004), logout :622-646
- Test: `apps/server/src/__tests__/auth-events.test.ts` + wire assertions inside `routes.test.ts` / `mfa.test.ts` (Momus flows nit: there is no `auth.test.ts`; `grep -l "auth/login" apps/server/src/__tests__` finds the homes)

**Interfaces:**
- Consumes: `emitEvent(d, { tenantId, type, payload })` from `@accessbase/identity` (signature verified: `packages/identity/src/services/events.ts:38`); shared pool `authDb()` from `utils/managers.ts` (Q3A pool, already closed on shutdown); Fastify `request.log`.
- Produces:

```ts
// apps/server/src/utils/auth-events.ts
export type AuthEventReason = 'bad_credentials' | 'locked' | 'suspended' | 'mfa_required_satisfied' | 'other';
export function emitAuthEvent(input: {
  type: 'auth.login.success' | 'auth.login.failure' | 'auth.logout';
  tenantId: string; userId?: string; email: string; method: string; reason?: AuthEventReason;
}): void // fire-and-forget over authDb(); .catch(err => logger.warn) — DELIBERATE exception to the events.ts 'NEVER swallow' invariant (Momus R5): auth events pair with NO mutation, so a failed insert must not fail a login; put this one-line justification in the auth-events.ts header comment and mirror it into the Q4c conventions block (T5).
// tenantId source: the row's tenant when known; failure arms WITHOUT a user row (bad_credentials pre-lookup, locked pre-lookup) use request.tenantId ?? DEFAULT_TENANT, mirroring the audit anonymous/system attribution precedent (blockers-review non-finding note).
```

Payload carries `{ email, method, reason? }` — NO password/flow material (audit redactor discipline doesn't apply to events table, so keep it minimal by construction).

- [ ] **Step 3.1 RED:** unit — fake db capturing inserts; success arm writes type `auth.login.success` payload `{email, method:'password'}`; insert rejection is swallowed (warn only, no throw, no unhandled rejection).
- [ ] **Step 3.2 GREEN:** implement emitter over `authDb()`.
- [ ] **Step 3.3 RED→GREEN (wiring):** in `routes.test.ts`, after one successful `/auth/login` assert one events insert; after bad password assert `auth.login.failure` with `reason:'bad_credentials'`; after logout assert `auth.logout`. Sites: password success arm + `/mfa/verify` session arm with `method:'password'|'totp'` (the promised surface).
- [ ] **Step 3.4 Scope note:** other sign-in channels (oauth/saml/webauthn/ldap/sms/magic) get their own one-line calls ONLY IF `emitAuthEvent` drops in without restructuring the route; if any site needs a new variable plumbed through 3 scopes, file it as an R-schedule line in the commit body instead of forcing it. `auth.login.success{method}` completeness is NOT a gate for this task; password+totp+logout is the promised surface.
- [ ] **Step 3.5 Commit** (docs only in T5, per Momus R4 cross-lane collision fix): `feat(identity,server): auth.login.success/failure + auth.logout events — DomainEventType extension + telemetry-swallow exception (R1-T3)`. The three event names + the Q4c conventions exception line are handed to T5's wave via this commit body.

---

### Task 4: Webhook dispatcher metrics + alert rules (M3)

**Files:**
- Modify: `apps/server/src/utils/webhook-dispatcher.ts`
- Modify: `docker/prometheus/rules.yml`
- Test: dispatcher unit battery extension (`apps/server/src/__tests__/webhook*`)

**Interfaces:**
- Consumes: prom-client `Counter`/`Gauge` root registry (pattern + `accessbase_` prefix per `routes/metrics.ts:2,23`); existing `deps.query` seam; per-tick claim loop with `CLAIM_LIMIT = 25` (:71).
- Produces (counters are in-process in the tick; the two backlog gauges share ONE injected once-per-tick SELECT — deps note below):

```
accessbase_webhook_deliveries_total{outcome="ok|retry|dead"}   Counter, incremented per delivery settled
accessbase_webhook_pending_events  Gauge = TRUE backlog: SELECT count(*) FROM events WHERE fanout_complete_at IS NULL — partial index exists (0009)
accessbase_webhook_oldest_pending_age_seconds Gauge = SELECT EXTRACT(EPOCH FROM (now()-min(created_at))) over the same predicate — ONE combined SELECT (count+age in one query) per tick
```

(Momus R2: the earlier 'claimed + estimate' shape capped at CLAIM_LIMIT=25 could never satisfy the >100 alert — true count it is.)

Both gauges ride the SAME injected dep: `backlogStats?: () => Promise<{ count: number; oldestAgeSeconds: number | null } | null>`, defaulted in the production wiring (`app.ts` dispatcher construction) to the one-SQL over the lazy pool; scripted in unit seams. One extra SELECT per tick (≤60s cadence, partial-index bound) is the accepted cost — matches the retention-sweeper posture. Dispatcher stays fully dependency-injected (Q4c B3).

- [ ] **Step 4.1 RED:** scripted tick with 2 ok + 1 dead deliveries → counters reflect 2/0/1; gauge set; tick without Redis/PG (deps default) records nothing, throws nothing.
- [ ] **Step 4.2 GREEN** via counter placement; wire metrics in `startWebhookDispatcher` only (NODE_ENV=test never registers — unchanged).
- [ ] **Step 4.3** `docker/prometheus/rules.yml`: `AccessbaseWebhookDeadLettering` (increase(deliveries_total{outcome="dead"}[15m]) > 0, warning) + `AccessbaseWebhookBacklog` (pending gauge > 100 or age > 300s for 10m, warning). Keep the file's "sample, not wired" self-annotation.
- [ ] **Step 4.4** Commit: `feat(server): dispatcher delivery counters + backlog gauges and 2 alert rules (R1-T4)`

---

### Task 5: Doc-honesty wave — headers, catalog, openapi, counts (H4)

**Files:**
- Modify: `docs/modules/webhook.md:3` (design-only → implemented + §42 surface pointer + the three new auth.* event names from T3's commit body, event-catalog section) and its subscription-examples list
- Modify: `docs/modules/error-codes-reality.md` — run the regen command block at its head (adds AUTH_IP_002, CAPTCHA_001/002, EVENT_NOT_FOUND, ADMIN_EXISTS/ADMIN_CREATION_FAILED/ADMIN_NOT_CREATED/ADMIN_NOT_FOUND; diff must show ONLY additions from the current emitter grep — re-run `grep -rhoE "code: '[A-Z0-9_]+'" apps/server/src packages/identity/src --include='*.ts' | sort -u` and reconcile by hand for the D126 gate)
- Regenerate: `docs/openapi.json` via `pnpm --filter @accessbase/server gen:openapi`
- Modify: `AGENTS.md` (43→44 module docs; any moved counts), `.agents/memorys/conventions.md` (the `resource: '` check command expected value: keep 26 — verify current, flip headline only if drifted; PLUS the Q4c block auth-events swallow exception, T3 handoff), `CHANGELOG.md` (R1 entries incl. T3 event names — sole writer per Momus R4), `docs/modules/api.md`/`security.md` untouched here (their refresh is R-schedule, bigger scope)
- Test: the D126 gate greps themselves

- [ ] **Step 5.1** Run both gate greps first (evidence of current drift): `grep -L 'Implementation status' docs/modules/*.md` (expect empty) and the code-vs-catalog diff loop. Fix catalog until `grep -rhoE "code: '[A-Z0-9_]+' …"` ⊆ catalog.
- [ ] **Step 5.2** Header rewrites (each keeps the historical A-number, adds the discharge sentence — pattern: `implemented (…); A8 note superseded by Q4c — see reports/2026-09-28`).
- [ ] **Step 5.3** `pnpm --filter @accessbase/server gen:openapi`; sanity: path count rises (groups/webhooks/events/enroll-mfa/captcha/invite appear — verify with `python3 -c` json walk like the audit did).
- [ ] **Step 5.4** Count-parity checks (`grep -c '^## PIT-'` vs AGENTS claim etc.). Commit: `docs: honesty wave — 5 under-claiming headers, error catalog regen, openapi regen, count parity (R1-T5)`

---

### Task 6: Clients UI — backchannel_logout_uri field (M19)

**Files:**
- Modify: `apps/admin-ui/src/api/clients.ts` (type: `backchannelLogoutUri?: string | null` on create input + row type — server already accepts/returns it, `routes/clients.ts:72,121`, `OidcClientManager.ts:81,95,127`)
- Modify: `apps/admin-ui/src/pages/Clients.tsx` form (new optional `Form.Item name="backchannelLogoutUri"` with `rules={[{ type: 'url' }]}` + tooltip: receives logout_token; https-only enforced server-side)
- Modify: locales en/zh (`clients.backchannelLogoutUri` + hint)
- Test: `e2e/clients.spec.ts` — create with the field, list/detail round-trip assertion

- [ ] **Step 6.1 RED** e2e (mock API — copy real response shapes per PIT-033). [ ] **Step 6.2 GREEN** type+form+i18n. [ ] **Step 6.3** `vitest run apps/admin-ui` (parity test guards locales) + targeted e2e. Commit: `feat(admin-ui): OIDC client back-channel logout URI field (R1-T6)`

---

### Task 7: e2e login-shell mock roster (L3, PIT-080 latent)

**Files:**
- Modify: `e2e/auth.spec.ts` (7 `/login` mounts lacking `**/api/v1/auth/sms/status`, `**/api/v1/auth/saml/status`, `**/api/v1/auth/captcha/status` mocks)

- [ ] **Step 7.1** Reproduce first: run `npx playwright test e2e/auth.spec.ts --project=chromium` with the vite-only webServer; if console nets already catch these (sms mock added in Q1 across specs), confirm and mark task "already discharged — verify-only"; else add the three routes to each mount (use the roster proxy grep from conventions: `grep -L "sms/status" e2e/*.spec.ts`).
- [ ] **Step 7.2** Full-suite console-error sanity (T8 runs it anyway). Commit: `test(e2e): complete /login-shell mock roster in auth.spec (R1-T7)`

---

### Task 9: Domain-restriction policy — adopt the hidden feature, delete the shell (DG-7 ruled B)

**Files:**
- Create: `packages/identity/src/services/domain-policy.ts` — move `isDomainAllowed` (from `providers/PasswordProvider.ts:111`) and `hasEmailAlias` (`:133`) verbatim-as-pure-functions (exported, unit-tested standalone); keep exact AUTH_032/033/034 wire codes
- Modify: `apps/server/src/routes/auth.ts` register route — before the `routeTx` block (`:452`): validate email format, then `assertEmailDomainAllowed(email, config)` → on reject return the 4xx envelope with the kept code; NO user row may exist after rejection (RED asserts insert-count zero)
- Modify: `apps/server/src/config.ts` — add `authAllowedDomains: string[]` / `authBlockedDomains: string[]` / `authBlockEmailAliases: boolean` parsed from env (`AUTH_ALLOWED_DOMAINS` comma-list etc., empty/absent = allow-all — default-zero-destruction posture mirroring the three-level options pattern); `.env.example` gains the three keys with the ops note
- Delete: `packages/identity/src/providers/PasswordProvider.ts` + its registration `plugin.ts:38` + re-export `index.ts:43` (shell confirmed dead: `authenticate`/`register` both `throw new Error('Not implemented')` at :68/:97; NO route ever calls provider-based password auth — login uses `userManager.verifyPassword` directly)
- Keep for now: `PasswordConfig` type + defaults in `index.ts:89-100` are RETargeted or slimmed by the executor — whichever keeps tsc+tests green with minimum churn; document choice in commit body
- Modify (AUTH_032/033/034 rows — catalog currently carries them only as a spec-consistent RANGE row (`error-codes-reality.md:24`); promote to real wire rows now that live code emits them; per the T5 single-writer rule, hand the row content to T5 via this commit body if T5 has not yet landed, else write directly)
- Test: domain-policy unit (allow-list win-over-block edge, subdomain match semantics pinned from the old implementation, alias plus-pattern, empty-lists = allow-all); register-route test (blocked domain → 4xx + zero inserts; allowed → unchanged 201/pending flow)
- Commit: `feat(identity,server): wire domain-restriction policy into real registration path — retire dead PasswordProvider shell (R1-T9/DG-7)`

---

### Task 10: require-verified-email login gate (DG-8a ruled A)

**Files:**
- Modify: `apps/server/src/routes/options.ts` — add `'auth.require_verified_email'` to the KNOWN_KEYS allowlist set (near :57, after the Q4c block); value space `'true'|'false'`, default `false` via the three-level getter (`'false'` when unset — zero-breakage for existing tenants)
- Modify: `apps/server/src/routes/auth.ts` login — after `verifyPassword` resolves AND after the `passwordChangeRequired`/`enrollGate` arms (ordering decision: an unverified user must still be able to force-change and MFA-enroll — those flows are verification-adjacent); the gate must cover BOTH terminal session-issuance arms: the password final arm (before `issueTokenPair` :342) AND the `/mfa/verify` completion arm (`:~1708`) — re-review note 1: a password-arm-only gate leaks unverified+TOTP-bound users through step-up unchallenged. When option true && `user.emailVerified !== true` → 403 `{code:'AUTH_EMAIL_003'}` envelope with schema-DECLARED wire fields (fast-json-strip lesson PIT/T4-h), NO tokens issued, lockout NOT counted (password was correct)
- Channel rulings (recorded): password login = gated. SMS OTP + magic link = EXEMPT and additionally SET `emailVerified=true` on success (email/phone possession proven by delivery — magic-link consume path marks it). OAuth/SAML/LDAP = exempt (external IdP asserted the address); first-federation provisioning marks `emailVerified=true` at the find-or-provision site (user came from an authoritative directory) — executor verifies each provisioning site actually owns the flag write, else exempt-without-mark and say so in commit body
- Modify: `apps/admin-ui/src/pages/Login.tsx` — handle the 403 code: inline Alert (`login.emailNotVerified`) + resend button calling existing `POST /auth/verify-email/request`; en/zh locale parity
- Modify (same rule: AUTH_EMAIL_003 row to catalog — hand off to T5 if unlanded)
- Test: route matrix (off→login ok unverified; on+unverified→403 AUTH_EMAIL_003 zero tokens; on+verified→ok; on+unverified+passwordChangeRequired→force-change arm STILL reachable (anti-lockout ordering lock); on+unverified+TOTP-bound→`/mfa/verify` arm ALSO 403 (bypass lock, re-review note 1)); e2e: extend q1-self-service or auth spec with the gate mock; parity test guards locales
- Commit: `feat(server,admin-ui): auth.require_verified_email option gate — possession-proven channels exempt (R1-T10/DG-8a)`

---

### Task 11: Dead-config retirement sweep (DG-1b + DG-3 ruled B)

**Files:**
- Modify: `packages/identity/src/types.ts` — delete `idleTimeout` (4 sites: :188 comment+field, :201, :357, :364), `SsoConfig` (:222/:292/:355 area), trustedDevices config block; `packages/identity/src/index.ts` — delete defaults :171 and :121-124; grep-audit `apps/server`/`apps/admin-ui` consumers FIRST (audit verified: routes 0 hits; admin-ui 0 hits — identity-internal only)
- Modify: `docs/modules/auth-provider.md` header line — TrustedDevice/SsoSession groups marked `superseded (retired 2026-09-28 ruling DG-3: zero demand across two audits; revive only via proposal aligned with enforced-MFA semantics)`; session-lifetime honesty note lands in `docs/modules/identity-sdd.md` (its §session-management area; no standalone session-design module exists): "refresh tokens die at `expiresAt` (REFRESH_TTL 30 min current constant) — idle/sliding expiry NOT implemented (DG-1b); knob removed pending the session-lifetime batch"
- Modify: `docs/superpowers/reports/2026-09-28-gap-audit-round2.md` C3 wording correction — the "Settings UI implies the knob works" sentence is WRONG (grep shows the knob never reached the UI; dishonesty surface was types/config only). Record the errata IN the report (append correction line, do not silently rewrite)
- Test: tsc green is the test (deletion batch); vitest identity suite unchanged
- Commit: `refactor(identity)!: retire dead idleTimeout + TrustedDevice/SsoSession config surface (R1-T11/DG-1b+DG-3)`

> NOTE: DG-1 ruling was B-first-then-A. THIS task is only the B (delete the lie). The A (real sliding expiry) lives in the session-lifetime batch on the post-ruling ladder, its own spec. Likewise DG-7's "adopt" half is T9; DG-3's doc-retire rides here.

---

### Task 8: Batch gates + memory close-out

- [ ] **Step 8.1** Full gates: `pixi run npx vitest run` (≥1207 + new, 0 fail), `4×tsc --noEmit` 0, eslint touched files 0 error / 0 new warnings, `npx playwright test --project=chromium` 173+3 0 failed (expect +~2-4 from T6/T7), coverage job local floors hold.
- [ ] **Step 8.2** NOT-VERIFIED ledger in the report gets R1 annotations (e.g., T2 rollback proof level actually achieved — say which).
- [ ] **Step 8.3** Memory: status.md R1 line; conventions baseline flip in the same commit as the last count move (D126); new PIT only if discovered; CHANGELOG consolidated. Commit: `docs(memory): batch R1 close-out + baseline flips`

---

## Decision gates — RULED (2026-09-28, interactive per-gate ruling)

| Gate | Question | Ruling | Consequence |
|---|---|---|---|
| DG-1 (C3) | Idle/sliding session timeout | **B first, then A**: remove the dead `idleTimeout` knob (wizard/Settings/types/config) with absolute-expiry honesty note; real sliding expiry gets its own batch later | R-audit ladder slot: "session-lifetime" batch (last_used + renewal + sweeper) queued behind R1 |
| DG-2 (C1) | Audit tamper-evidence | **A wire it** — per-row content hash + day-anchored global roots (design revised in-spec from the original "prev_hash-in-row chain"; multi-node + erasure-hostile) + `GET /audit/verify` + sanctioned-erasure ledger + checkpoint semantics for retention pruning; capability boundary documented (app-layer/single-row YES, whole-span DBA rebuild only detectable via off-box anchor export). **U1 SUPERSEDED the ruling's "K-T1 tenant predicate" wording → /verify is PLATFORM-ONLY** (user-ratified 2026-09-28). | Spec RATIFIED: `docs/superpowers/specs/2026-09-28-r-audit-tamper-evidence-and-erasure-design.md` — U1-U9 all ruled A; MUST pair with DG-8b erasure (one hash format, two deliveries) |
| DG-3 (C2) | TrustedDevice/SsoSession | **B retire** — docs marked superseded, dead types/config exports deleted | Zero-consumer-demand evidence held (two audits, zero signals); future demand goes through a fresh proposal aligned with enforced-MFA semantics |
| DG-4 (H2/H3) | Multi-node posture | **A commit to multi-node, defuse both mines** — options pub/sub via existing cache-coherence infra + envelope-key re-encrypt tool + rotation runbook | R3 batch (own spec); also retroactively validates Q2c/Q3A multi-node investments |
| DG-5 (M12) | auth.ts split | **B: split immediately after R1 lands** — pure-move zero-behavior refactor (login / mfa+captcha / self-service / sessions+revocation), before the logout-coherence batch lands on top | Refactor batch sits between R1 and R-logout; any later auth feature batch consumes the new structure |
| DG-6a | Logout coherence | **GO** — RP end_session + SAML SLO + own-frontend session cleanup as the logout-coherence batch (3-5d incl. e2e); Q3D live-RP verification folded into the integration day (6f) | Scheduled after DG-5 split |
| DG-6b | private_key_jwt | **GO** — clientAuthMethods entry + clients zod acceptance + jwks persistence (cheap, mechanism verified in lib) | Joins the OIDC workstream (can ride the logout batch or its own mini-batch) |
| DG-6c | DPoP / JAR / RFC 8693 | **NO — explicit non-goal** recorded as a decision (position locked to standard enterprise OIDC/SAML base); revisit only on paying-customer demand via proposal gate | Protects roadmap from FAPI long-tail |
| DG-6d | Fine-grained permissions | **C middle path — data-scope hook** (self/dept/all) into requirePermission funnel, ~1 week; NO relation engine | New spec: data-scope semantics (dept source = groups? new org unit? — the spec must settle it); closes most row-level demand without FGA's quarter-scale cost |
| DG-6e | Branding + portal | **A full** — tenant branding (logo/color/sender) AND self-service portal visibility | Portal permission-boundary needs its own spec section (not a ride-along); sales-signal caveat recorded and overruled by user |
| DG-6f | NOT-VERIFIED debt | **GO integration day** after R1 — docker boot paths, ≤30s revocation live battery, device approval full-browser round, backup/restore drill, CI first-green (needs user's mirror push); external-credential items listed as procurement asks | Restores the credibility of every future "all green" claim |
| DG-7 | PasswordProvider dead shell | **B adopt-and-drop** — port the domain allow/block/alias validators (code + AUTH_032-035 exist) into the REAL register/email-change path; unregister the dead provider, mark superseded | Hidden enterprise feature (domain-restricted signup) goes 0%→100% for ~half a day; rides R1 or its first follow-up |
| DG-8a | emailVerified gate | **A switch** — `auth.require_verified_email` options key, default off, login pre-check + tests (~1 day) | Rides R2 session-semantics batch |
| DG-8b | RTBF × hash chain | **A+B combined, inside DG-2's spec** — sanctioned-erasure design (tombstone + erasure ledger, chain-integrity-preserving; SAP-ILM pattern) + the retention-period/legal-basis doc paragraph (GDPR 17(3)(e), 90d cap via existing sweeper) | Binding constraint on DG-2: chain hash format must accommodate tombstone rows from day one — designing them separately = guaranteed rework |

### Post-ruling batch ladder (supersedes the report's suggested ladder)

1. **R1 (revised)** — mechanical safety net T1-T7 + the three no-spec-needed rulings folded in as T9 (DG-7 domain policy), T10 (DG-8a verified-email gate), T11 (DG-1b+DG-3 retirement sweep); gates T8 last
2. **Refactor batch** — auth.ts split (DG-5), pure move
3. **Integration day** (DG-6f) — clears the six NOT-VERIFIED mines; CI first-green needs user action
4. **R-audit batch** (DG-2 + DG-8b) — spec: `docs/superpowers/specs/2026-09-28-r-audit-tamper-evidence-and-erasure-design.md` — chain format + anchors + verify endpoint + sanctioned-erasure ledger + retention legal docs
5. **R2 session-lifetime batch** (DG-1a) — last_used + sliding + sweeper, own spec
6. **R3 multi-node batch** (DG-4) — options pub/sub + key-rotation tool + runbook
7. **Logout-coherence batch** (DG-6a + 6b private_key_jwt) — lands on split auth structure
8. **Data-scope batch** (DG-6d) — spec settles "dept" semantics first
9. **Branding+portal batch** (DG-6e) — portal permission-boundary spec section mandatory

Explicit non-goals recorded: DPoP, JAR/JARM, RFC 8693 token exchange, full FGA/ReBAC engine (all revisitable only via proposal gate with paying-customer signal).
## Execution order & parallelism


R1 original: T1∥T2∥T4 parallel-safe (file-disjoint). T3 sequences after T1 (same auth.ts face) and after nothing else — identity `events.ts` is T3-sole. **T5 must run AFTER T3 lands** (it inherits the event names + conventions exception from T3's commit body — Momus R4 single-writer rule). T6 (admin-ui) and T7 (e2e) are disjoint from all server tasks.

Post-ruling additions: T9 touches auth.ts register route + identity provider/plugin — sequence after T3 (auth.ts face) and after nothing else; T10 touches auth.ts login + Login.tsx + options.ts — sequence after T9 (auth.ts face); T11 is deletion-only across identity types — sequence after T9 (the real identity-file sharer is T9 via `index.ts` config defaults — re-review note 3 corrected the earlier "after T1" attribution; T1 touches no identity file). Lanes: **A = T1→T3→T9→T10→T11** (all auth.ts/identity serial chain — the file-face collision family the ruling batch walked into), **B = T2∥T4**, **D = T6→T7**, **C = T5 after T3 (+ after T9/T10 for their catalog lines — T5 is the SOLE error-catalog writer, T9/T10 hand codes via commit bodies per R4 rule)**. T8 last.

Note T4 and T3 both ride `authDb()`/dispatcher pools but touch disjoint files.

## Completion criteria (post-revision)

All 11 tasks' commits landed; every R1 finding + every no-spec-needed ruling (DG-7, DG-8a, DG-1b, DG-3) carries a DISCHARGED stamp with commit hash in the audit report; both Momus verdicts' findings visibly resolved; gates green at their new baselines.

---

## Review record

- Momus (flows): **OKAY**, 1 nit — `auth.test.ts` nonexistent → fixed (routes.test.ts/mfa.test.ts named, Step 3.3, Files block).
- Momus (blockers): **APPROVE-WITH-FIXES**, R1 BLOCKER DomainEventType union (fixed: T3 identity file list + events.ts:33 verified), R2 HIGH gauge/alert arithmetic mismatch (fixed: true-backlog combined SELECT), R3 MED MfaManager has no close() + placement contradiction (fixed: utils/mfa-manager.ts over shared authDb(), reset hook, close-assertion removed), R4 MED T3/T5 same-file doc collision (fixed: T5 sole doc writer, sequenced after T3), R5 LOW swallow-invariant exception (fixed: in-code justification + conventions line). All five premises independently re-grepped by the controller before applying (events.ts:17-33 union confirmed, MfaManager.ts:34-43 no-close confirmed).
- **Scoped re-review #2 (post-ruling delta T9-T11, 2026-09-28): ALL-ADDRESSED** — non-blocking notes applied: note 1 MED (T10 password-arm-only gate leaked unverified+TOTP-bound users via `/mfa/verify` issuance :~1708 — gate now covers both terminal arms + bypass-lock test row), note 2 LOW (T9 "catalog-absent" wording imprecise — range row exists at error-codes-reality.md:24; reworded to promote-range), note 3 LOW (T11 lane rationale misattributed the identity collision to T1; actual sharer T9 — corrected). Batch executable as written.
