# Changelog

All notable changes to AccessBase. Format: keep-a-changelog style; versions tag on green CI (D122 mirror). Breaking changes get a `Migration` note with the SQL chain file.

## [Unreleased] — 2026-09-24
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
