# Plan: Gap Remediation Batch — 2026-10-12 (G1/G2/G5/G10 + hygiene riders)

**Date:** 2026-10-12 · **Status:** PROPOSED (rev.2 — dual-Momus absorbed: flows R1-R7 + blockers B1-B8, both APPROVE-WITH-FIXES; cross-confirmed R2≡B3, R3≡B6)
**rev.2 change log:**
- B5 (CRITICAL-grade catch, already fixed on master `4114538`): branding fields were stripped by fast-json-stringify — response schema now declares them; live server verified. Plan's T4 regen rider updated accordingly.
- R1≡B1 (T1 reframe): the SPA does NOT use the no-token arm (stores/auth.ts posts ONLY when refreshToken exists; the 401 interceptor calls local logout, never the endpoint — both lanes verified independently). D-1 re-posed: A applies to ARM-1 semantics only if wanted; recommendation flipped to B+defensive (arm-2 = API-client hardening, documented; SPA multi-device UX untouched).
- R2≡B3 (T3 envelope): helper emits `{success, data, total, page, pageSize}` per events.ts:118 precedent — `items`/`totalPages` dropped, audit/events become drop-in consumers.
- R3≡B6 (T2 file refs): `utils/metrics.ts` does not exist — pattern file = `utils/webhook-metrics.ts`; counter module must be imported UNCONDITIONALLY (webhook-metrics is dispatcher-conditional and would not register under NODE_ENV=test → the /metrics string-match test would fail); named import point = utils/auth-state.ts itself.
- B2 (T3 SCIM guard): 4th production caller — scim.ts:643 /ScimGroups full-list. Ruling: no-opts `list()` returns ALL rows (unpaginated), regression assertion added.
- R4≡B7 (T1 DEL): authst DEL without bump is a semantic no-op (memo re-reads identical state) — dropped from arm-2 and U2.
- R5≡(T4 correction): `auditAnchorGraceSeconds` ALREADY exists (config.ts:118, app.ts:440) — rider = one-line swap in audit.ts + comment rewrite, not an addition.
- R6 (gates): e2e baseline flip (→~189+3) added to same-commit rule.
- R7≡B4 (T3 per-manager): clients manager has NO tenantId — signature `list({limit, offset})` for OidcClientManager only.
- B8 (citation): runbook ref corrected to docs/runbooks/multi-node.md:65-67.
- U2 internal contradiction rewritten (B3-blockers): final ruling = revoke rows, NO DEL, NO bump.
**Parent:** `docs/superpowers/reports/2026-10-12-gap-map.md` (G-numbered findings)
**Scope ruling:** G2 re-scoped during fact-check (see §0); G3 jwks-rotation and G8 device-flow branding are EXCLUDED (bigger, separate specs); hygiene riders G6a/G6b/G9-annotate ride along only where they touch files already opened.

---

## 0. Fact-check corrections to the gap map (PIT-076 caught the map itself)

- **G2 re-scope:** the gap map's "logout never closes the session family" was
  MISLEDING. Facts: `sessions` has NO family_id column; reuse detection lives
  inside `rotateRefreshToken` via `usedAt`/`revokedAt` (SessionManager.ts:220-224);
  logout WITH a refreshToken already calls `revokeSession(session.id)` (auth/core.ts:89-92).
  **The real gap:** the no-refreshToken logout arm (which the SPA uses) burns
  NOTHING server-side — bearer lives to TTL (documented), and the presented
  refresh token, if any attacker holds a copy, stays valid until 7d TTL because
  nothing marks it. Also `SessionManager.close()` is the POOL close, not a
  session-family burn (round2 H6's wording conflated them).
  **Real fix (§T1): burn what is presented; bump for the no-token arm.**
- **G1 confirmed:** reader fail-open (`catch { return null }`) has zero
  observability — no counter, no log. One dead DB silently disables all
  revocation checks.
- **G5 confirmed:** clients/api-keys/groups lists unpaginated, no `total`;
  audit/events duplicate their own pagination; no shared helper (grep 0).

---

## T1 — Logout burns what is presented (G2, re-scoped ×2 after flows R1/B1)

**Reframe:** the SPA virtually always posts WITH a refreshToken
(stores/auth.ts gates the POST on the token existing; the 401 interceptor
calls local `logout()` and never hits the endpoint — dual-lane verified).
So the decision that matters is ARM-1 (presented-token) semantics, and
D-1's original "kill ALL on token-less logout" would have targeted an
arm the SPA never hits (dual-lane flagged: dead-letter decision).

**Final semantics:**
1. **refreshToken presented (arm-1, the SPA path)**: unchanged —
   `revokeSession(session.id)` (revoking the row kills any copies of THAT
   token; reuse detection then guards rotation attempts per D125).
   Multi-device UX preserved ("log out this device" stays per-device;
   logout-everywhere exists in Profile session management).
2. **no refreshToken (arm-2, API-client hardening — NOT reachable by the
   SPA)**: NEW `revokeAllUserSessions(sub)` — a bearer-only caller asking
   for logout gets its user's refresh family killed (defensive posture;
   documented as such). No DEL, NO bump: bearer keeps living to TTL per
   the multi-node runbook (docs/runbooks/multi-node.md:65-67); refresh
   rows are already dead via the revoke.
3. `auth.logout` event: unchanged, both arms.

**D-1 RESOLVED (plan rev.2, user may override):** B+defensive — arm-2
gains revokeAll as hardening; arm-1 untouched. If the user wants
logout-everywhere semantics on arm-1, that is a separate ruling with a
multi-device UX trade (Profile per-device revoke exists).

**Tests (RED-first):**
- U1: logout w/ refreshToken → session row `revokedAt` set (exists, keep).
- U2 (rewritten, was self-contradicting): logout w/o refreshToken →
  ALL user session rows revoked; NO authst DEL; NO bump (bearer to TTL).
- U3: logout idempotent (second call 200).
- I1 (real PG): no-token logout → sibling sessions revoked; presented
  token arm unchanged; idpLogoutUrl still composes (read-only lookups
  unaffected by the new effect).

**Files:** `routes/auth/core.ts` (arm-2 effect + revokeAllUserSessions
import via ctx.sessionManager — the method exists, SessionManager.ts:265).

---

## T2 — Revocation-reader error observability (G1)

- New counter `accessbase_authstate_read_errors_total` in a NEW module
  `utils/auth-state-metrics.ts`, copied from the `utils/webhook-metrics.ts`
  pattern (module-level `new Counter` on the prom-client DEFAULT registry —
  served by routes/metrics.ts automatically; `utils/metrics.ts` does NOT
  exist, the plan rev.1 reference was a phantom — dual-lane flagged).
- **Import point is load-bearing:** webhook-metrics is imported only by the
  dispatcher wiring (conditional) and would NOT register under
  NODE_ENV=test — the counter module must be imported UNCONDITIONALLY,
  i.e. from `utils/auth-state.ts` itself (the reader's own module).
- Warn log rate-limited to 1/min inside the reader catch. No behavior
  change (fail-open is the Q3A ruling, stays).
- Tests: U — reader throwing DB → counter increments (mock db);
  /metrics string-match for the series (works in test because of the
  unconditional import).

**Files:** NEW `utils/auth-state-metrics.ts`; `utils/auth-state.ts`
(catch branch + import); no /metrics route change.

---

## T3 — Shared pagination helper + three list routes (G5)

- New `apps/server/src/utils/pagination.ts`:
  `parsePageQuery(query) -> {page, limit, offset}` (defaults 1/20, cap
  limit≤100); `paginatedReply(rows, total, page, limit)` emits
  **`{success: true, data: rows, total, page, pageSize}`** — the
  events.ts:118 precedent (rev.1's `{items, totalPages}` shape contradicted
  both the precedent and this plan's own additive-sibling ruling; dual-lane
  cross-confirmed). audit/events become drop-in consumers of the helper.
- **SCIM guard (blockers B2 — 4th production caller):** `GroupManager.list`
  is also called by scim.ts:643 (/ScimGroups) for its full-list +
  in-memory filtering. **Ruling: `list()` called WITHOUT pagination opts
  returns ALL rows** (SCIM unchanged); the three target routes pass opts
  explicitly. Regression assertion: scim caller keeps full set with >20
  groups.
- Per-manager signatures (blockers B4 — clients has NO tenantId):
  - `OidcClientManager`: `list({limit?, offset?})` + `count()` — platform-
    level table, do NOT invent a tenant predicate;
  - `ApiKeyManager`: `list(tenantId, {limit?, offset?}?)` + `count(tenantId)`;
  - `GroupManager`: same as api-keys (memberCount enrichment preserved;
    enrichment runs on the page slice, not the full set).
- Wire: `clients` GET list, `api-keys` GET list, `groups` GET list pass
  parsed opts + reply with the helper envelope.
- Frontend: three pages read `total` from the envelope sibling; Groups
  page's client-side filter logic (Groups.tsx:352 `filtered`) moves
  server-side (name search param) or is explicitly dropped — decision
  documented in the task report, not silently.
- Tests: helper unit; per-route (page 1 default, cap, total present);
  manager no-opts = full set (SCIM guard); 3 e2e (total present + page-2
  server fetch).

**Files:** NEW `utils/pagination.ts`; `routes/{clients,api-keys,groups}.ts`;
`packages/identity` three managers; scim.ts (unchanged — guarded by test);
three admin-ui pages + api clients.

---

## T4 — openapi.json regeneration + doc riders (G10 + G6a/G6b)

- `pnpm --filter @accessbase/server gen:openapi` → commit artifact (103 →
  ~104 paths incl. the Q3D receiver; static generation, no live server —
  verified). **B5 rider ALREADY LANDED on master (`4114538`):**
  /setup/status response schema now declares logoUrl/primaryColor
  (fast-json-stringify was stripping them — branding was not on the wire
  until fixed; live server verified post-fix).
- G6a corrected by dual-lane: `auditAnchorGraceSeconds` ALREADY EXISTS
  (config.ts:118, consumed app.ts:440) — the rider is the ONE-LINE swap
  in routes/audit.ts:259-260 (`graceSeconds: config.auditAnchorGraceSeconds`)
  + stale ponytail comment rewrite. NOT a config addition.
- G6b: saml-logout.ts:149-151 ponytail comment rewrite (the Redis SETNX
  arm is implemented, not an "upgrade path").

**Files:** docs/openapi.json; `routes/audit.ts` (1 line + comment);
`utils/saml-logout.ts` (comment only).

---

## Gates (definition of done)

- vitest full suite green + vitest baseline flip (1531 → new count) in the
  same commit as the count change (conventions Q1);
- **e2e baseline flip in the same commit** (187+3 → new count with the 3
  new pagination tests) — rev.1 omitted this (flows R6);
- 4× tsc 0; eslint 0-new;
- SCIM full-set regression assertion green (B2 guard);
- openapi.json committed with regenerated count;
- No envelope-contract breaks (`{success, data, total, page, pageSize}`
  siblings only — events.ts precedent).

## Task order & estimate

T4 (30min) → T2 (half-day) → T1 (half-day, D-1 embedded) → T3 (one day,
largest) — serial, ~2.5 days total.

## Adjudications needed from user

- **D-1 (embedded in T1):** token-less logout arm — A: kill ALL sessions
  (recommended) / B: keep no-op arm cosmetic. Walk per
  adjudication-walkthrough if requested; otherwise approve plan = adopt A.
