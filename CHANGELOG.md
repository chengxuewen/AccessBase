# Changelog

All notable changes to AccessBase. Format: keep-a-changelog style; versions tag on green CI (D122 mirror). Breaking changes get a `Migration` note with the SQL chain file.

## [Unreleased] - 2026-10-08 (batch data-scope: self/dept/all row scopes, DG-6d middle path; spec docs/superpowers/specs/2026-10-08-data-scope-design.md rev.3, rulings A1-A6 all ratified)
### Added
- Data-scope per role-permission binding: role_permissions.data_scope ('all' default = zero behavior change) with widest-wins resolution across roles/inheritance/groups (total-order lattice, both dedup sites fixed). Departments are kind-marked groups (groups.kind 'group'|'department'); membership reuse of group_users means no new tables.
- Row-level enforcement on the users surface: list/export filter via scope predicate (dept = members of the caller's department groups UNION self; empty-dept degrades to self, never tenant-wide), every row op guarded (403 DATA_SCOPE), create/invite/import require tenant-wide scope, and the RTBF erase arm (eraseAudit) escalates to scope=all checked BEFORE the tx/lock (a dept manager may delete an account, never scrub the shared audit trail).
- API-key machine lanes are explicitly tenant-wide (the row guard short-circuits before any user lookup); GET /roles/:id projects permissionScopes for users:* bindings; Groups editor gets an Is-department switch, Roles editor a data-scope Select with an honest 'Mixed' sentinel when stored bindings diverge.
- Migration 0013 (data_scope + kind, dual SENTINELS), 403 DATA_SCOPE in the error catalog, integration proof on real PG (dept list matrix, B3 projection round-trip test).


## [Unreleased] - 2026-10-08 (batch logout-coherence: SAML SLO + RP end_session + provider private_key_jwt; spec docs/superpowers/specs/2026-10-08-logout-coherence-design.md rev.2)
### Added
- SAML SP Single Logout both directions: three-arm GET/POST /api/v1/auth/saml/slo (IdP-initiated LogoutRequest -> revoke-all + signed LogoutResponse; SP-initiated completion -> 302 /login; uniform SLO_FAILED posture) + GET /api/v1/auth/saml/logout; saml link persistence (nameID/sessionIndex at ACS); new options saml_logout_url/saml_slo_callback_url; metadata advertises SingleLogoutService; Redis node-saml cacheProvider (ab:saml:req:*) also roots the pre-existing per-request-instance InResponseTo defect (R6).
- RP-initiated end_session for generic OIDC providers: endSessionUrl config (https-only), id_token persisted on EVERY generic login (existing links upserted - R4), GET /api/v1/auth/oauth/end-session-url.
- /auth/logout returns data.idpLogoutUrl (SAML-first, RP fallback, fail-soft); SPA logout one-hops to the IdP when present.
- Provider-side private_key_jwt: oidc_clients.jwks (migration 0012) + create-time CLIENT_008 whitelist, CLIENT_009 none-vs-client_credentials/device gate, CLIENT_010 usable-jwks requirement, CLIENT_011 kty public-member allowlist; adapter passthrough; real client_assertion roundtrip integration-proven.
### Fixed
- Audit redactor covers idpLogoutUrl responseBody material (B4); SLO GET-binding requires Signature+SigAlg route-side - node-saml silently accepted unsigned redirect LogoutRequests (B1 forged-logout hole closed pre-ship).
### Docs
- openapi 99 -> 103 paths (3 new + 2 catch-up: audit-logs/verify from R-audit, interaction path renamed by the P1 prefix move); multi-node runbook gained SAML cache + SLO dedup rows.

## [Unreleased] — 2026-10-08 (batch multi-node: options coherence + envelope key versioning + dispatcher drain)
### Added
- R-A cross-node options-cache coherence: OptionsManager writes announce on `ab:options:invalidate` (module-level publish hook, permission-cache precedent); server-side `utils/options-coherence.ts` registers the publisher + subscriber (drops the local cache with `fromRemote` marking — never re-announces) and is a silent single-node no-op when Redis is absent or the identity lane is mocked; wired in app boot with `onClose` teardown.
- R-B envelope key versioning: MFA TOTP (`services/crypto.ts`) and OIDC-client/webhook secrets (`OidcClientManager`) now write `v2:` envelopes (per-record salt, HKDF info separation so v1/v2 keys never collide); readers accept bare/`v1:`/`v2:` and fall back to optional `JWT_SECRET_OLD` / `MFA_ENCRYPTION_KEY_OLD` on GCM auth failure — key rotation stops destroying data. Deferred: `re-encrypt` pass tool (registered debt, runbook).
- Runbooks: `docs/runbooks/multi-node.md` (topology prerequisites, Redis-absent degradation table, per-node worker safety, coherence channels, shutdown order, scaling smoke) + `docs/runbooks/key-rotation.md` (rotation-window procedure).
### Fixed
- Webhook dispatcher `stop()` drains the in-flight tick before closing the pool — a mid-POST shutdown now lands the outcome UPDATE (at-least-once, never half-sent).


## [Unreleased] — 2026-09-29 (batch session-lifetime, spec docs/superpowers/specs/2026-09-29-session-lifetime-idle-expiry-design.md rev.2)
### Added
- Session idle expiry, end to end: `sessions.last_used_at` (migration 0011), idle predicate inside the guarded rotate WHERE (idle-expired = `AUTH_003` 401, provably never misclassified as replay by the D125 classifier), slide delivered by the rotate-insert column default; knob `session.idle_timeout_seconds` (env `SESSION_IDLE_TIMEOUT_SECONDS`, default 86400, 0 = off, config-plane failure = off), Settings Security-tab select (options:write gated), en/zh.
### Fixed
- oidc-rate-guard test adapted to the P1 interaction-prefix move (`/api/v1/oidc/*`).
### Docs
- identity-sdd session-semantics line superseded (REFRESH_TTL corrected to 7d; the earlier 30-min claim was wrong).

## [Unreleased] — 2026-09-28 (batch R-audit, tamper-evident audit chain + sanctioned erasure; spec docs/superpowers/specs/2026-09-28-r-audit-tamper-evidence-and-erasure-design.md rev.3)
### Added
- Tamper-evident audit chain, end to end: every audit row is content-hash sealed at write time (`row_hash` over a canonical-json field set, with the writer's own timestamp persisted so writer and verifier hash the same bytes); a daily anchor table folds the ordered row hashes into one root per `(day, seq)` chained by `prev_root`, gated by `pg_try_advisory_xact_lock(727242)` so only one node folds per pass; a one-time boot backfill hashes pre-existing rows and the retention sweeper marks fully-pruned anchors `pruned_at` before deleting their rows, so age-based pruning never reads as tampering.
- `GET /api/v1/audit-logs/verify?from=&to=` (platform tenant only, reuses `audit:read` — zero new permission codes; 200 even when `chainOk:false`): re-folds every anchor in the window, verifies erased rows against their receipt instead, and reports `rowsChecked`, `rowsErased`, `erasedLegacyUnhashed`, `legacyPreChain`, `anchorsChecked`, `prunedFrom`, `unanchoredRows`, `chainOk`, `firstFailure` (`{day, seq, kind, rowId?}`). The unanchored check doubles as an anchor-worker stall watchdog. Audit page gains a Verify button with a green/red report alert.
- Sanctioned RTBF erasure: `UserManager.eraseAuditData` writes a receipt-bound `audit_erasures` ledger row (`receipt_hash` fingerprints the pre-erasure `row_hash` set), scrubs PII columns while never touching `row_hash`, `anchor_id`, `created_at` or provenance, tombstones the matching outbox rows in the same transaction, and emits `audit.erased`. `DELETE /api/v1/users/:id` gains an explicit `{ eraseAudit: true, legalBasis }` opt-in (default off; 400 without a stated basis; 409 `ERASE_LOCK_BUSY` when the anchor worker holds the lock, nothing written, retryable).
- Ops: chain file `0010_early_odin.sql` (`audit_logs` +4 nullable columns, `audit_chain_anchors`, `audit_erasures`) with its `scripts/migrate.sh` sentinel (25 tables / 11 tracked rows); config `AUDIT_ANCHOR_INTERVAL_SECONDS` (300), `AUDIT_ANCHOR_GRACE_SECONDS` (90), `AUDIT_ANCHOR_EXPORT_PATH` (optional append-only off-box root ledger); metrics `accessbase_audit_anchor_last_root_ok` and `accessbase_audit_anchor_last_root_timestamp_seconds`; alert `AccessbaseAuditAnchorStalled` (>3x interval).
### Breaking
- `@accessbase/audit`: `AuditLog` / `AuditLogEntry` drop `hash` and `previousHash` and gain `rowHash?` (one consumer, `apps/server`, migrated in the same commit); `AuditLogger`'s in-memory chain is deleted. `verifyIntegrity` was never in the library and remains absent by design — server-side anchor verification replaced it.
- Wire: `DELETE /api/v1/users/:id` now accepts an optional body (`{ eraseAudit, legalBasis }`). Plain deletes are unchanged; no new permission codes.


## [Unreleased] — 2026-09-28 (batch R1 "quick-win safety net", plan docs/superpowers/plans/2026-09-28-batch-r1-quick-win-safety-net.md)
### Added
- Auth-lane telemetry events: `auth.login.success` / `auth.login.failure` / `auth.logout` on the Q4c outbox (password / TOTP / admin-wizard lanes; the remaining sign-in channels are on the R-schedule). Fire-and-forget from `apps/server/src/utils/auth-events.ts` — the one sanctioned swallow exception to the funnel-emit rule.
- Registration domain policy is live: `AUTH_BLOCKED_DOMAINS` wins first, then `AUTH_ALLOWED_DOMAINS` (empty = allow-all; exact whole-domain match, no subdomain implication), and `AUTH_BLOCK_EMAIL_ALIASES` (default on) rejects '+' local parts — rejections answer 403 `AUTH_033` / `AUTH_034` at the door with zero user rows written.
- `auth.require_verified_email` option gate (default off): unverified users are refused `AUTH_EMAIL_003` on BOTH terminal arms (password login and MFA step-up completion), while force-change and MFA-enroll stay reachable (anti-lockout ordering); possession-proven channels (SMS OTP, magic link, OAuth/SAML/LDAP provisioning) are exempt and mark the address verified.
- OIDC clients: back-channel logout URI editable in the Clients page (server surface landed in Q3D).
- Webhook dispatcher observability: per-outcome delivery counters + true-backlog count/age gauges on `/metrics`, with two alert rules in `docker/prometheus/rules.yml`.
### Fixed
- Tenant suspend/delete cascades now run on the caller's transaction handle — a mid-failure can no longer leave a suspended tenant with live sessions and API keys.
- Last per-request pg-pool churn of the PIT-081 family: `MfaManager` is memoized per process over the shared auth pool.
### Removed (breaking — TypeScript surface only, no SQL chain file)
- Dead config retired (R1-T11): `SessionConfig.idleTimeout`, the `SsoConfig` trio and the trusted-device block, plus the `SSOSession` / `LocalSession` / `TrustedDevice` interfaces and the never-serving `PasswordProvider` shell (its domain/alias validators moved to `packages/identity/src/services/domain-policy.ts`).
### Documentation
- Honesty wave: 5 under-claiming module headers corrected (webhook / identity-sdd / audit-sdd / self-service / messaging) + 4 coverage pointers added (api / database / security / ui); error-code reality catalog reconciled to the emitters (12 live codes added, 3 over-claims corrected, regen block taught to catch helper-shaped emits); `docs/openapi.json` regenerated (77 → 99 paths); module-doc count parity 43 → 44.

## [Unreleased] — 2026-09-24
### Added (Q4d events history surface)
- `GET /api/v1/events` + `/api/v1/events/:id` (tenant-isolated, type/date filters, paginated) reusing the `audit:read` code — zero new permission codes; Events admin page (family tags, fan-out status, payload detail modal) + e2e.
### Added (Q4c events outbox + webhooks + email templates, spec docs/superpowers/specs/2026-09-24-q4c-events-webhooks-templates-design.md)
- Durable `events` outbox emitted at every manager mutation funnel (users/roles/tenants/apikeys/groups) atomically with the write; age-based retention prune (`WEBHOOK_RETENTION_DAYS`).
- Per-tenant webhooks: `/api/v1/webhooks` CRUD + rotate + test-ping + deliveries ledger; HMAC-SHA256 signed dispatch with exponential backoff (dead@10), fail-closed SSRF guard (loopback/link-local/metadata + IPv4-mapped canonicalization), `webhooks_enabled` kill-switch, admin page with reveal-once secrets.
- Bilingual email templates: 4 transactional templates (verify/reset/magic/invite) options-backed as jsonb objects, `{{var}}` renderer with HTML escaping, Settings editor + preview + test-send; all four mail lanes migrated.
- Codes 24→26 (`webhooks:read/write`, tenant-bindable partition 14).
### Added (Q4b user groups + SCIM /ScimGroups, spec docs/superpowers/specs/2026-09-23-q4b-groups-scim-design.md)
- User groups: `groups`/`group_users`/`group_roles` tables (chain 0008), GroupManager CRUD + membership + role bindings, admin API `/api/v1/groups` (groups:read/write/delete, 21→24 codes), Groups admin page (members drawer, role bindings, permission gates).
- Effective-roles chokepoint `getEffectiveRoles` (direct ∪ group, deduped) now drives permission resolution, the enforced-MFA `admins` policy arms, and CSV export role columns; UserEdit prefill intentionally keeps direct roles.
- Last-admin census made group-aware on both sides: revoking membership / unbinding group roles / deleting a group can no longer orphan a tenant of its only active admin (409 LAST_ADMIN_GUARD, same funnel discipline as direct grants).
- SCIM 2.0 `/ScimGroups` resource: list with `displayName eq`/`id eq` filters + startIndex paging, full CRUD, RFC 7644 PATCH (`members`, `members[value eq]`, `displayName`), R4 lock — groups bound to the built-in admin role are read-only over SCIM.
### Added (Q0-Q2a gap remediation, docs/superpowers/reports/2026-09-23-gap-audit.md)
- Self-service surface: forgot-password / reset-password / register (pending) / verify-email pages; SMS OTP login tab (strict gate); Users tri-state filter; Profile verification banner.
- `GET /api/v1/auth/sms/status`; verify-email request/consume endpoints (`AUTH_EMAIL_001/002`); `/auth/me` + `/users/me` expose `emailVerified`.
- Helpdesk (Q4a): admin password reset (temp + force-change arm + session revoke + ≤30s bearer kill), set-password invitation email (72h single-use), login force-change handoff wizard.
- Policy engine (Q3E): `mfa_enforcement` (off|admins|all) with the enroll-wizard login handoff, `captcha_enabled` (self-hosted SVG challenge on register/forgot/magic/SMS), `auth_cidr_allow`/`auth_cidr_deny` network admission; codes AUTH_MFA_004, CAPTCHA_001/002, AUTH_IP_002.
- Ops: migrate.sh single advisory-locked session (concurrent-safe); retention sweeper (audit days + expired sessions, `AUDIT_RETENTION_DAYS`); session-cache TTL backstop; readiness drain on shutdown; `/metrics` gains pg-pool / auth-failure / degraded gauges; sample Prometheus rules (`docker/prometheus/rules.yml`); `PG_POOL_MAX`.
### Fixed
- sms-otp wire chain: request now returns the flow token (the login flow was uncompletable over HTTP).
- Per-request pg-pool leak (route managers + setup guard) — process singletons + `resetManagers()` seam.
- users `sortBy` was advertised but ignored; now whitelisted asc/desc.
- Audit export button exported only the visible page; now hits the server tenant-safe export.
- `GET /api/v1/users` fake-sort contract; dark-mode leaks on chrome-less shells; consent raw i18n key.
### Breaking
- None. (`/metrics` and audit payloads unchanged; new response fields are additive.)
