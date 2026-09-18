# Batch J — Debt Cleanup Pack (SCIM exact match + login MFA token hygiene + OIDC auto-approve e2e lock)

**Date:** 2026-09-18
**Level:** bounded (like batch H′ — small, known-point items; no dual-Momus for scope, addendum for execution risks only)
**Predecessors:** batch H backlog #1, batch E backlog (Low items), batch F R14

## 1. Motivation

Three verified leftover debts from batches E/H:

| # | Debt | Evidence | Class |
|---|------|----------|-------|
| D1 | SCIM `userName eq "X"` over-matches: filter pushes down as `search` → `email ILIKE '%X%' OR name ILIKE '%X%'`. Any substring of email matches, and the `name` column should never participate in a userName equality. | `apps/server/src/routes/scim.ts` `filterToQuery` → `packages/identity/src/managers/UserManager.ts:135-139` | Correctness (first real IdP integration hits it) |
| D2 | Login MFA step-up branch does not wipe a stale persisted session: `set({ mfaFlowToken, isLoading })` only. The three exchange twins (oauth/saml/magic) already wipe `token/refreshToken/user/isAuthenticated` at flow-token birth (F3 triplets); login is the missed fourth. | `apps/admin-ui/src/stores/auth.ts` login() mfaPending branch | Session hygiene |
| D3 | Login page's OIDC auto-approve effect (`/login?redirect=/oidc/auth/:uid` → GET interaction → POST approve → resume) has zero test coverage. Server half is locked by `oidc-flow.test.ts` AC+PKCE e2e; the browser effect is untested. Batch E called it "dead end"; static reading after F3 R14 shows the chain closed — needs an e2e lock to convert opinion into evidence. | `apps/admin-ui/src/pages/Login.tsx` OIDC effect | Test signal |

Explicitly dropped from scope: "stub mismatch-burn deviation" (E backlog) — test-seam behavior, already standardized burn-first in F3. Not production debt.

## 2. Design

### D1 — SCIM exact email equality

Extend `UserQueryParams` with `emailExact?: string` (lowercased value, guaranteed by the SCIM layer's `normalizeUserName` before it reaches the manager). In `findAll`, when `emailExact` is set, push `sql\`lower(${users.email}) = ${value}\`` and do NOT apply the fuzzy `search` condition. SCIM `filterToQuery` returns `{ emailExact: normalized }` instead of `{ search: normalized }` for the `userName eq` clause. The `name` column never participates (SCIM `userName` maps to our email identity only — same mapping `toScimUser` already uses).

- Resolved by inspection: `UserManager.create()` stores email verbatim (no lowercasing) and login `findByEmail` is exact-case `eq` — mixed-case rows CAN exist in legacy/manual-registration data. The read form MUST be `sql\`lower(${users.email}) = ${value}\`` (index-friendly `eq` rejected: it would silently miss mixed-case rows). SCIM's own write path already lowercases via `normalizeUserName` before `create`, so provisioned users stay uniformly lower-case.
- Admin UI users list keeps `search` semantics untouched (new optional key, no behavior change for existing callers).
- Admin UI users list keeps `search` semantics untouched (new optional key, no behavior change for existing callers).

### D2 — login wipes stale session at MFA birth

Mirror the F3 triplet exactly in the login mfaPending branch:

```ts
set({ mfaFlowToken: payload.flowToken, isAuthenticated: false, token: null, refreshToken: null, user: null, isLoading: false });
```

`cancelMfa` already nulls `mfaFlowToken`; no other change. No logout call to the server — the old refresh token remains the user's own session, revocation stays a user choice (same stance as the exchange twins).

### D3 — OIDC auto-approve: fix + e2e lock

Batch E called it "dead end"; the dual-Momus review proved it right one level deeper: `postInteractionDecision` returns `Promise<void>`, so the effect's `approved !== undefined` guard is always false — after a successful approve the chain NEVER resumes (stuck on /login). The existing "login with valid redirect" e2e covers the post-submit `navigateAfterAuth` direct-assign path, not this mount effect, which is why the defect survives a green suite. Task 3 is fix + e2e lock (one client-side line; no server-side change).

Extend the existing `e2e/oidc-consent.spec.ts` (reuses `seedSession` / `mockInteractionGet` / `mockSetupAndStats` / the `waitForURL('/oidc/auth/*')` precedent). Positive case: seed token, GET → login prompt, POST → recorded 200, navigate to `/login?redirect=…/oidc/auth/<uid>` — assert POST called AND `waitForURL` hits the resume URL (RED: navigation never happens). Counter-case: GET → consent prompt — assert `/consent?uid=` navigation and zero POSTs.

## 3. Non-goals (backlog carry-over)

- SCIM Groups / full filter grammar / ETag (unchanged from H non-goals)
- Real SMS delivery verification (awaiting first credentials)
- OIDC Grant/Interaction persistence (separate design batch when triggered)

## 4. Acceptance

- vitest: new SCIM test fails on substring/name-match and passes with exact; auth store test asserts wipe of token/refreshToken/user on mfaPending; `pnpm --filter @accessbase/identity build` + root tsc clean.
- e2e chromium: new OIDC auto-approve spec green; full suite zero new failures (baseline 123 passed + 3 skipped).
- batch-gate vitest baseline table unchanged (352/0/7 semantics, PG-down green).
