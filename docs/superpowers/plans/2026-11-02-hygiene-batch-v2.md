# Plan: Hygiene Batch v2 — 2026-11-02 (audit-v2 items 1/2/3/4/6)

**Status:** PROPOSED rev.2 — dual-Momus absorbed (flows REJECT + blockers B1-blocker; BOTH lanes independently refuted T1's root cause by running the failing file in isolation — the accepted fix below is the lanes' fix, not rev.1's)

**rev.2 change log:**
- **T1 root cause REPLACED (flows R1 BLOCKER + blockers B1, cross-confirmed, both ran the file):** the 3 setup-guard reds are `toEqual` shape drift — /setup/status now returns `logoUrl:''`/`primaryColor:''` (branding batch added them to the payload; schema setup.ts:110-111) and the three expected literals (setup-guard.test.ts:128/193/290) still carry only the legacy four fields. rev.1's mock-gap story was wrong: the `tenants`-export warning fires inside a PASSING test (ensureDefaultTenantRow's try/catch absorbs it), the RoleManager.create TypeError is NOT part of the 3 failures (they never POST /admin), and extending dbMock chains would leave all 3 red. **Fix = update the three expected objects (+logoUrl:''/primaryColor:'').** The mock-marker work is demoted to optional hygiene (the absorbed tenants warning is worth silencing, but is not what fails).
- **T4 second source added (flows R2 HIGH + blockers B2, cross-confirmed):** openapi.json carries NO permission codes (6 incidental field-name mentions only) — the inventory generator joins TWO sources: openapi.json (methods/paths) + `apps/server/src/utils/authorize.ts` routePermissions map (permission codes). "Single source = openapi" retracted.
- **T5 count fixed (flows R3 + blockers B3):** branding.spec has 2 tests (not 3) — 2 → 3, not 3 → 4.
- **T2 mechanism corrected (flows R4):** Fastify's built-in application/json parser is INHERITED by the route scope (scoped parsers are additive, not replacing) — a JSON body parses fine and lands in route validation; missing content-type may 415 or fall to validation. The three cases stand as pin-the-real-behavior tests (the plan's hedge was right; the mechanism story corrected).
- **T3 unchanged (no findings).**
**Parent:** `docs/superpowers/reports/2026-11-02-gap-map-v2.md` (§6 order)
**Scope:** five tasks, ~3 days total. G9 (bare-catch lint batch) is EXCLUDED
from this round — it is orthogonal sweep work; rider scope discipline keeps
this batch at five named tasks.

---

## T1 — setup-guard trio fix (30 min): vitest baseline to true zero [REV.2: root cause replaced]

**Verified facts (dual-Momus, both lanes ran the file in isolation — `3 failed | 16 passed` reproduces):**
The three reds (setup-guard.test.ts:128/193/290) are `toEqual` deep-equality
mismatches on the /setup/status response: the branding batch added
`logoUrl:''`/`primaryColor:''` to the payload (setup.ts getBranding :74-83,
schema :110-111) and the tests still expect the legacy four fields
(isInitialized/adminExists/configComplete/siteName). rev.1's mock-gap story
is RETRACTED: the tenants-export warning fires inside a PASSING test
(ensureDefaultTenantRow absorbs it via try/catch), and the RoleManager
TypeError never runs in the failing tests.

**Fix (the lanes' fix):**
1. Extend the three expected objects with `logoUrl: ''` and `primaryColor: ''`
   — test-expectation update matching the SHIPPED response contract;
2. Optional hygiene (same commit): add `tenants/permissions/rolePermissions`
   markers to the narrow mock so the absorbed warn-line goes silent — NOT
   required for green.

**Gate:** setup-guard.test 19/19; full vitest **1547/1547 true zero** —
baseline flips in conventions/AGENTS same commit.

---

## T2 — bclo route parser unit cases (30 min): close the last route blind spot

**Facts:** `routes/oauth-backchannel-logout.ts` route layer (scoped
urlencoded parser, scoped setErrorHandler, 30/min bucket, audit exclusion)
is covered ONLY through the integration file's happy path
(`application/x-www-form-urlencoded`). Failure modes NOT covered: missing
content-type (Fastify 415 FST_ERR_CTP_INVALID_MEDIA_TYPE path), wrong
content-type (JSON body to a form route → parser throws), oversized token
(8KB schema guard — covered in U-oversize but not through the ROUTE).

**Fix — 3 unit cases appended to backchannel-logout-integration.test.ts
(app instance already built there; zero new fixtures):**
1. POST without content-type → 415 (or 400 — Fastify's
   `FST_ERR_CTP_INVALID_MEDIA_TYPE` = 415; assert whichever the framework
   actually emits, pin the real code in the test);
2. POST `application/json` body `{logout_token}` → parser rejects (form
   parser registered for urlencoded only) → 415/400 pinned;
3. Empty body (no logout_token param) → route's own AUTH_BCLO_001 arm → 400
   spec shape (asserts the route handles a parsed-but-empty body).

**Gate:** integration file grows 6 → 9 tests; no behavior change expected
(pin-the-current-behavior tests).

---

## T3 — G7 quartet split (1 day): Login/Settings/Webhooks/Groups

**Constraint (edit-safety quartet precedent):** pure-move refactor, zero
behavior change; e2e suites are the net (their specs already green); NO
state/logic changes — extract render units only.

- **Login.tsx (678 → ~200 + `pages/login/` dir):** extract per-arm components
  — `PasswordArm`, `MfaArm` (the early-return subtree), `SmsArm`,
  `WebAuthnSection`, `OAuthButtonsSection` (already a component — move
  rendering glue), `SamlSection`; keep ALL state hooks + effects in
  `Login.tsx` (27 hooks — the arms receive props). The exchanged-code
  effects (PIT-086 gates) stay verbatim in the parent — the PIT-086 e2e
  gates are the regression net.
- **Settings.tsx (614 → ~250 + `pages/settings/`):** extract tab bodies —
  `GeneralTab` (site form → branding save), `SecurityTab` (idle select +
  passkeys), `SessionsTab` (existing); state stays in the page, tabs receive
  props/callbacks.
- **Webhooks.tsx (535) / Groups.tsx (528):** extract `columns` definitions +
  modal components (`WebhookCreateModal`, `GroupMemberDrawer` already
  drawer-shaped) — lightest touch of the four.
- **Anti-goal:** do NOT restructure state, do NOT introduce context/stores,
  do NOT change any wire payload (mock-API e2e mocks exact shapes).
- **Scope ruling (T3 in execution, 2026-11-02):** Login split SHIPPED
  (678 -> 564; MfaArm + SmsSection extracted, all state/effect wiring
  intact, 37 login-cluster e2e green — pure-move proven). Settings/
  Webhooks/Groups splits DROPPED as negative-value: their line counts come
  from handler density (options save logic, columns closing over handlers),
  not from render duplication — extraction would be props-passthrough noise,
  not complexity reduction. G7 residual = Login only; the quartet's other
  three pages carry a documented "handler-density, not render-bloat"
  rationale instead of forced splits.

**Gate:** 4×tsc + admin-ui tsc 0; full e2e suite green (all page specs must
stay green — the pure-move proof); vitest unchanged; file sizes ≤ 350 for
the parents.

---

## T4 — G11 doc wave (1 day): api.md inventory [REV.2: two-source generation]

- **api.md**: add a "Current surface (2026-11-02)" section — full route
  inventory grouped by domain, **generated by joining TWO sources**:
  openapi.json (104 paths — methods/paths/descriptions) ×
  `apps/server/src/utils/authorize.ts` routePermissions map (permission
  codes). rev.1's "single source = openapi artifact" retracted (dual-lane:
  openapi carries NO permission metadata). The join script lives beside the
  regen command in the section head (error-codes-reality.md pattern).
- ui.md/database.md: NO body changes (honest headers; residual tracked).

**Gate:** api.md section present with the joined inventory + regen script;
D126 header unchanged; no code changes.

---

## T5 — Branding reach: self-service cluster (2h)

**Facts:** ForgotPassword/ResetPassword/Register/VerifyEmail/MagicLogin have
ZERO branding consumption (verified: grep 0). They share the AuthShell-lite
pattern (theme.useToken).

**Fix:** each self-service page gains `useBranding()` — logo above the card
(same `data-testid="branding-logo"` shape as Login), primary color via
local ConfigProvider wrapper. Setup wizard EXCLUDED (pre-init state cannot
read options — the table may not have the branding rows yet; keep stock).
e2e: extend branding.spec with 1 test (forgot-password page renders the
logo with the configured URL) — 2 → 3 tests (rev.1 said 3 → 4; count was
wrong). PIT-080 pre-check passed by blockers lane: specs mounting the
self-service pages (q1-self-service, q4a-helpdesk) already mock
setup/status.

**Gate:** admin-ui tsc 0; branding.spec 2 → 3; full e2e green.

---

## Execution order

T1 (30m) → T2 (30m) → T3 (1d) → T4 (1d) → T5 (2h). T1/T2 same commit is
fine (both tiny); T3 is its own commit; T4+T5 can pair.

## Gates (definition of done)

- vitest **1547/1547 true zero** — baseline flip in conventions/AGENTS
  same commit (the headline event of this batch);
- e2e full suite green (baseline flips only if T5 adds one test: 187→188+3);
- 4× tsc 0; eslint 0-new;
- bclo integration 6→9 tests; api.md carries the generated inventory;
- Pure-move proof for T3: all page e2e specs green unchanged.
