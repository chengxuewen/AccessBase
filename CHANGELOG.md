# Changelog

All notable changes to AccessBase. Format: keep-a-changelog style; versions tag on green CI (D122 mirror). Breaking changes get a `Migration` note with the SQL chain file.

## [Unreleased] — 2026-09-23
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
