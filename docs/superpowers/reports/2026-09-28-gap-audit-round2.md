# AccessBase Gap Audit — Round 2 (2026-09-28)

**Method:** five parallel lanes (design / market / ui / service / health) re-verified every 2026-09-23 baseline finding against current code (post-Q4d, f77048b) and hunted new gaps. Lead cross-checked all high-severity claims with independent greps; several lane claims were falsified and corrected in-wave (see "Retracted").

**Baseline discharge tally (deduped across lanes):**
- Section A (design): A1,A4,A5,A9 DISCHARGED (caveats) · A8 PARTIAL (over-delivered: webhooks+retention shipped) · A2,A3,A6,A7,A10–A14 STILL-OPEN (8 of them honestly annotated in doc headers)
- Section B (market): groups/SCIM-groups/webhooks/helpdesk/device-flow/captcha/MFA-enforcement/CIDR/token-version-revocation DISCHARGED · SSO trio, policy-engine extras, branding, LDAP-sync, Helm STILL-OPEN
- Section C (ui): dark-leaks swept, self-service pages shipped, server-side export DONE, verify-email/disabled filter fixed, i18n parity test exists · Consent redirecting key now shipped in BOTH locales (market #10 stale; ui #5 confirmed) — remaining Consent gap is only test coverage
- Section D (service): D1-D7 all PARTIAL (cores landed: tx funnels, advisory lock, drain, pub/sub perm-cache, metrics basics) · D8 (idle timeout) STILL-OPEN, zero progress
- Section E (health): vitest 972→1207, e2e 138→173, admin-ui unit 0→24, all convention gates PASS · auth.ts 1558→1959 (+26%), scim.ts 846 = new >800 violator

## Retracted during synthesis (PIT-076 worked)

1. "Device-flow input page throws 500 / is a dead-end" (market+ui initial) — FALSE. oidc-provider 9.12.2 `lib/helpers/defaults.js:56-97` ships a complete styled user-code input page incl. the form and error branches; Q3B integration green. Real gap: `provider.ts:124-136` sets no `userCodeInputSource/userCodeConfirmSource/successSource/renderFailed` overrides → browser gets library-default page (English-only, off-theme) and no e2e covers the approval round. CRITICAL → MEDIUM.
2. "Enabling private_key_jwt needs `features.privateKeyJWTHandlers`" — phantom key, zero grep hits in lib/. Real mechanism: `lib/shared/client_auth.js:40-48` dispatches on top-level `clientAuthMethods` against client `jwks`. M1 restated, much cheaper than feared.
3. ui-lane second-round claims NOT supported by grep: `components/tableColors.ts` + "#141414 table headers ×10" (file absent, `141414|fafafa|e6f7ff` zero hits in src) and "Consent.tsx:117 renders `$t()` as literal" (no such code). Real Consent state: `consent.redirecting` shipped en+zh; only untested. Dark-mode residual class survives only as isolated hexes (`EnrollMfa.tsx:101 #888`, Settings legacy). The "10/17 new pages zero e2e" count was ui-lane's own stale note; re-grep of e2e/ shows api-keys/events/email-templates/groups-crud/tenants-crud/webhooks-crud specs DO exist — remaining uncovered: MagicLogin, VerifyEmail, EnrollMfa, Profile (settings-level), q1 self-service partially. Corrected to U-batch below.
4. "login history table has no id column" (market #17) — moot: no login-history table exists at all (schema grep 0); re-filed as a feature gap, not a schema bug.

## CRITICAL — designed security promises still unwired

| # | Finding | Evidence |
|---|---|---|
| C1 | Audit tamper-evidence is fiction: logger computes hash-chain then it is discarded (no hash/prevHash columns in audit_logs, 12 cols), no verifyIntegrity caller, same PG role, no DB-level immutability (no REVOKE/WORM/append-only). §19.17 promise; header-disclosed honestly. | `packages/audit/src/logger.ts:26,54,116-134` vs `apps/server/src/app.ts:374-398`, schema.ts auditLogs |
| C2 | TrustedDevice + SsoSession groups: zero tables, zero implementations; SsoConfig/trustedDevices types/config still exported through plugin surface as dead weight. | identity `types.ts:222,292,355`, `index.ts:121-124`; grep 0 in schema |
| C3 | Session idle timeout unenforced (baseline D8, zero progress): `idleTimeout` has exactly one assignment site and NO reader; SessionManager validates absolute expiresAt only; no last_used column, no sliding renewal, no idle sweeper; refresh is hard-capped by 1800s (worse than the 14d design). Stolen-at-birth token lives to absolute expiry while the Settings UI implies the knob works. | `packages/identity/src/index.ts:171` (only non-type ref); `SessionManager.ts:113-118,128,207` |

- Erratum (R1-T11): C3's "Settings UI implies the knob works" sentence is wrong — the idleTimeout knob never reached the UI (grep 0 in apps/admin-ui); dishonesty surface was types/config only. Corrected on retirement.

## HIGH

| # | Finding | Evidence |
|---|---|---|
| H1 | MfaManager constructed PER REQUEST = live pool churn (PIT-081 family survivor, Q2a convention miss): `() => new MfaManager(requireMfaKey())` factory invoked in 6 MFA handlers; ctor dials createDb, pool never closed. One `??=` memo fixes. | `routes/auth.ts:87,1543,1559,1616,1631,1685,1755`; `MfaManager.ts:40-44` |
| H2 | OptionsManager cross-node staleness UNBOUNDED (no TTL, no pub/sub): self-documented `ponytail:` comment admits it; cache nulled only on LOCAL writes. Multi-node = forever-stale SMTP/captcha/MFA-enforcement/webhook-kill-switch/site.url. `cache-coherence.ts` infra already exists — cheap fix. | `OptionsManager.ts:15-18,57-76` |
| H3 | Envelope-key rotation = silent data loss: OIDC client secrets + webhook secrets derive from JWT_SECRET (scrypt), TOTP seeds from MFA_ENCRYPTION_KEY; rotating either renders ALL stored envelopes permanently undecryptable. No re-encrypt tool, no dual-key read, no runbook (grep 0; .env.example has bare key lines only). | `OidcClientManager.ts:24,32`; `services/crypto.ts:2-5` |
| H4 | Header discipline inverted: docs now UNDER-claim shipped surfaces. webhook.md:3 still says "design-only — zero code" (contradicts Q4c; verified this session); identity-sdd.md:3 "events absent" (27 emitEvent sites); audit-sdd retention claim stale since Q2a. api.md/database.md/security.md/ui.md cover none of the Q1–Q4 generation (groups/webhooks/events/enroll-mfa/captcha/invite all grep 0 there); docs/openapi.json frozen at Q2c (0 groups/webhooks/events paths); error-codes-reality.md missing ~8 live codes (AUTH_IP_002, CAPTCHA_001/002, EVENT_NOT_FOUND, ADMIN_* ×4) violating its own D126 rule. | `docs/modules/webhook.md:3`; catalog greps |
| H5 | auth.login.*/logout events: zero writers. Outbox shipped but the auth lane emits nothing — the single most-demanded webhook use case (login alerts) produces silence; "activity feed" story half-told. | grep `emitEvent` in routes/auth.ts = 0; Q4c deferral line |
| H6 | SSO lifecycle trio still open: no SAML SLO, no RP end_session, no OIDC-provider-facing logout at all; session.close() never called on logout so refresh-reuse detection stays dormant on the logout path. | `routes/oauth.ts` grep logout = 0 (verified) |
| H7 | Real-time revocation FAIL-OPENS on DB error (allow), unbounded, undocumented in any design doc, no reader-error metric; ≤30s memo makes "real-time" ≤30s at best; live battery NOT VERIFIED (Q3A self-note). | `utils/auth-state.ts:30` |

## MEDIUM

| # | Finding | Evidence |
|---|---|---|
| M1 | private_key_jwt + client jwks unsupported, and now known-CHEAP: top-level `clientAuthMethods` entry + accept `token_endpoint_auth_method`/`jwks` in clients.ts zod + persist via OidcClientManager. | `routes/clients.ts:16-23`; lib/shared/client_auth.js:40-48 |
| M2 | Tenant suspend/delete cascade non-atomic + wrong db handle: bumpAuthState runs on raw pool even when a tx handle was passed; revokeTenantAccess outside tx; DELETE route unwrapped → suspended tenant with live sessions/keys on mid-failure. | `TenantManager.ts:186-193` |
| M3 | Webhook dispatcher has ZERO metrics (queue depth, outbox lag, ok/fail/dead counters, tick duration) and no alert rules — dead endpoints/backlog grow silently until someone opens the UI. | `utils/webhook-dispatcher.ts` |
| M4 | Q2a singleton convention half-followed: 6+ route files `new UserManager()/new RoleManager()` at module scope, duplicate SessionManager×6 + PermissionManager×3 plugin instances, oauth/webauthn/saml route pools absent from onClose. Worst case ≈ 35 pools × PG_POOL_MAX conns/node. | grep census (service-lane D2 list; health-lane #3) |
| M5 | PasswordProvider registered in AuthManager but terminates in `throw new Error('Not implemented')` (lines 68/97) — advertised provider that cannot serve; login bypasses AuthManager entirely (direct verifyPassword). Finish or unregister. | `plugin.ts:38`; `PasswordProvider.ts:68,97` |
| M6 | Unpaginated list endpoints: clients, api-keys (also `total` absent → UI paginates locally, list caps at whatever client fetches), options, groups. No shared pagination helper (audit vs events duplicated). | `routes/api-keys.ts`; `audit.ts:93-105` vs `events.ts:107-116` |
| M7 | Device-flow browser UX: library-default English-only pages (4 render hooks un-overridden), off design system, dark-mode mismatch, no e2e for approval round. | `oidc/provider.ts:124-136` (grep userCode*=0) |
| M8 | Revocation semantics undocumented (A1 caveat): design promises pub/sub-kill, reality = DEL + ≤30s memo + fail-open; never written into auth.md/security.md. | `utils/auth-state.ts:17,30` |
| M9 | emailVerified projection-only forever: no login gate, no policy knob (grep requireVerified = 0); right-to-erasure incomplete — UserManager.delete hard-cascades users but email/name persist in audit_logs varchars (no anonymization). | `UserManager.ts:245` |
| M10 | Compliance/policy surfaces absent (market M-class): SoD rules, per-endpoint audit opt-out registry (dead allowlist code), approval workflow, per-user session self-inspection, custom claims per client, act-as/impersonation. | greps = 0 |
| M11 | Design-system drift (real subset after retraction): isolated hardcoded hexes (EnrollMfa #888, legacy sites), raw TextArea for jsonb options/bilingual email HTML with no variable-interpolation hints (options.ts:105 zod demands objects; templates demand {en,zh} objects). | `EnrollMfa.tsx:101`; `settings/EmailTemplatesCard.tsx:251` |
| M12 | Monolith growth: auth.ts 1959 (+26% since baseline — split recommended FIRST, batches added routes instead), scim.ts 846 new >800 violator. | `wc -l` |
| M13 | i18n design (A7) unchanged both ends: no server-side localization, errors English-only; parity test exists (i18n/__tests__/parity.test.ts — DISCHARGED vs prior note) but coverage thin. | `i18n/index.ts:8` |
| M14 | api.md §23.10 API-key contract drift (flat scopes vs {resource,actions[]} + per-key rateLimit); WebAuthn challenge TTL 300s vs design 60s (5x window); optimistic-lock `version` unimplemented; no login-history/last-login tracking at all. | `schema.ts:434`; `webauthn.ts:42` |
| M15 | No OTel tracing / log-shipping ops story; prometheus rules sample not wired; no scrape config in compose. | D4 residues |
| M16 | No k8s artifacts (Helm/Deployment/preStop guidance); drain.ts defers to a nonexistent ops doc. User-gated on docker-day. | D3 residue |
| M17 | SCIM pagination ceiling: startIndex page-intersection drops tail members >500 (ponytail: comment present; correct-but-wrong under scale). | `routes/scim.ts:558,748` |
| M18 | Rotate-secret / destructive-admin actions without confirmation (Clients rotate, webhook rotate/ping, API-key create long-token-in-state); no bulk ops anywhere in admin-ui. | ui-lane #25/#32/#35 (spot-verified EnrollMfa recovery preview :102-105) |
| M19 | Q3D back-channel logout has no UI path: server accepts backchannel_logout_uri (routes/clients.ts:72,121) but Clients.tsx never renders the field (grep 0 — market-lane's "UI exposes it" discharge was WRONG, ui-lane right). Feature invisible to admins. | `pages/Clients.tsx` |

## LOW (selected)

- L1 SCIM `members` ref pre-validation absent on POST/PATCH members (per user-lane); 1000-member groups unhandled.
- L2 e2e gaps (corrected roster): MagicLogin, VerifyEmail, EnrollMfa full round, device approval round, user session view n/a; api-keys/events/groups/tenants/webhooks/email-templates DO have specs.
- L3 auth.spec mounts /login without sms/status+saml/status mocks (PIT-080 latent).
- L4 Type-safety stable: as-any 7 (audit-lane), non-null 2 (genericConfig!), 1 new eslint-disable (SmsProvider); test.fail=0 ✓.
- L5 Dead code: SsoConfig/trustedDevices types, `if(false)` branch options.ts:128, @accessbase/admin zero consumers yet shipped in build.sh:43, i18n L0 package 0 consumers, UserGroups.test.tsx excluded from vitest globs.
- L6 No Idempotency-Key anywhere; no bulk operations; login history/last-login absent; SMS verify step no client timeout.
- L7 Dispatcher stop() doesn't await in-flight tick (at-least-once duplicates on redeploy, undocumented).
- L8 FlowToken memory-fallback cross-node semantics (safe fail-closed, documented); Redis single-host no sentinel decision never recorded.
- L9 Profile.tsx 333 lines (not 214), 14 inline t() calls, 4 hardcoded hexes; Tenants/Events unformatted jsonb columns.
- L10 Count drift: AGENTS.md "43 module docs" vs 44; conventions check headline "24" vs live 26.
- L11 CI first green run still NOT VERIFIED (D122, awaiting user push to mirror).
- L12 Options value editor + email template HTML use raw TextArea with no json/variable hint (options.ts:105 demands objects; TemplatesCard:251); Tenants/Events show unformatted jsonb; EnrollMfa reveals recovery codes before confirming authenticator install.

## NOT-VERIFIED ledger (carried + new)

docker integration day (boot paths) · CI first green run · Q3D back-channel live RP · live ≤30s revocation battery (Q3A) · device approval full-browser round · SMS/SMTP/LDAP/SAML-IdP external credential verification · deploy-mode trust + tag-pin backlog (P wave 3) · offsite backup drill.

## Suggested remediation ladder (pending user batch decisions)

- **R1 quick-win safety net (S):** H1 one-line memo · M2 cascade tx-handle · H5 auth.login.*/logout events (funnels exist) · error-catalog regen + header-refresh sweep + openapi regen + CHANGELOG (all mechanical, one docs batch) · logout calls session.close() (H6 quarter of it) · L10 count parity. Mechanical, TDD-able in a day.
- **R2 session & revocation semantics (S-M):** C3 paired decision — implement idle/sliding expiry (last_used + sweeper) or honestly remove the knob from wizard+Settings+types; M8/H7 document fail-open + bounded-30s posture in design docs + reader-error metric; M9 emailVerified gate knob decision; M5 PasswordProvider finish-or-unregister ruling.
- **R3 multi-node correctness (M):** H2 options pub/sub (infra exists) · M3 dispatcher metrics + webhook alerts in rules.yml · H3 envelope-key re-encrypt tool + rotation runbook · M4 getter-convention sweep + onClose pool roster · L7 graceful dispatcher drain.
- **UI closure batch (M):** M7 branded device pages (4 source overrides + i18n + dark) + approval-round e2e · M11 textarea hints (json + template variables) + #888→token · M18 rotate confirmations · M6 shared pagination helper + retrofit · L2 e2e roster · MFA recovery-code download step · Profile hex cleanup.
- **R5 market bets (L, product decisions first):** H6 full "logout coherence" batch (SAML SLO + RP end_session + /v2/me + front-channel) · M1 private_key_jwt (now cheap) · DPoP/JAR decision · breach-list check · TOTP URI export · act-as · SoD/approval workflows · per-user session list · custom claims · M10 compliance batch · branding/portal (sales-gated) · Helm + docker-day (ops-gated) · C1/C2 — the last two CRITICAL design promises: decide wire-or-retire per D126 honesty ladder.

Standing residues (unchanged from round 1): docker integration day, CI first green run, external-credential live verifications.

---

## Batch R1 discharge ledger (2026-09-28, commit-stamped)

H1→58e4da0 · M2→c6f6d5a · H5→6f434fe · M3→46239e6 · M19+L3→062b60d · C2/C3(DG-3/DG-1b retirement)→582fdb4 · DG-7→ba71389 · DG-8a→7fbf7e3 · H4→76a26ae. Erratum C3 applied inside 582fdb4. C1 → R-audit spec `docs/superpowers/specs/2026-09-28-r-audit-tamper-evidence-and-erasure-design.md` (rev.3 RATIFIED, awaiting its own plan). U1-U9 decision ledger in the plan §Decision gates. NOT touched by R1 (deferred per ruling): auth.ts split (next batch), integration day, options pub/sub + key-rotation tool (R3), logout coherence (R5), data-scope, branding/portal, SAML SLO, private_key_jwt (cheap, queued), DPoP/JAR/8693 (non-goals), FGA engine (non-goal; data-scope middle path instead).

Gates at close-out: vitest 1250/1250 (115 files, workers auto) · e2e chromium 173+3 0 failed (workers=1) · 4×tsc 0 · eslint 0-new · D126 header gate empty · seed count 26 · openapi 99 paths.
