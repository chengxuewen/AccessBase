# Batch H′ — Debt Cleanup + Test Signal Hygiene (Design)

**Status**: Proposed 2026-09-16
**Origin**: Backlog accumulated across batches E/F/G + recurring test-signal noise (3 PG-down vitest failures re-A/B'd in every batch gate since batch C)
**Level**: Bounded (all items pre-adjudicated in prior task reviews; no new architecture)

## 1. Test signal hygiene (highest leverage)

### H′1: PG-required vitest tests get health-probe conditional skip

- `mfa-integration.test.ts` + `oidc-flow.test.ts`: beforeAll probes PG reachability (`pg.Client.connect()` try/catch on the configured DATABASE_URL) → unreachable → `describe.skip('real PG not running — NOT VERIFIED per testing.md')` (health.spec.ts e2e precedent :15). Tests keep running when PG IS up (native dev default).
- `security.test.ts` rate-limit 429→423 case: timing-fragile under load. Fix root: assert on `retry-after` header presence + status in `[429, 423]` (both mean limited; 423 arises when lockout middleware co-fires at the boundary), OR isolate with `vi.useFakeTimers` if the assertion can be made deterministic. Implementer judges smallest honest fix; document choice.

### H′2: Recurring-gate command (one-liner doc)

- conventions.md: add the batch-gate vitest expectation line (`vitest apps/server` = 352/0/7-skipped with PG up; = 349-passed+3-file-skipped with PG down) so future controllers stop re-deriving baselines.

## 2. Security-flavored backlog items

### H′3: Magic-link Host poisoning mitigation (batch F Low, upgraded)

- `routes/auth.ts:701` — request-origin fallback arm accepts attacker-controlled Host. Fix: accept `x-forwarded-host` ONLY when `TRUST_PROXY=true` (config), else use `Host` but VALIDATE against a same-origin allowlist: options `site.url` and env `SITE_URL` must both be unset AND `TRUST_PROXY` unset → refuse to build link from request Host (log warn + send generic link text without URL? No — send link with the CONFIGURED origin only; when no configured origin exists, fall back to request Host but log a loud warning + document in .env.example that production MUST set SITE_URL). Minimal honest fix: origin resolution order becomes site.url → SITE_URL → (TRUST_PROXY ? x-forwarded-host : host) with a one-time warn log when falling through to request Host. Test: poisoned Host header + no config → link uses Host (current behavior, warning logged); + TRUST_PROXY → x-forwarded-host.
- ops note in .env.example (production must set SITE_URL or accept Host-trust risk).

### H′4: SMTP async send (batch F enumeration-timing Low)

- `mailer.send()` awaited inline in magic/request → response latency = SMTP RTT (timing side-channel). Fix: fire-and-forget with `.catch(err => logger.warn({err},'magic link send failed'))` — response returns immediately, send completes async. Node process lifetime covers delivery (send is seconds, not minutes). One-line change + comment.
- Same pattern already on forgot-password? Check — if forgot-password also awaits inline, apply same fix for consistency (both are enumeration-timing surfaces).

### H′5: login 200 schema `user` declaration (batch G-T3 finding, needs真后端验证)

- Login 200 response schema omits `user` → fast-json-stringify may strip it on the wire. Frontend hydrates from /auth/me so no user-visible breakage, but the schema lies about the contract. Fix: declare `user` in the 200 schema (mirror saml/magic consume union shape). Verification: vitest asserting decoded login response contains user (schema-strip behavior is deterministic in Fastify — if the test passes post-fix and failed pre-fix, the stripping was real).

## 3. Code hygiene (small, pre-adjudicated)

### H′6: BATCH of one-liners from E/F/G backlogs

- `oauth.test.ts` shared stub — DONE in batch F (skip if already fixed; verify).
- saml.ts/saml.test.ts TTL-300 assertion — DONE in batch G T6? verify and skip if present.
- `AUTH_SAML_003` dead code — document the fold-into-002 ruling in a comment (spec non-goal note) OR remove from any doc references; comment-only.
- e2e R2 single-flight flake: replace `waitForTimeout(5000)` with `expect.poll` (batch G-T4 Low).
- `Login.tsx` `setOauthBusy` naming (SAML exchange reuses oauth busy state) — rename to `authBusy` if zero e2e/test impact, else skip.
- MagicLogin 403 AUTH_004 suspended → distinct copy from 401 (batch F-T4 Low): map `error.code === 'AUTH_004'` → i18n 'account suspended' message.

## Non-goals

- SCIM / SMS / FK constraints / cross-tenant provisioning (batch H proper)
- compose prod env_file, multi-instance Redis CacheProvider (ops-time items, noted in backlog)
- slug-conflict label split (API contract change, needs consumer survey)

## Constraints

- All items TDD where testable; e2e precheck discipline; PIT-048/051/053/054 standing
- H′5 changes a production response schema — full e2e + 双闸 tsc mandatory
- Bounded level: no dual-Momus (all items carry prior review rulings); single Momus plan review if dispatch briefs surface new interactions
