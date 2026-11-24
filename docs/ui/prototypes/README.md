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
- **Boolean-control rule (post-closure unification, mirrors real `Groups.tsx` / `UserCreate.tsx`):**
  `Switch` (the `.wswitch` 34x20 track+knob button) is reserved for **immediate-effect** binary toggles
  (webhooks row active, user detail status). `Checkbox` (themed 16px square, check glyph, focus ring,
  disabled state, inline label) carries **form-submitted binary marking** (groups `isDepartment`, users
  `isActive`), **multi-select** (grants as a Checkbox.Group like real `Clients.tsx:308`; roles/scopes as
  Select-multiple mirrors) and **attestation gates** (recovery saved, MFA saved, erase confirm). The
  user-detail status is an immediate-effect `.wswitch` beside its Tag (real `UserDetail.tsx:139`), with
  loading + success/error feedback and no confirm; row-level suspend keeps its Popconfirm-equivalent
  confirm like real `Users.tsx`. The two domains are disjoint; no form field uses `role=switch` anymore. The
  blanket `.field input{width:100%}` rule excludes checkbox/radio — it previously stretched them into
  full-width bars and wrapped their labels. Real testids migrated: `groups-kind-switch` ->
  `groups-kind-checkbox`, new `users-active-checkbox`.
- Action delegates (Edit/Delete) read the en originals stored by the translation layer instead of the
  live `aria-label`/`data-tip`, so row actions keep working under zh (they went dead when the zh pass
  translated those attributes).
- Copy icons (every `copyable` cell: users/tenants/clients/webhooks/apikeys ids, slugs, URLs) give AntD
  copyable-style feedback: a `Copied` toast plus a transient green check glyph (1.2s) on success; when
  `navigator.clipboard` is unavailable or rejects (file:// / denied permission) an `execCommand('copy')`
  fallback runs, and only if both paths fail does an error toast appear. They were previously silent
  (promise errors swallowed), which made the icons look dead. The locked default-tenant row's disabled
  action icons explain themselves through the `.tip-wrap` hover hint (`Locked (default tenant)`), matching
  the real lock-glyph disabled affordance; under zh all tenants row actions still respond because the
  Edit/Delete delegates read the translation layer's en originals.
- Security tab sessions/passkeys/templates tables load asynchronously with skeleton + error banner +
  Retry (options precedent); tplSave refuses empty en/zh subjects; "log out other devices" is fail-closed
  (first attempt simulates an upstream timeout and keeps the sessions).
- zh covers dynamic strings too: every toast/busy/formError literal has a dictionary key or rule, locked
  by a source-literal scan (i18n-dynamic), not by a fixed key-existence list. `<html lang>` is zh-CN.
- Contrast lock spans 7 packs x BOTH themes and includes tx3-bearing text (surface/sunken) and the
  nav-on tint pair; all >=4.5:1. Disabled row actions degrade (opacity + no hover); hit areas are >=24px
  via padding/pseudo-elements while visual metrics stay AntD-like; the combobox trigger is a
  role=combobox div so chip remove buttons are valid, keyboard-reachable children; shadows use tokens.
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

- 67 groups, all must pass. Per-group assertions are written to
  `docs/ui/prototypes/.harness/results.json` (`results[name].assertions`, `fail` count) for evidence review.
- The harness loads the same `file://` page; it never mocks the prototype itself except where a test
  deliberately stubs `navigator.clipboard` / `document.execCommand` to prove the copy-failure branch.
- **Maintenance rule (adjudications 21/30):** the lock set must cover the semantic surface set. Adding a
  surface, motion family, tint-bearing color, or locale string requires extending the matching group
  (or adding one) in the same change — never ship a surface the harness cannot see.

## Lock index (67 groups)

| Group | Locks | Ruling |
|---|---|---|
| de-ai-slop | no gradient/emoji/glass template tells | v0.2 |
| dashboard-render / dashboard-model | live statistics, no chart, activity tags, quick actions, load error | 19 |
| theme / style-packs | 7 packs × light/dark token switching | v0.3–v0.6, 12 |
| nav-switch / all-pages-high-fidelity | 13 pages render (incl #/users/:id detail page), nav state | v0.1, v0.8, 36 |
| users-table / filter-narrows / search / users-model | users model, vocab, filters, sort, status switch | 6 |
| users-erasure | RTBF branch, LAST_ADMIN_GUARD, ERASE_LOCK_BUSY, receipt | 9 |
| roles-matrix / roles-model / roles-edit | partition locks, parent, staged draft, empty-save danger confirm, scope fan-out, mixed disabled, async delete | 7, 25 |
| groups-detail | create+isDepartment, detail/candidates/add/remove/saveRoles/delete async | 26 |
| mgmt-pages | tenants/clients/apikeys/webhooks/audit/events row contracts | 8, 10, 11, 14, 24, 28 |
| tenants-model | soft-delete, slug validation, init-admin shared 12+ policy, field-level 409, async CRUD; copy feedback (toast + check glyph + revert), clipboard-reject fallback, both-fail error toast, locked-row hover hint, zh row-action routing | 8, 27, post-closure fix 7 |
| clients-model | immutable clients, server enums, scope required, B5 gate, async create/rotate/delete; caepEndpointUri inline url+https rules (clients-caep-input) | 14, 28, 35, post-closure fix 6 |
| apikeys-model | revoke-only, reveal-once, server-default scopes, expires validation, copy fallback; cidrAllowlist textarea + server-validation echo (api-keys-cidr-input) | 5, 24, 35 |
| webhooks-model | ping queues pending, toggle/rotate gate+Busy+error, deliveries loading | 10, 23 |
| events-model / events-load | real catalog/families, date range, async load + loadError + Search/reset | 11, 29 |
| audit-model | structured verify report, busy, error alerts, range, filtered export | 18 |
| settings / settings-model | 4 tabs, gates, logoUrl validation, idle 5 values, options load/key pattern, templates drawer preview/locale/test | 4, 22 |
| profile / profile-async | name edit validation, password/MFA/session async failure branches | 20 |
| states / confirm-uniform | skeleton/empty/error three-state, 403/404/500, toast variants, uniform destructive confirm | 12, 13 |
| row-crud / dead-controls | edit prefill + delete confirm; no silent-dead controls | row-CRUD, 3, 26, 28 |
| contrast / surfaces-contrast / danger-contrast | 4.5:1 across packs/themes incl. tint surfaces and danger two-tier | 1, 21 |
| a11y-keyboard / modal-a11y / tabs-a11y | focus trap/return/labelledby, APG tabs, keyboard rows | 10, 16, 17 |
| tooltip / overflow-menu / content-detail | body-level floating tooltip (no clipping/overpaint in any context), row overflow, truncate+detail | R1–R3, post-closure fix 1/6 |
| responsive-table / pagehead-overflow / table-fit / chip-columns | narrow adaptation, no phantom scrollbar, chip columns | R4, R5 |
| combobox-popup / combobox-themed / cbx-disabled / cbx-capabilities | themed Select parity: clear/multiple/loading/keyboard/disabled mirror | 2, 15 |
| cbx-option-list | form selects themed (were native size=4 listboxes); 32px option rows, tinted selected + reserved check column (no shift), fixed list escaping modal/toolbar clipping, flip-up + clamp; allowClear cross inside the control (sibling + absolute, never a blank line below), hidden when empty/disabled, clears without opening; companion parity | post-closure fix 2/3 |
| security-states | security tab three-state loads (sessions/passkeys/templates) + tplSave bilingual-subject guard + sessions-others fail-closed | post-closure panel execution |
| script-health | both prototypes load with zero pageerror/console.error and key handlers alive (TDZ/partial-script catcher; lesson-review PIT-102 upgrade) | lesson-review 2026-11-23 |
| narrow-nav | <=760px breakpoint applies icon-only sider semantics (group labels hidden, collapse trigger hidden, no sidebar/doc overflow); icon-only nav keeps aria-label + hover tip (manual collapse and breakpoint); wide restores labels/trigger and drops tips | post-seal fix 8 |
| control-heights | two-tier control height scale by control semantics: editing controls (toolbar/page-head/modal-foot/form/matrix panel editing bar) all 32; chrome (topbar) and error retries 24; all actions (banner/card-head/row/template) 32; cbx included; 830px no-wrap probe | post-seal fix 13/14/15/16 |
| shape-scale | icon tiers {12,14,16,28} via --ic-s/m/l/display; single pop radius --r-pop (drawer sheet 0 exception); label-family --r-tag per pack (cupertino pill, material 8, carbon 0) shared by tag/chip/sys-tag | design backlog rulings 1-3 |
| a11y-env | reflow@200% zoom (no doc overflow, 5 pages), narrow modal/drawer fit + focus trap + background inert on/off, forced-colors checked/switch-on state visibility | verification-deepening batch |
| i18n-dynamic | source-literal lock: every toast/busy/formError literal in both prototypes translates under zh (dictionary key or rule) | post-closure panel execution |
| boolean-controls | boolean-control rule: forms use themed 16px checkboxes (groups isDepartment, users isActive default-checked), immediate domain stays .wswitch 34x20 button+knob, gates/scopes 16px centered; reduce-motion collapses knob+checkbox transitions; no role=switch in forms | post-closure fix 4/5/6 |
| topbar-fidelity | real topbar affordances only | 3 |
| reduced-motion | prefers-reduced-motion degradation + normal-mode motion intact | 30 |
| i18n | 中文/EN toggle, stored lang, zh chrome + relative forms, data untouched, dictionary parity/coverage, en restore | 31 |
| auth-login | login inline required + AUTH_002 simulation, magic request, oauthCode once-then-401, safeOidcRedirect allowlist, magic suspended/invalid/valid | 33 |
| auth-register-reset | register confirm-match + shared 12+ policy, forgot sent, reset token consumed, verify ok/expired | 33 |
| auth-enroll-consent | otpauth copy fallback, wrong-code, dead-token, recovery-once gate, consent load error + scopes + approve/deny + redirect refusal | 33 |
| auth-setup | four steps + heading focus, admin min-8 (vs console 12+), password-not-stored, config required, complete -> console | 33 |

## Simulation & demo disclosure index

Simulated failures fire **once per dialog open** for dialog/confirm flows (reopening re-arms the
first-attempt failure by design so the error branch can be demonstrated repeatedly) and **once per page
load** for page-level loads and webhooks actions; retry then succeeds. Every message carries
"(prototype simulation)". They exist to demonstrate the real error branch, not to model uptime.

| Surface | Simulated point(s) | Real counterpart |
|---|---|---|
| Dashboard | stats load failure + Retry | `Dashboard.tsx` load error Alert |
| Users | create first-attempt failure (async), detail-status first-attempt failure, import commit first-attempt failure; delete RTBF guard/lock refusals | `Users.tsx`/`UserCreate.tsx`/`users/ImportUsersModal.tsx` createError/updateError/import commit error; server guards |
| Roles | save (role-service timeout), delete | `Roles.tsx` updateError/deleteError |
| Groups | create, detail load, candidate load, add/remove member, saveRoles, delete | `Groups.tsx` detailError/memberLoadError/memberAddError/memberRemoveError/rolesSaveError/deleteError |
| Tenants | create/update, status change, delete; init TENANT_PROTECTED | `Tenants.tsx` createError/updateError/statusError/deleteError/initError |
| Clients | create, rotate, delete | `Clients.tsx` createError/rotateError/deleteError |
| API Keys | create (key-service), revoke (key-service); cidrAllowlist server-side CIDR validation echo (deterministic, marked); clipboard rejection stub in harness | `ApiKeys.tsx` createError/revokeError/copyFailed + server CIDR validation |
| Webhooks | ping, toggle update, rotate, deliveries load | `Webhooks.tsx` pingError/updateError/rotateError/deliveriesLoadError |
| Audit | entries load, export, verify failure | `Audit.tsx` load/export/verify errors |
| Events | load failure + Retry | `Events.tsx` request try/catch loadError |
| Settings | options/sessions/passkeys/templates load, idle save, template preview, test-send SMTP, session revoke fail-closed; MfaCard enable wrong-code error (deterministic, demo code 123456) | `Settings.tsx`/`EmailTemplatesCard.tsx` error branches |
| Profile | password change, name save, verification send, OAuth unlink | `Profile.tsx` failure branches (MFA enable/disable failure not simulated — see Not modeled) |
| Entry flows (auth-flows.html) | login AUTH_002, magic send, register/forgot/reset/confirm/setup create, consent decision; MFA/SMS demo codes fixed at 123456 (wrong-code error branches deterministic) | `Login/MagicLogin/Register/ForgotPassword/ResetPassword/EnrollMfa/Consent/setup` error branches |

Demo-only mechanisms (disclosed in-page): permission perspective switches (Settings/Webhooks);
`localStorage`-only branding; zh translation pass over chrome (real uses `i18n/locales` + parity test);
`relFrom(iso)` relative forms (real sets `dayjs.locale` per render — register ≠ activate);
from/to date inputs stand in for AntD RangePicker (`startDate/endDate`); staged matrix maps to the real
AntD Transfer picker + modal Save; create-form note that UI sends no scopes and server defaults `['*']`.

## Adjudication index (1–42)

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
| 35 | contract extension P0: clients caepEndpointUri (url+https inline) + apikeys cidrAllowlist (server-validation echo), field-err mechanism + testids | da8250b | clients-model, apikeys-model, i18n-dynamic |
| 36 | contract extension P1: users create async+failure; UserDetail #/users/:id page shares modal builder; immediate-switch inline error | dd0266c | users-model, user-detail-page, dashboard-model |
| 37 | contract extension P1: ImportUsersModal two-phase (paste→Check dry-run→Import commit), strict CSV header/3-col, dup skip + policy error rows, commit failure sim | 3f878c8 | import-users, i18n-dynamic |
| 38 | contract extension P2: login MFA arm (TOTP 6-digit, mfa-error alert) + SMS section (phone validation, sent state, 6-digit code, sms-error) mirroring MfaArm/SmsSection testids | 01f7da6 | auth-login, i18n-dynamic |
| 39 | contract extension P2: settings security fourth card MfaCard (setup QR+code+enable error, enabled alert+disable confirm, one-time recovery codes) mirroring settings/MfaCard.tsx | 189248e | security-states, i18n-dynamic |
| 40 | contract extension P2: 403/404/500 standalone full pages (chrome hidden, viewport-filling, primary back CTA) — real routes live outside the layout (App.tsx:285-287) | b268f53 | states |
| 41 | contract extension P2: audit export modeled as server job (busy→error w/ audit-export-error testid→retry), full filtered set (no client paging), filename mirrors api/audit.ts exportAuditLogs | 808f3dc | audit-model |
| 42 | contract extension P2: forced password-change handoff (login → mode=force panel, policy+confirm) + admin reset-password / resend-invite on UserDetail (real testids, eligible vs suspended) | pending | auth-login, user-detail-page |
| import-users | two-phase import: limitation alert, strict-header parse error, dry-run report (valid/skipped/error), commit gated on check, first-attempt commit failure, committed report + USERS growth | 37 |
| user-detail-page | #/users/:id deep-link page: same builder as modal, role=switch immediate toggle, inline+toast error on first attempt, retry flips, back restores list | 36 |

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
- Webhook subscribed events: real uses `Select mode="tags"` with `EVENT_PRESETS` options
  (`Webhooks.tsx:505-509`); the prototype renders a free-text entry plus the same preset quick-picks,
  which is functionally equivalent (catalog selection + custom entries). Both sides validate
  `resource.action` with the identical regex (`Webhooks.tsx:51` EVENT_PATTERN); preset quick-picks are
  add/remove toggles with aria-pressed, mirroring tag selection.
- Representation simplifications (disclosed, functionally equivalent): real `Roles.tsx` permission
  `Transfer` (two-list) is rendered as the permission matrix checkbox grid; real `Groups.tsx` /
  `Webhooks.tsx` `Drawer` surfaces are rendered as an in-page panel / modal; real `DatePicker` /
  `RangePicker` (ApiKeys expires, Audit days, Events range) are native date inputs with the same
  validation and startDate/endDate mapping (Events carries an inline range note); real `Profile.tsx`
  `Descriptions` and `Dashboard.tsx` `Statistic` are rendered as definition grids / stat cards.
  Functional filters are NOT simplified: users status/tenant, audit action/actor/days, events
  type/range all mirror the real Select/Input/RangePicker filters.
- Icon-button scale (post-seal fix 12): one scale across families — ghost row actions 28x28 with
  16px icons and 8px gap, bordered icon buttons 32x32/16, inline copy 20x20/14, pagination 32x32;
  cbx-clear/chip keep their small glyphs with >=24 hit areas. Actions columns carry per-table floors
  sized by button count (flex-shrink:0 prevents fixed-layout squeezing); the sticky last cell follows
  row hover so no opaque patch remains. Locked by shape-scale ib assertions + hover sync.
- Table column floors (post-seal fix 11): status/type tag columns carry a 104px floor (switch column
  84px) so tags never overflow under the opaque sticky actions column; prio-3 columns drop at 1100px
  (label() mirrors th prio onto td), the sticky edge carries a --bd2 shadow cue, and chip containers
  wrap instead of overflowing. Locked by responsive-table mid-width assertions across seven tables.
- Shape scale (design backlog rulings 1-3, locked by shape-scale): icons use three semantic tiers
  (--ic-s:12 inline meta, --ic-m:14 control-adjacent, --ic-l:16 standalone) plus --ic-display:28 for
  empty/placeholder art; control geometry (switch knob, checkbox box, legend swatch, scrollbar) stays
  px by design. Composite checkbox labels (ck-field / gate scope-list) keep inline-flex + 8px gap:
  outer-label rules are scoped to `.field > label:not(.ck-field)` so their display:block cannot kill the
  composite gap (a descendant label rule outranks the composite class by specificity). All floating pops (tooltip/cbx-list/menu/modal/toast) share --r-pop = pack r6 (AntD
  borderRadiusLG parity); the edge-attached drawer sheet keeps square corners like real AntD Drawer.
  Label-like pieces (.tag/.cbx-chip/.sys-tag) share --r-tag so pack personality (cupertino pill,
  material 8px, carbon 0) applies to the whole family, never one member.
- Narrow sider (post-seal fix 8): the <=760px breakpoint owns the collapse and applies the same
  semantics as the manual `.app.collapsed` state (group labels hidden to 6px spacers, collapse trigger
  hidden); icon-only nav links keep an aria-label and a hover tip in both icon-only modes, because
  display:none on the visible label would otherwise remove the link name from the accessibility tree.
  Combobox pops are placed in viewport coordinates with a measure-and-correct pass, because a
  backdrop-filter/transform ancestor (cupertino vibrancy topbar) changes the containing block of
  fixed-position descendants; active-option scrolling uses list-local scrollTop math, never
  scrollIntoView (which scrolls ancestors and tripped the outside-scroll close guard).
  The sider never scrolls horizontally: .nav sets overflow-x:hidden and icon-only group spacers take
  width:0 (visibility:hidden alone keeps their nowrap text width, which overflow-y:auto turned into
  a horizontal scrollbar at the sider bottom).
- Environment baseline (locked by a11y-env): no document-level horizontal overflow at ~200% zoom
  (640px viewport; data tables scroll inside their focusable regions), modals/drawers fit narrow
  viewports with a working focus trap and `inert` background while open, and forced-colors mode keeps
  checked/switch-on states distinguishable via system Highlight/HighlightText/ButtonText colors.
  Manual acceptance (not automatable here): real screen-reader announcement pass (NVDA/VoiceOver),
  touch drag, print stylesheet.
- Not modeled: real network/auth/tenancy enforcement, dayjs itself, AntD itself; the audit export is a
  simulated server job (client blob stands in for the /v1/audit-logs/export stream, disclosed);
  also the real `Profile.tsx` MFA enable/disable failure branches (no simulated counterpart yet —
  listed here instead of as phantom index rows). UserCreate/UserEdit route pages are represented by the
  shared modal form contract (same fields/validation/failure states); UserDetail exists as both the
  quick-view modal and the #/users/:id deep-link page, rendered by one builder (adjudication 36).
  Demo data names/emails/ids are fixtures; the zh pass deliberately never translates them.
