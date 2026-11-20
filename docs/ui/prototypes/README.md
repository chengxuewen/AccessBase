# AccessBase admin-console prototype kit — handoff

Single-file, backend-free UX contract reference for the AccessBase admin console
(`apps/admin-ui`). It is **not** a product build: no network, no auth, no persistence beyond
`localStorage` demo preferences. Every behavior here is a *contract sample* grounded in the real
console source; where the prototype cannot reproduce a server round-trip it **simulates** the failure
branch and says so (see disclosure index). Read this file first, `CHANGELOG.md` for per-round detail.

## Open & operate

- Open `admin-console.html` directly (`file://`) in a browser. No build step.
- Companion `auth-flows.html` (adjudication 33) covers the nine entry surfaces: Login (password +
  magic-link request + one-time oauthCode consumption + redirect allowlist), Magic link consumption
  (AUTH_004 suspended / invalid branches), Register, Forgot, Reset, Verify email, Enroll MFA (otpauth
  copyable + dead-token + recovery-once gate), Consent (scope checkboxes + approve/deny + redirect
  hygiene), and the four-step Setup wizard (admin min-8 policy, password never stored). It reuses the
  same token packs, theme and zh translation mechanism.
- Topbar: style pack (Ant / Material / Fluent / Carbon / Cupertino / Broadsheet / Geist), light/dark
  theme, **language 中文/EN** (stored `ab-lang`, probed from `navigator.language`), tenant perspective
  label, avatar. Sidebar collapses; tables adapt at narrow widths (priority columns + card mode).
- Demo-only perspective switches: Settings → "Permission perspective (demo)" (Administrator / Auditor /
  Member) and Webhooks → Operator / Auditor. They exercise permission gates; they are not real sessions.
- Branding (Settings → General) persists to `localStorage` only — backend out of scope, mirroring real
  `Settings.tsx handleSaveSite`.
- Combobox option lists use AntD-like metrics (32px rows, 5px 12px padding, 22px line-height), a tinted
  selected state with a reserved check column (selecting never shifts text), hover on `--hover`, and a
  fixed-positioned list placed at open time (flip-up near the viewport bottom, horizontal clamp, close on
  scroll/resize) so modal/drawer/toolbar scroll containers cannot clip it. Selects built inside modals
  (create/edit/add-option forms) are enhanced on open — they were previously native `<select multiple
  size=4>` listboxes with OS styling. The companion reuses the same mechanism.
- The allowClear cross is a SIBLING of the combobox button positioned absolutely inside the relative
  wrapper (a nested `<button>` is invalid HTML — the parser splits it, which wrapped the cross onto a
  blank line below the control). The chev swaps out while the cross shows; the cross is hidden when the
  value is empty or the control is disabled, and clicking it clears without opening the list.
- Tooltips are ONE body-level fixed element (`#floatTip`, z-index 600) shown on hover/focus of any
  `[data-tip]` host. The earlier CSS `::after` bubble was clipped by `tbody td{overflow:hidden}` and
  overpainted by later rows' sticky actions cells (`td:last-child{position:sticky;z-index:2}`), and
  clipped by table/modal/drawer scroll containers; a fixed element outside every ancestor cannot be
  clipped or overpainted. It flips below near the viewport top, clamps horizontally, hides on
  scroll/resize/Escape/leave/blur (focused hosts survive programmatic scroll), and links
  `aria-describedby` while visible. The zh pass translates `data-tip` attributes, so tooltips localize.

## Run the regression harness

```bash
npx playwright test --config=docs/ui/prototypes/.harness/playwright.config.ts
# single group:
npx playwright test --config=docs/ui/prototypes/.harness/playwright.config.ts --grep roles-edit
```

- 57 groups, all must pass. Per-group assertions are written to
  `docs/ui/prototypes/.harness/results.json` (`results[name].assertions`, `fail` count) for evidence review.
- The harness loads the same `file://` page; it never mocks the prototype itself except where a test
  deliberately stubs `navigator.clipboard` / `document.execCommand` to prove the copy-failure branch.
- **Maintenance rule (adjudications 21/30):** the lock set must cover the semantic surface set. Adding a
  surface, motion family, tint-bearing color, or locale string requires extending the matching group
  (or adding one) in the same change — never ship a surface the harness cannot see.

## Lock index (57 groups)

| Group | Locks | Ruling |
|---|---|---|
| de-ai-slop | no gradient/emoji/glass template tells | v0.2 |
| dashboard-render / dashboard-model | live statistics, no chart, activity tags, quick actions, load error | 19 |
| theme / style-packs | 7 packs × light/dark token switching | v0.3–v0.6, 12 |
| nav-switch / all-pages-high-fidelity | 12 pages render, nav state | v0.1, v0.8 |
| users-table / filter-narrows / search / users-model | users model, vocab, filters, sort, status switch | 6 |
| users-erasure | RTBF branch, LAST_ADMIN_GUARD, ERASE_LOCK_BUSY, receipt | 9 |
| roles-matrix / roles-model / roles-edit | partition locks, parent, staged draft, empty-save danger confirm, scope fan-out, mixed disabled, async delete | 7, 25 |
| groups-detail | create+isDepartment, detail/candidates/add/remove/saveRoles/delete async | 26 |
| mgmt-pages | tenants/clients/apikeys/webhooks/audit/events row contracts | 8, 10, 11, 14, 24, 28 |
| tenants-model | soft-delete, slug validation, init-admin shared 12+ policy, field-level 409, async CRUD | 8, 27 |
| clients-model | immutable clients, server enums, scope required, B5 gate, async create/rotate/delete | 14, 28 |
| apikeys-model | revoke-only, reveal-once, server-default scopes, expires validation, copy fallback | 5, 24 |
| webhooks-model | ping queues pending, toggle/rotate gate+Busy+error, deliveries loading | 10, 23 |
| events-model / events-load | real catalog/families, date range, async load + loadError + Search/reset | 11, 29 |
| audit-model | structured verify report, busy, error alerts, range, filtered export | 18 |
| settings / settings-model | 4 tabs, gates, logoUrl validation, idle 5 values, options load/key pattern, templates drawer preview/locale/test | 4, 22 |
| profile / profile-async | name edit validation, password/MFA/session async failure branches | 20 |
| states / confirm-uniform | skeleton/empty/error three-state, 403/404/500, toast variants, uniform destructive confirm | 12, 13 |
| row-crud / dead-controls | edit prefill + delete confirm; no silent-dead controls | row-CRUD, 3, 26, 28 |
| contrast / surfaces-contrast / danger-contrast | 4.5:1 across packs/themes incl. tint surfaces and danger two-tier | 1, 21 |
| a11y-keyboard / modal-a11y / tabs-a11y | focus trap/return/labelledby, APG tabs, keyboard rows | 10, 16, 17 |
| tooltip / overflow-menu / content-detail | body-level floating tooltip (no clipping/overpaint in any context), row overflow, truncate+detail | R1–R3, post-closure fix |
| responsive-table / pagehead-overflow / table-fit / chip-columns | narrow adaptation, no phantom scrollbar, chip columns | R4, R5 |
| combobox-popup / combobox-themed / cbx-disabled / cbx-capabilities | themed Select parity: clear/multiple/loading/keyboard/disabled mirror | 2, 15 |
| cbx-option-list | form selects themed (were native size=4 listboxes); 32px option rows, tinted selected + reserved check column (no shift), fixed list escaping modal/toolbar clipping, flip-up + clamp; allowClear cross inside the control (sibling + absolute, never a blank line below), hidden when empty/disabled, clears without opening; companion parity | post-closure fix 2/3 |
| topbar-fidelity | real topbar affordances only | 3 |
| reduced-motion | prefers-reduced-motion degradation + normal-mode motion intact | 30 |
| i18n | 中文/EN toggle, stored lang, zh chrome + relative forms, data untouched, dictionary parity/coverage, en restore | 31 |
| auth-login | login inline required + AUTH_002 simulation, magic request, oauthCode once-then-401, safeOidcRedirect allowlist, magic suspended/invalid/valid | 33 |
| auth-register-reset | register confirm-match + shared 12+ policy, forgot sent, reset token consumed, verify ok/expired | 33 |
| auth-enroll-consent | otpauth copy fallback, wrong-code, dead-token, recovery-once gate, consent load error + scopes + approve/deny + redirect refusal | 33 |
| auth-setup | four steps + heading focus, admin min-8 (vs console 12+), password-not-stored, config required, complete -> console | 33 |

## Simulation & demo disclosure index

Simulated failures fire **once per surface per page load**, then retry succeeds; the message always
carries "(prototype simulation)". They exist to demonstrate the real error branch, not to model uptime.

| Surface | Simulated point(s) | Real counterpart |
|---|---|---|
| Dashboard | stats load failure + Retry | `Dashboard.tsx` load error Alert |
| Users | create failure; delete RTBF guard/lock refusals | `Users.tsx` createError; server guards |
| Roles | save (role-service timeout), delete | `Roles.tsx` updateError/deleteError |
| Groups | detail load, candidate load, add/remove member, saveRoles, delete | `Groups.tsx` detailError/memberLoadError/memberAddError/memberRemoveError/rolesSaveError/deleteError |
| Tenants | create/update, status change, delete; init TENANT_PROTECTED | `Tenants.tsx` createError/updateError/statusError/deleteError/initError |
| Clients | create, rotate, delete | `Clients.tsx` createError/rotateError/deleteError |
| API Keys | create (key-service), revoke (key-service); clipboard rejection stub in harness | `ApiKeys.tsx` createError/revokeError/copyFailed |
| Webhooks | ping, toggle update, rotate, deliveries load | `Webhooks.tsx` pingError/updateError/rotateError/deliveriesLoadError |
| Audit | entries load, export, verify failure | `Audit.tsx` load/export/verify errors |
| Events | load failure + Retry | `Events.tsx` request try/catch loadError |
| Settings | options load, idle save, template preview, test-send SMTP | `Settings.tsx`/`EmailTemplatesCard.tsx` error branches |
| Profile | password change, MFA enable/disable, name save, session logout | `Profile.tsx` failure branches |
| Entry flows (auth-flows.html) | login AUTH_002, magic send, register/forgot/reset/confirm/setup create, consent decision | `Login/MagicLogin/Register/ForgotPassword/ResetPassword/EnrollMfa/Consent/setup` error branches |

Demo-only mechanisms (disclosed in-page): permission perspective switches (Settings/Webhooks);
`localStorage`-only branding; zh translation pass over chrome (real uses `i18n/locales` + parity test);
`relFrom(iso)` relative forms (real sets `dayjs.locale` per render — register ≠ activate);
from/to date inputs stand in for AntD RangePicker (`startDate/endDate`); staged matrix maps to the real
AntD Transfer picker + modal Save; create-form note that UI sends no scopes and server defaults `['*']`.

## Adjudication index (1–31)

| # | Subject | Commit | Primary locks |
|---|---|---|---|
| 1 | danger two-tier + cross-pack contrast | 4e887db | danger-contrast, contrast |
| 2 | combobox mirrors disabled; system scope lock | 0995b89 | cbx-disabled |
| 3 | topbar fidelity; fictional affordances removed | 43d6d16 | topbar-fidelity, dead-controls |
| 4 | Settings page + scope boundary | b243474 | settings |
| 5 | API keys immutable/revoke-only + reveal-once | f148620 | apikeys-model |
| 6 | Users model/vocab/actions/sort | 69d4f79 | users-model, users-table |
| 7 | Roles partition/parent/scope timing/clear confirm | 9aba998 | roles-model |
| 8 | Tenants lifecycle + init-admin | 579967e | tenants-model |
| 9 | user delete RTBF + guards + receipt | 25fa535 | users-erasure |
| 10 | Webhooks Switch + delivery vocab + events contract | 3d2c7d8 | webhooks-model |
| 11 | Events catalog/families/date-range | d70a597 | events-model |
| 12 | three-state + 403/404/500 + toast variants | 7b54408 | states |
| 13 | destructive confirm contract completed | 17549a8 | confirm-uniform |
| 14 | Clients immutable + OIDC registration | 6b1196d | clients-model |
| 15 | combobox AntD Select capability parity | b763d24 | cbx-capabilities |
| 16 | modal focus trap/initial/return/labelledby | daada03 | modal-a11y |
| 17 | tabs APG + keyboard Roles rows | 103b1b5 | tabs-a11y, a11y-keyboard |
| 18 | Audit verify report + busy + errors + range + export | 35942a1 | audit-model |
| 19 | Dashboard live stats + quick actions + users create | f4db2eb | dashboard-model |
| 20 | Profile async Busy + failures + name validation | ec671ea | profile-async |
| 21 | contrast lock over all tint surfaces + *-text tokens | 5a9153f | surfaces-contrast |
| 22 | Settings gates/validation/load-error/templates drawer | e218616 | settings-model |
| 23 | Webhooks ping queues + gate/Busy/error + deliveries loading | a931662 | webhooks-model |
| 24 | ApiKeys scopes default + expires + async + copy fallback | 3f12399 | apikeys-model |
| 25 | Roles staged edits + empty-save confirm + fan-out + async delete | 4369031 | roles-edit |
| 26 | Groups create + isDepartment + six async points | 2003bff | groups-detail |
| 27 | Tenants shared 12+ policy + field-level 409 + async CRUD | ee1bab5 | tenants-model |
| 28 | Clients server enums + scope required + async | cb28ae2 | clients-model |
| 29 | Events async load + loadError + Search/reset toolbar | d589832 | events-load |
| 30 | prefers-reduced-motion degradation + motion lock | 32dae57 | reduced-motion |
| 31 | bilingual chrome + toggle + locale-aware relative + parity | af1f38d | i18n |
| 32 | kit handoff README (navigation layer + indexes) | 5fe8cc4 | — (doc) |
| 33 | entry-flows companion (nine surfaces) + auth locks | cc7aab8 | auth-login, auth-register-reset, auth-enroll-consent, auth-setup |
| 34 | closure: companion motion/i18n/contrast locks + .spin degradation + nav/steps contrast | e154ef1 | reduced-motion, i18n, surfaces-contrast |

Pre-series rounds (v0.1–v0.9, expert-panel adjudications 1–12 old numbering, revision plans R1–R5,
user-reported fixes) are indexed by date in `CHANGELOG.md`.

## Data provenance & boundaries

- Permission matrix: 26 builtin permissions verbatim from `apps/server/src/routes/permissions-seed.ts`.
- Event catalog/families: `packages/identity` events contract (no fictional `role.updated`/`audit.appended`).
- OIDC enums: `TOKEN_AUTH_METHODS`/`GRANT_TYPES` from `Clients.tsx` + server `clients.ts` enum refusal;
  B5 `none`-gate from server `clients.ts`.
- Password policy: shared 12+ upper/lower/digit/special (UserCreate precedent, reused by tenant bootstrap).
- API key scopes: UI sends none; server defaults `['*']` (`api-keys.ts`). Keys are revoke-only, no rotation.
- Entry-flow token states (magic/verify) and the enroll dead-token are demo selects/buttons; the real
  surfaces consume server-issued tokens. Setup admin password policy is min 8 (real AdminStep), not the
  console 12+ — the difference is intentional and disclosed in-page.
- Not modeled: real network/auth/tenancy enforcement, server-side export, dayjs itself, AntD itself.
  Demo data names/emails/ids are fixtures; the zh pass deliberately never translates them.
