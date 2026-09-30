# Session-Lifetime Batch — Real Idle/Sliding Expiry (DG-1a)

**Date:** 2026-09-29 | **Status:** rev.2 — dual-Momus absorbed (flows lane rejected on artifact-type grounds, no technical content; blockers APPROVE-WITH-FIXES B1-B4 all applied below + review record at foot) | **Ruling basis:** DG-1 (user, 2026-09-28): "B first, then A" — B (dead `idleTimeout` knob removal) shipped in R1-T11; THIS spec is the A half. Positioning: follows auth.ts split + R-audit batch.

## 1. Problem (the honest ledger, corrected)

R1-T11 removed the phantom `idleTimeout` knob. The surviving reality: sessions die ONLY at absolute expiry, and the T11 doc line "REFRESH_TTL fixed 30 min" was itself wrong — `REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000` (SessionManager.ts:15, SEVEN DAYS). Stolen-at-birth refresh tokens live 7 days regardless of inactivity. Access tokens are 15-min JWTs (unstated but relevant: the blast radius of a stolen access token is already bounded; the refresh token is the durable prize).

Design-doc mismatch: identity-sdd.md promised idle+absolute ("30 min idle / 14 day absolute" era numbers) — both numbers stale. This spec replaces that promise with the shipped contract and one new knob.

## 2. Goals / Non-goals

**Goals**
- G1: Inactive sessions die: a refresh token unused for `sessionIdleSeconds` becomes unusable (401 family), even though its absolute expiry has not passed.
- G2: Active sessions keep living: any successful refresh SLIDES the idle window forward (updates a `last_used_at` column; refresh is the only idle touchpoint — see D2 ruling).
- G3: Absolute ceiling survives: sliding NEVER extends past `expiresAt` (7d from issuance). Idle expiry ⊆ absolute expiry, always.
- G4: Zero config-plane bricks: knob is options-backed (3-tier, default on with sane value); config-plane failure = idle enforcement OFF (fail-open for availability, consistent with mfa-policy/captcha precedent), never a login outage.
- G5: The knob is REAL and visible: Settings + wizard render it (restoring an honest version of the UI R1-T11 deleted), backed by a live reader.

**Non-goals**
- No per-tenant overrides (the T11-retired tenantOverrides shape stays retired; single global knob).
- No absolute-TTL configurability (7d stays a constant; changing it is a one-line PR, not a knob — YAGNI until a customer asks).
- No access-token changes (15-min JWT expiry already bounds it).
- No SSO/trusted-device semantics (retired DG-3).
- No sweeper: idle-expired rows keep their absolute `expires_at` (7d) and are cleaned by the EXISTING retention sweeper, whose predicate is `expires_at < now() - SESSION_GRACE_DAYS(30d)` (retention-sweeper.ts:19,66) — so an idle-killed row lingers ~37d post-issuance worst-case. Row-count growth is bounded by rotation churn and accepted (B4 citation corrected; conclusion unchanged — `last_used_at` needs no separate cleanup, it dies with the row).

## 3. Design

### D1 — Schema: one column, one migration

`sessions.last_used_at timestamp with time zone NOT NULL default now()` — chain file 0011 (v7 generate ritual, SENTINELS entry probing `last_used_at`, ops flip 11→12, dev db:push). Defaults to `now()` so INSERT paths need no change on day one.

### D2 — Semantics rulings (binding)

- **Idle touchpoint = successful refresh ONLY.** The access token is presented on every API call (touching `last_used_at` there = a write per request = write-amplification for near-zero security gain — the access token dies in 15 min anyway). /me, logout, revoke-others do NOT slide the window (logout SHOULD die on idle if the session is idle — that is the point).
- **Rotation = the touch.** The guarded rotate (UPDATE..RETURNING where used_at IS NULL...) already mutates the row on every successful refresh; the idle touch rides the SAME statement (set `last_used_at = now()` in the rotation UPDATE — zero extra round-trips, atomicity by construction, W1-4 precedent).
- **Idle check placement (B2 RULING):** the idle predicate rides INSIDE the guarded rotate WHERE (`gt(sessions.lastUsedAt, cutoff)`), NOT as a separate pre/post check. Safety proof: an idle-expired row has `used_at IS NULL` (the presented token's row), so its burn-failure lands in the D125 classifier's `usedAt IS NULL → 'Session expired'` branch — the replay/grace arms require `usedAt` SET, unreachable for an idle-expiry failure. No misclassification, no family burn. Sliding delivery: the OLD row's UPDATE does not need last_used_at — the NEW row (rotate-insert) gets it from the column default (now()); sliding is delivered by rotation itself.
- **Envelope:** an idle-expired session returns the SAME 401 envelope as absolute-expired (`AUTH_003 Invalid refresh token` — core.ts:280 maps any rotate error); client re-logins; no new wire code (D126 clean). AUTH_005 (decorator revocation) is a different surface, untouched.
- **Config plane:** options key `session.idle_timeout_seconds` (3-tier: env `SESSION_IDLE_TIMEOUT_SECONDS` > option > default **86400** = 24h). Value `0` = DISABLES idle enforcement (explicit opt-out, distinct from config-plane failure). Reader is a pure function in packages/identity (zero-dep leaf, cache-coherence precedent) so SessionManager stays decoupled from options-manager wiring; server injects the reader (mfa-policy getter-injection precedent). Cross-node note (B3): the OptionsManager cache makes knob changes propagate lazily per node — transient cutoff divergence is ACCEPTED under G4's availability posture (bounded by cache TTL; the predicate evaluates shared DB state either way).
- **Enforcement symmetry (B1-corrected):** `rotateRefreshToken` is the SOLE live token-grant gate (validated by grep: `validateSession` has zero wire call sites — tests only); it gains the predicate. `validateSession` gains it too as defense-in-depth (wire-dead today). The revocation-stack battery (real-PG) gains an idle case.

### D3 — Wire surface

- Settings.tsx + setup wizard step: render "Idle timeout" select (24h default; options 1h/8h/24h/7d/0=off) → PUT options `session.idle_timeout_seconds` (options:write gate; falls under existing Settings options pattern). en/zh parity.
- identity-sdd.md:3 line replaced: absolute 7d + sliding idle (default 24h, 0=off) — the T11 "absolute-expiry-only" honesty note is superseded by THIS shipped reality (same-commit flip).
- .env.example: `SESSION_IDLE_TIMEOUT_SECONDS` with ops comment (0 disables; knob also settable at runtime via options).

### D4 — Interaction with existing machinery (verified against code)

- **Q3A real-time revocation**: unaffected — bumpAuthState kills via authst Redis key + tokenVersion; idle expiry is an ADDITIONAL predicate inside session validity, orthogonal to revocation.
- **revoke-others / revokeSession**: operate by row id / user — no idle interplay.
- **remember-me?** No such knob exists; nothing to migrate.
- **Lockout**: idle-expired ≠ lockout; no 423 semantics.
- **Anchor worker / audit**: sessions table untouched by this batch (no audit events for expiry — session expiry is not a security event, it's lifecycle).

## 4. Testing matrix (RED-first per site)

| # | Lock | Layer |
|---|---|---|
| T-1 | rotate slides: refresh at T0+idle-1s succeeds AND last_used_at advanced (real-PG integration, cranked idle=2s) | integration |
| T-2 | idle kill: refresh at T0+idle+1s → 401, same envelope as absolute-expired; absolute ceiling still respected at 7d | integration |
| T-3 | 0 = off: idle=0 → refresh succeeds arbitrarily late (before absolute) | integration |
| T-4 | config-plane failure (reader throws) → enforcement off, login+refresh unaffected | unit |
| T-5 | default 86400 via 3-tier reader (env>option>default) | unit |
| T-6 | migration 0011 + SENTINELS + ops flip 11→12 | ops test |
| T-7 | Settings render + PUT option + e2e mock (select visible, option wired) | e2e mock |
| T-8 | revocation-stack battery unchanged (idle predicate does not disturb revocation paths) | existing suite |

## 5. Risks for review

- **R1**: idle predicate in the rotation UPDATE changes the guarded-rotate WHERE shape — the concurrent-grace classifier (D125, 10s grace) must not misread an idle-expired row as a replay. Idle check must come AFTER rotation success (or as a separate pre-check), decided in review.
- **R2**: existing sessions at deploy time get `last_used_at = now()` via column default → they ALL become freshly-idle (grace by migration). Acceptable; documented.
- **R3**: multi-node clock: last_used_at written by whichever node rotates — same U5 writer-clock ruling as audit chain (NTP assumed).

## 6. Delivery shape

1. 0011 + SENTINELS + ops flip (identity + migration)
2. idle predicate + slide-on-rotate (SessionManager + zero-dep reader leaf + wiring)
3. Settings/wizard UI + options + locales + e2e
4. docs (identity-sdd line, .env, CHANGELOG) + gates + live-fire idle battery (cranked 2s idle: refresh at +1s OK, at +3s 401)

---

## Review record (2026-09-29)

- **Momus flows:** rejected on input-validation grounds (reviewer persona scoped to `.omo/plans/*` artifacts; spec path outside it). No technical findings — no content lost.
- **Momus blockers: APPROVE-WITH-FIXES** — B1 MED (validateSession is wire-dead: zero call sites in apps/server; "BOTH paths" reworded, rotate = sole live gate), B2 MED (idle-placement ruling made: predicate INSIDE guarded WHERE is safe because idle-expired rows always carry used_at NULL → D125 classifier 'Session expired' arm, replay arm unreachable; sliding delivered by rotate-insert column default, not old-row UPDATE), B3 LOW (cross-node OptionsManager staleness documented under G4 posture), B4 LOW (sweeper predicate citation corrected to SESSION_GRACE_DAYS=30 form; linger ~37d accepted). Facts re-verified by reviewer: REFRESH_TTL_MS 7d (:15) ✓, rotate UPDATE shape + classifier (:168-204) ✓, PG16 ADD COLUMN DEFAULT now() metadata-only backfill = ALTER-time timestamp (R2 amnesty honest) ✓, 'Session expired' maps to AUTH_003 401 (core.ts:280) → zero new wire codes ✓, D124/SENTINELS/ops-flip 11→12 ✓.
