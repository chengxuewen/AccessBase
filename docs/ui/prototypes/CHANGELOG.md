# AccessBase Admin Prototypes CHANGELOG

> Method adopted from MediaServo `docs/ui/prototypes` (single-file HTML,
> design-token system, dual theme, inline interaction, harness assertions,
> versioned archive [reserved — not yet populated; see review note]). Scope ruling 2026-11-18: optimize EXISTING web
> functions (not mobile); core admin surface first (Dashboard / Users /
> Roles / Groups), visual + interaction upgrade.

## v0.1 — 2026-11-18 (admin-console) — first high-fidelity pass
- Admin shell: collapsible sidebar (full admin menu), topbar (search / theme
  toggle / tenant switcher / user), light+dark token themes (localStorage
  persisted), comfortable density.
- Dashboard (based on real Dashboard.tsx): 4 stat cards (users / active
  sessions / tenants / API keys), recent-activity feed, quick actions,
  7-day sign-in trend (inline SVG, no deps).
- Users (based on real Users.tsx columns): name/email/status/tenant/created/
  actions; status tags, search filter, tenant filter, pagination, row actions.
- Roles / Groups: navigation present, marked v0.2 (not yet high-fidelity).
- Harness: .harness/results.json seeded (theme-persist, nav-switch,
  filter-narrows assertions) — run via browser, filled on first live run.

## v0.2 — 2026-11-18 (admin-console) — de-AI-slop restyle: WorkOS enterprise broadsheet (ruling A)
User: v0.1 reads "AI-flavored and cartoonish". Root cause (community catalog
`vibecoded-design-tells`, 3.2M-post weighted): surface tokens were all model
safe-defaults — emoji-as-icons (cartoon tell), blue→violet gradient logo +
violet avatar palette (AI-purple tell), Tailwind default blue #2563EB
(unthemed-primary tell), large radius + colored icon blocks (template tell),
single system font (generic-font tell).
- **A token layer first**: pure white #FFFFFF ground + warm-slate ink #29363D
  (WorkOS broadsheet), single deep-teal accent #0F5C5A (non-purple, non-default),
  warm neutral scale, small radius scale 2/4/6 used by semantics.
- **Solid fills only**: logo/avatar now solid; gradient count = 0 (verified).
- **Emoji → Lucide SVG**: 20-symbol inline sprite, 66 rendered icons; emoji in
  UI = 0 (verified). Monochrome initial avatars replace 6-color rotation.
- **Font pair**: IBM Plex Sans (body) + IBM Plex Mono (data/dates/counts),
  loaded async post-load so offline double-click never blocks (v0.1 blocking
  Google-Fonts link caused a navigation timeout — fixed).
- **Density + hierarchy**: tighter table rows, tabular-nums stat values, mono
  metadata, 2px selected-nav indicator instead of rounded block.
- Dark theme re-tuned to warm dark (#15191B) with bright-teal accent, no glow.
Harness (puppeteer): statCards=4, svgIcons=66, emojiInUI=false,
logo gradient=none, trend/activity/users/theme/nav/filter/search all pass.

## v0.3 — 2026-11-18 (admin-console) — multi-style switching: 4 token packs (ruling: 开工)
User asked whether multi-style switching is feasible (enterprise / engineer /
Google / Microsoft). Analysis: current token architecture already concentrates
all visual decisions in :root, so style = a token override set; style x theme
are orthogonal dimensions. Implemented as data-style attribute + per-pack
override blocks, JS switch + localStorage (ab_style), zero deps, single-file
double-click preserved.
- **enterprise** (default, = v0.2 WorkOS broadsheet): white + warm-slate ink +
  deep-teal, radius 2/4/6, IBM Plex.
- **engineer** (Linear/Geist): monochrome near-black/white, tiny radius 3/4,
  high density (tighter rows/nav), Inter; primary = solid ink (white-on-dark).
- **google** (Material 2, Google-blue era — originally mislabeled "Material 3", corrected by panel adjudication 6): large radius 12/16, capsule buttons (999px),
  elevation shadows, Google blue #1A73E8 (dark #8AB4F8), Roboto, round avatars.
- **microsoft** (Fluent 2): small radius 4, Segoe UI, Fluent blue #0F6CBD
  (dark #479EF5), subtle shadow + border.
- Structural overrides per pack (google capsule/elevation, engineer density,
  microsoft shadow) beyond pure tokens (~20% of style identity).
- Topbar style switcher (select) beside theme toggle; fonts (Roboto/Inter)
  added to the async post-load injector so offline never blocks.
Harness (puppeteer) style x theme matrix: each pack's --accent/--r6/--sans
verified distinct (enterprise #0F5C5A/6px/Plex; engineer #111111/4px/Inter;
google #1A73E8/16px/Roboto; microsoft #0F6CBD/4px/Segoe); google btn radius
999px vs enterprise 4px (structural override live); ab_style persisted;
theme toggle still orthogonal; 4 switcher options. Screenshots: enterprise
light (v0.2), google light, engineer dark.
Boundary recorded: 4 packs is the single-file comfort ceiling; more styles
(apple/notion) would require splitting theme-pack files (sacrifices
double-click). AntD ConfigProvider theme.token is isomorphic to this pack
mechanism, so a chosen prototype style maps to implementation presets.

## v0.4 — 2026-11-18 (admin-console) — style-pack rename: single-word design-language names
User ruling: company names (google/microsoft) as style identifiers carry
brand-association risk and mis-reference (we follow their DESIGN SYSTEMS, not
the companies). Constraint: short, single word. Two-word combinations excluded
by the constraint; pure style-names rejected (Material/Fluent lack intuitive
single-word style descriptors). Resolution: design-language name where one
exists as a single word, style word where none does.
- google -> **material** (Material 2; cf. MUI / Material UI precedent)
- microsoft -> **fluent** (Fluent 2; cf. Fluent UI precedent)
- engineer -> **geist** (Geist design system; "Linear" is a company name, dropped)
- enterprise -> **broadsheet** (style word — WorkOS has no public single-word
  design-system name; broadsheet is a common noun, zero brand risk)
Identifiers are lowercase data-style values; switcher labels capitalized
(Broadsheet / Geist / Material / Fluent). Provenance separated: this CHANGELOG
records the design-language references; the pack identifiers are the four
words above (reference vs identifier, each in its place).
- Back-compat: STYLE_MIGRATE maps old persisted ab_style values
  (enterprise/engineer/google/microsoft) to the new names on load, so existing
  localStorage does not fall back to default.
Harness (puppeteer): switcher option values/labels = the four new names; each
pack's --accent/--r6/--sans verified distinct under new selectors (broadsheet
#0F5C5A/6px/Plex; geist #111111/4px/Inter; material #1A73E8/16px/Roboto;
fluent #0F6CBD/4px/Segoe); material btn 999px vs broadsheet 4px (structural
override intact); migration table exercised in-page (google->material, all
old->new, new names pass through). Note: headless file:// localStorage does
not persist across navigations in the runner, so migration was verified by
exercising the exact init logic in-page rather than a cross-reload seed.

## v0.5 — 2026-11-18 (admin-console) — Ant pack (implementation layer) + Fusion mechanism reference
User ruling: "Ant + Fusion 机制参照". Research verdict (ant vs Fusion): the
Alibaba-official distinction is "Ant Design is a component LIBRARY; Fusion
Design is a component-library GENERATION FACTORY (configurable theme engine)",
and "at the component level Fusion ~= AntD". So:
- **Ant pack added (5th)** — Ant Design v5 tokens: primary #1677FF (dark
  #1668DC), radius 4/6/8, layout bg #F5F5F5 (dark #141414), container #FFF
  (dark #1F1F1F), text rgba(0,0,0,.88/.65/.45), AntD font stack, btn weight
  400 + middle table density. The pack is a TOKEN-LEVEL reference to the admin-ui
  implementation layer (AntD v5): token values match the AntD seed, but the component
  structure is the prototype's own skeleton, not an AntD replica. Distinct axis vs the
  other four (none was the AntD look). [Wording corrected from "1:1 / THIS IS THE
  IMPLEMENTATION LAYER" by panel adjudication 3, 2026-11-18 — see evidence & review note.]
- **Fusion recorded as MECHANISM reference, NOT a visual pack** — Fusion's
  "theme factory" philosophy (designer configures a theme pack over one
  component base; engineer installs library + theme) is the conceptual
  precedent for THIS prototype's data-style token-pack architecture. Added
  as a provenance note in the HTML STYLE PACKS header. Not a switcher option:
  Fusion ~= AntD visually (no new axis) and admin-ui implements AntD, so Ant
  is the pack; Fusion's value here is the mechanism idea, not a skin.
- Single-file ceiling revisited: 5 packs (~+30 CSS lines) still far below the
  donor's 2201-line single file; double-click preserved. Split threshold
  remains 10+ packs.
Harness (puppeteer): switcher now 5 options [broadsheet,geist,material,fluent,
ant]; ant light accent #1677FF / r4 6px / r6 8px / bg #F5F5F5, btn radius 6px
+ weight 400; ant dark accent #1668DC / bg #141414; all five accents distinct;
material btn 999px vs ant 6px (structural overrides intact). Screenshot:
ant light dashboard.

## v0.6 — 2026-11-18 (admin-console) — second-tier packs: Carbon + Cupertino
User ruling: expand with the second tier (Carbon/Cupertino). Both are
single-word design-language names (consistent with the v0.4 convention), each
adding a genuinely distinct axis:
- **carbon** (IBM Carbon v11): the ONLY fully-square pack — radius 0 on cards,
  buttons, tags; Carbon blue #0F62FE (dark #4589FF), g100 dark #161616/#262626,
  IBM Plex Sans (already loaded — synergy), high data density, left-indicator
  nav. Industrial grid aesthetic.
- **cupertino** (Apple HIG): large continuous radius (8/10/16), iOS system
  colors (#007AFF light / #0A84FF dark; systemGreen/Orange/Red), grouped bg
  #F2F2F7 (dark #000/#1C1C1E), SF system font stack (-apple-system), pill
  badges, and translucent vibrancy nav material (backdrop-filter saturate(180%)
  blur(20px) on topbar, light/dark). The Apple dimension.
- Library now 7 packs x light/dark. Single-file still far below donor 2201
  lines; double-click preserved; split threshold remains 10+.
Harness (puppeteer): 7 switcher options; all seven accents distinct
(broadsheet #0F5C5A, geist #111111, material #1A73E8, fluent #0F6CBD, ant
#1677FF, carbon #0F62FE, cupertino #007AFF); carbon btn/card radius 0px + IBM
Plex; cupertino btn 10px / tag 999px / topbar backdrop-filter saturate(1.8)
blur(20px) / dark accent #0A84FF. Screenshots: carbon light, cupertino light.

## v0.7 — 2026-11-18 (admin-console) — Roles permission matrix + Groups detail (high-fidelity)
User: "v0.7". Grounded in real admin-ui (donor method — no invented features):
read pages/Roles.tsx, pages/Groups.tsx, api/roles.ts, and the canonical
permission catalog apps/server/src/routes/permissions-seed.ts (BUILTIN_PERMISSIONS).
- **Roles page**: real columns (name / description / permissions count / tenant /
  created / actions). isSystem built-in admin row is locked (lock icon + system
  tag + disabled edit/delete), per ROLE_PROTECTED. Permission MATRIX editor:
  11 resources x read/write/delete = 33 cells, of which 26 are real permissions
  and 7 render not-applicable (audit/stats/options/clients/webhooks have no
  delete; audit/stats no write). The 26 codes are verbatim from the seed catalog.
  Click a role row to load its matrix; click a cell to toggle a binding (system
  role read-only). users:* data-scope select (all/dept/self) per the real
  data-scope batch. 5 roles: admin(system,26), editor(13), viewer(11),
  billing-admin(8), auditor(11).
- **Groups page**: real columns (name / kind / description / memberCount /
  roleCount / created-relative / actions). kind = department|group (blue dept
  tag). Detail panel with Members tab (member list + add-member picker drawn
  from the Users dataset + remove) and Roles tab (bind roles via checkboxes +
  save), per the real Groups drawer. 5 groups (2 departments, 3 groups).
- All new components (matrix cells, role-checks, tabs, member rows, panel) are
  token-driven, so all 7 style packs apply automatically — verified ant
  #1677FF, carbon #0F62FE + 0px radius, cupertino #007AFF, broadsheet #0F5C5A
  flow into matrix cells and role checkboxes.
Harness (puppeteer): Roles — 5 rows, 11 resource rows, admin 26/26 + 7 na cells,
system lock (edit/matrix/scope all disabled), editor 13/26 + scope=dept, toggle
users:delete +1 reversible. Groups — 5 rows / 2 dept tags, Engineering panel,
Members 4->5->4 add/remove, picker 9 candidates, Roles tab 5 checks / 3 bound
->4 toggle, panel close. Style packs verified on new pages. Screenshots: roles
matrix (broadsheet), groups detail (ant).
Note: the matrix is a prototype visualization of the real resource:action
binding model (the production UI assigns permissions via an AntD Transfer);
the underlying data — codes, scopes, system protection — is faithful.

## v0.8 — 2026-11-18 (admin-console) — remaining management pages high-fidelity
User: "v0.8". Grounded in real admin-ui (donor method): read pages/Tenants.tsx,
Clients.tsx, ApiKeys.tsx, Webhooks.tsx, Audit.tsx, Events.tsx for real columns
and features. Six placeholder pages replaced (Profile remains for v0.9).
- **Tenants**: name / slug(copyable) / status(active|suspended) / created /
  actions; isDefault row locked (K-T3 precedent); suspend/activate toggle.
- **OIDC Clients**: name / clientId(copyable) / redirectUris / grantTypes(tags) /
  scope / created; rotate-secret reveal-once modal (one-time plaintext warning).
- **API Keys**: name / prefix(copyable) / scopes(tags) / created / expires
  (Never when null) / status(active|revoked); revoke (disabled once revoked).
- **Webhooks**: url(copyable) / events(tags) / active-pending-dead counts /
  created; ping / rotate-secret(reveal-once) / deliveries modal (status /
  attempts / response / created) — DELIVERY_STATUS_COLOR semantics.
- **Audit**: time / actor / action(METHOD-colored tag: POST ok, PUT accent,
  PATCH warn, DELETE danger) / resource / ip / status(200|401); action + actor
  filters; hash-chain Verify banner; Export.
- **Events**: time / type(family-colored tag) / payload(JSON code) / fanout
  (Done|Pending) / detail modal (full payload JSON); type + family filters.
- Shared modals: secret reveal-once, event detail, webhook deliveries, per-page
  create form (clients/webhooks reveal secret on create). All token-driven so
  all 7 style packs apply (verified ant/carbon/cupertino/broadsheet flow into
  method tags, family tags, matrix cells).
Harness (puppeteer): Tenants 5 rows/default locked/suspended filter 1/toggle;
Clients 4 rows/5 grant tags/rotate reveal cs_/clientId/close; ApiKeys 4/Never/
revoked filter 1/revoke; Webhooks 3/dead pills/ping +1/deliveries modal
pending-failed-success; Audit 7/7 method tags/DELETE filter 1/verify banner;
Events 6/6 family tags/fanout pending/user filter 2/detail modal payload;
create tenant form -> +1 row; style packs on new pages. Screenshots: audit
(broadsheet + verify banner), events (ant).

## v0.9 — 2026-11-18 (admin-console) — Profile settings (final page; all 11 high-fidelity)
User: "v0.9". Grounded in real admin-ui (donor method): read pages/Profile.tsx
and packages/identity/src/services/password-policy.ts. The last placeholder
(Profile) replaced — ALL 11 pages are now high-fidelity.
- **Email-verification banner** (warning): shown when emailVerified=false, with
  Send verification button -> "Verification email sent to <email>." message.
- **Personal information**: Descriptions rows Name / Email / Status (Active tag);
  Name inline edit (edit -> input + save/cancel), save updates the topbar avatar
  initials. Extra: "Log out other devices" danger action (revokeOtherSessions).
- **Change password**: info policy hint + error alert; current / new / confirm
  fields. Client check MIRRORS the real password-policy.ts password-change
  callsite defaults: minLength 12 + requireUpper/Lower/Digit/Special (5 dims);
  error message verbatim "Password needs 12+ chars with upper, lower, digit and
  special"; confirm-match validation. On success: fields reset + feedback
  "Changed · other sessions signed out" (server revokes all sessions and issues
  this client a fresh pair, per routes/auth.ts).
- **Linked accounts**: OAuth link rows (github icon / google monogram, "Linked as
  <provider>" + account id, Unlink danger), empty state "No linked accounts.",
  Bind GitHub / Bind Google buttons (add a link).
- All token-driven so all 7 style packs apply (verified ant/carbon/cupertino/
  broadsheet flow into the primary button + info banner).
Note: Popconfirm (revoke-others / unlink) is simplified to direct-action-with-
transient-feedback in the prototype; the fields, the 5-dimension policy, the
session-revocation semantics and the OAuth link/unlink/bind are faithful.
Harness (puppeteer): verify banner visible + send msg; name Admin User -> edit ->
Jane Admin + avatar JA; email/status render; weak pwd -> real policy message;
mismatch -> "Passwords do not match"; valid -> error hidden + fields reset;
oauth 1 -> unlink 0 + empty state -> bind google 1 -> bind github 2; style packs
on Profile. Screenshot: profile (ant).

## Evidence & review note — 2026-11-18 (expert panel, adjudications 1–2)
An expert-panel review (expert-panel-review, Deep gate, 4 isolated roles) audited the
whole prototype. Full report: .omo/reports/panel-prototype-design-2026-11-18.md.
- **Evidence strength clarified (adjudication 2 = C):** the "Harness (puppeteer)" records
  below are SESSION-OBSERVED assertions hand-recorded during the build, NOT a reproducible
  test suite (no runner script exists). Read them as "live-observed", not "harness-verified".
  A reproducible Playwright runner is a registered OPEN ITEM (repo e2e tool is Playwright).
  results.json now carries this caveat; the stale v0.2 svgIcons:66 was refreshed to the
  measured 215 rendered icons / 33 symbol defs; the fusion entry is marked a provenance
  note, not a machine assertion.
- **Fixed (adjudication 1 = A):** duplicate id="verifyBanner" (audit + profile) renamed to
  auditVerifyBanner / profileVerifyBanner and rebound; the audit "Hash chain verified"
  banner no longer shows without clicking Verify, and the profile email banner is now
  independently controlled. Re-verified in-browser (both banners behave correctly).

## Prototype-fidelity fixes — 2026-11-18 (expert panel, adjudication 5 = B)
Tiered fix of prototype-grade mechanism shortcuts (not held to full production invariants,
but misleading/impossible defects removed):
- esc() now escapes quotes (&quot; / &#39;) — attribute-context interpolation is safe; the
  prototype self-XSS via webhook URL / tenant slug / profile name is closed.
- Groups role binding is a real STAGED save: toggling a role edits a draft; closing the panel
  discards it; reopening reverts to committed; "Save role bindings" commits. (Previously the
  Save button was decorative — changes applied immediately with no cancel path.)
- OIDC Clients "Redirect URIs (one per line)" is now a <textarea> (a single-line input could
  never contain newlines, so multi-URI entry was impossible).
- Create-tenant checks slug uniqueness (a duplicate 'default' is rejected) and required fields
  show inline feedback instead of silently closing.
- DEAD BUTTONS disclosed + made honest: Dashboard quick actions (Create user / Import users /
  New role / Issue API key), Users "Create user" + "Import", Roles "Create role", Groups
  "Create group" are DISABLED with a "Prototype: not wired" tooltip. Row Edit/Delete buttons
  (Users/Roles/Groups/Tenants/Clients/API Keys/Webhooks) are muted and show a "not wired in the
  demo" toast on click. Everything else (filters, pagination, status toggles, permission matrix,
  group manage, rotate/revoke/ping/deliveries, audit verify/export, create tenants/clients/
  apikeys/webhooks, profile actions) is functional.

## Pack-quality fixes — 2026-11-18 (expert panel, adjudication 6 = B)
- **material** relabeled Material 3 -> Material 2 (Google-blue era): the pack uses Google blue
  #1A73E8 (M2 vocabulary), not M3 tonal surface / state layer. Its structure (capsule buttons
  999px, large radius 12/16, elevation, Roboto) was already adequate — honest label, no
  structural change.
- **fluent** given a real Fluent 2 structural axis: 4px controls (--r4) / 8px surfaces (--r6) +
  layered subtle shadow, so it is no longer near-isomorphic to broadsheet (6px surfaces, no
  shadow, IBM Plex). Verified: fluent card 8px / btn 4px / 2-layer shadow vs broadsheet card 6px.

## Consistency fixes — 2026-11-18 (expert panel, adjudication 7 = B)
- Neutral `.tag` default: plain tags (grantTypes / scopes / "Group" kind) now render as neutral
  chips (sunken bg + bd border) instead of bare text; colored variants unchanged. Verified.
- `.role-name` renamed `.entity-name` (it names role/tenant/client/apikey/group entities, not
  only roles).
- Density coherence: geist/ant/carbon `thead th` padding now matches their `tbody td` (fixes the
  ant td 12px / th 8px self-contradiction). Verified ant th == td == 12px 16px.
- **Density scope disclosed** (honest, not full token-ization): pack-level density applies to
  table rows + nav; component-layer spacing/font-size (btn padding 6px 12px, some inline margins,
  font-size 10px, geist stat 22px) are fixed across packs; the permission-matrix cell padding is
  intentionally a constant fixed grid across all packs. Color discipline is fully token-driven.

## Disclosures & cosmetic fixes — 2026-11-18 (expert panel, adjudication 8 = B)
Trivial fixes (remove real misleading):
- `lang` corrected zh-CN -> en (UI is English; correct screen-reader pronunciation).
- `<title>` updated v0.6 -> v0.9 (was stale).
- cupertino comment corrected "nav material" -> "topbar material" (vibrancy is on the topbar
  only; the sidebar is opaque).
- clipboard writeText rejections now handled (.catch) — no unhandled Promise rejection.

Retracted / clarified unfulfilled claims:
- "versioned archive": archive/ is EMPTY (reserved, not populated). Historical version snapshots
  were not retained. The "Screenshots:" mentions below refer to session puppeteer captures
  returned in-conversation, NOT files archived to disk (0 image files in docs/ui/prototypes).

Batch disclosures (prototype scope, honest):
- i18n: the prototype is English-only hardcoded; the real admin-ui uses react-i18next (bilingual).
  i18n is out of prototype scope.
- Mock numbers are ILLUSTRATIVE, not reconciled (e.g. sidebar Users badge 1,284 vs 12 table rows;
  Dashboard Tenants 18 vs 5; audit banner 1,284 entries vs 7 rows). #scopeMixed is a dead element
  (the real mixed-scope sentinel logic is simplified to a per-role single value). The sidebar
  Collapse button is inert below 760px (media query forces mini sidebar).
- "all 7 style packs apply" was runtime-sampled on 4/7 packs (ant/carbon/cupertino/broadsheet) for
  new components; geist/material/fluent verified by token mechanism (static), not per-page runtime.
- Password client check mirrors the BACKEND password-change defaults (12 + 5 dims); the real
  admin-ui Profile.tsx client only enforces min 8 (backend strict) — the prototype is stricter than
  the donor UI. Per-dimension messages are reworded; the session-revocation citation is
  routes/auth/password.ts (registered via auth.ts), not auth.ts directly.
- "single-file offline" is not zero-network: fonts load async post-load from Google Fonts when
  online (local fallbacks when offline); navigation is never blocked.
- Groups member picker "9 candidates" counts the placeholder option (8 users + 1 placeholder).
  theme "persisted" is in-page getItem readback; headless file:// localStorage does not persist
  across navigations in the runner.
- The donor "2201-line single file" (MediaServo) is external to this workspace and not verifiable here.
- v0.1 marked Roles/Groups "v0.2"; they actually reached high-fidelity in v0.7 (label drift).
- Two shared rgba literals (modal scrim rgba(0,0,0,.45), modal shadow rgba(0,0,0,.18)) are
  intentionally shared across packs (black scrim is conventional), not tokenized.

## Reproducible harness — 2026-11-18 (expert panel, adjudication 9 = A, open item O1 resolved)
The harness is now a REPRODUCIBLE Playwright suite (was a session-observed hand-record):
- `.harness/playwright.config.ts` — static file:// target, NO webServer (unlike the app e2e
  config), serial single worker so results are collected and written once.
- `.harness/prototype.spec.ts` — 14 assertion groups: de-ai-slop, dashboard-render, theme,
  nav-switch, users-table, filter-narrows, search, style-packs, roles-matrix, groups-detail
  (staged-save semantics), mgmt-pages, profile, contrast (semantic tag text >=4.5:1 in all 7
  packs — locks the adjudication-4 fix as a regression), all-pages-high-fidelity.
- Run: `npx playwright test --config=docs/ui/prototypes/.harness/playwright.config.ts`
  (chromium already cached; no install). Each run regenerates `.harness/results.json`
  (runner="playwright (reproducible suite)", fail count, per-group pass/assertions).
- First run: 14 passed (1.6s). Keyboard/a11y assertions will be added once open item O2 is fixed.

## Accessibility (real barriers) — 2026-11-18 (expert panel, adjudication 10 = B, open item O2 resolved)
- role-check changed from <div onclick> to <button type="button" role="checkbox" aria-checked> —
  Groups role binding is now keyboard-operable (Enter/Space), with a visible focus ring.
- Modals: role="dialog" aria-modal="true"; Escape closes the topmost open modal; icon-only close
  buttons get aria-label="Close".
- Global :focus-visible ring (2px solid var(--focus)) so keyboard focus is visible in every pack.
- Runner: new a11y-keyboard group (15 total) verifies role-check keyboard toggle, modal Escape,
  close-button name, dialog role, focus ring. All 15 pass.
- Deferred (prototype scope, disclosed): full modal focus-trap/focus-return, complete tabs tablist
  AT semantics, selectable-row keyboard path.

## Scrollbar display fix — 2026-11-18 (user-reported)
Symptom: scrollbar thumb showed a mismatched-color halo in containers whose background is
--surface (sidebar nav, modals) whenever --bg != --surface (ant/material/fluent/carbon/cupertino
and most dark modes); thumb was square; no corner styling (bright corner in dark when both axes
scroll). Root cause: `::-webkit-scrollbar-thumb{border:3px solid var(--bg)}` painted the inset
border in the PAGE background, not the scroll container's own background.
Fix: standard inset-thumb technique — `border:3px solid transparent; background-clip:padding-box`
(the border region now shows the container's own background, correct in any container); thumb
radius uses the pack token (--r4); track + corner transparent; hover feedback (--tx3); Firefox
`scrollbar-color:var(--bd2) transparent; scrollbar-width:thin`. Verified before/after at
1440x520 ant light (nav + main scrolling): halo gone. Harness 15 groups still pass.

## Light page-background fidelity — 2026-11-18 (user question + adjudication 11 = B)
User asked why several packs' light themes all looked gray-toned. Root cause: the prototype
applied ONE uniform "gray layout + white container" model to all 7 packs. That model is faithful
for ant (AntD colorBgLayout gray + colorBgContainer white — verified antd/es/theme/themes/
default/colors.js:38-40) and cupertino (iOS systemGroupedBackground #F2F2F7, grouped layout),
but misrepresents the white-first languages carbon/geist/fluent and flattens pack distinctness.
Fix (B — only the clearly-deviant white-first packs):
- carbon --bg #F4F4F4 -> #FFFFFF (Carbon White theme ui-background is white; gray-10 #f4f4f4
  sinks to --sunken as layer-01).
- geist --bg #FAFAFA -> #FFFFFF (Vercel/Geist white base; accents-1 #fafafa sinks to --sunken).
- fluent --bg #F5F5F5 -> #FAF9F8 (M365 warm neutralLighterAlt; --sunken #F3F2F1 neutralLighter,
  --hover #EDEBE9 neutralLight) — warm-white, distinct from the pure-white packs.
- ant / cupertino / material gray KEPT (faithful / Google-product-faithful).
Result: page backgrounds now split into white-first (broadsheet/geist/carbon), warm-white
(fluent), gray-layout (ant/cupertino/material) — each language's identity restored.
Mainstream practice: page-bg vs container-bg is a deliberate design-language identity marker —
gray-layout+white-container (AntD / iOS-grouped / most SaaS admin) vs white-first+gray-layers
(Carbon White / Geist / Fluent v9 / Material M2) vs M3 primary-tinted tonal surfaces vs warm
neutral (M365 #FAF9F8). Verified carbon white look (white base + borders + gray-10 layers);
harness 15 groups pass (no regression).

## Dark page-background fidelity — 2026-11-19 (proactive same-class audit + adjudication 12 = A)
Following the light page-bg fix (adjudication 11), audited all 7 packs' dark backgrounds + shell +
structure tokens for the same "uniform model misrepresents a language" defect. Two found + fixed:
- **ant dark shifted one level light**: --bg #141414 / --surface #1F1F1F were AntD's Container /
  Elevated, not Layout / Container. Fixed to AntD dark colorBgLayout #000000 / colorBgContainer
  #141414 (verified antd/es/theme/themes/dark/colors.js:24,40-42 + FastColor lighten: Layout=lighten0
  #000, Container=lighten8 #141414, Elevated=lighten12 #1f1f1f); --sunken #0A0A0A (between, tags stay
  visible). Dark tx3 contrast improved to 4.54.
- **fluent dark not warm**: light became M365 warm (#FAF9F8) in adjudication 11 but dark stayed
  neutral #1F1F1F/#2B2B2B. Carried warm identity into dark: --bg #201F1E / --surface #2B2A29 /
  --sunken #1B1A19 / --hover #3B3A39 (M365 warm dark neutrals). Verified warm (R>G>B), tx3 contrast 5.35.
Other packs' dark verified FAITHFUL (no change): carbon #161616/#262626 = Carbon g100 (ui-background
gray-100 / layer-01 gray-90); cupertino #000/#1C1C1E = iOS dark grouped; geist #0A0A0A/#111 near-black;
material #202124/#2D2E31 = Google-product dark (consistent with its light product-gray interpretation).
Checked, debatable, NOT changed (design choices): uniform --surface sidebar/topbar (Carbon's iconic UI
Shell is dark gray, but the prototype is a generic admin layout, not the Carbon Shell component);
material capsule buttons + large radius lean M3 shape (Google-blue-era products did evolve pill shapes,
consistent with the product interpretation). Harness 15 pass; ant dark screenshot.

## Tooltip mechanism upgrade — 2026-11-19 (revision plan R1 = B)
Replaced native browser `title` hints on icon action buttons with a themed CSS-only tooltip
(`[data-tip]::after`): rides each pack's tokens (surface bg / bd border / r4 radius / fs11),
reveals on hover AND keyboard focus (:focus / :focus-within), topbar tooltips flip below.
- 27 icon-only action buttons migrated title -> data-tip + aria-label (accessible name).
- Disabled / conditionally-disabled buttons wrapped in `.tip-wrap` so their "Locked" / "not wired"
  hints still appear on hover (disabled buttons receive no :hover).
- The 2 title-keyed selectors (row-action muting, dead-button toast) updated to data-tip.
- Matrix perm-cell, page-head Create buttons, and the style select keep native title (layout /
  replaced-element safety) — disclosed scope limit of the CSS-only approach.
New harness group `tooltip` (16 total) verifies hover/focus reveal + disabled-wrapper hover +
aria-label. All 16 pass; no regression. Known CSS-only limits: no show-delay control, edge
positioning not auto-flipped (only topbar), touch has no hover.

## Row-action overflow menu — 2026-11-19 (revision plan R2 = A)
Users "More"(…) was a dead ellipsis; it is now a real overflow menu (reusable openMenu/closeMenu
component, position:fixed so it escapes the table's overflow-x clip). Secondary/danger actions
(Disable/Enable account, Reset password, Delete user) moved into the menu; View/Edit stay inline —
the mainstream primary-visible / secondary-in-overflow information architecture (Carbon / GitHub).
- Inert secondary actions disclose via the existing "not wired" toast (prototype scope).
- Accessible: trigger aria-haspopup="menu" + aria-expanded; menu role="menu", items role="menuitem";
  ArrowUp/Down/Home/End navigate, Esc closes + returns focus to trigger, Tab/click-outside close,
  first item focused on open.
- Fixed a parse-time bug: the menu container sat after the app script, so the top-level
  $('rowMenu') cached null; moved the container before the script (existing code reads DOM lazily).
New harness group overflow-menu (17 total) verifies open/close/Esc-refocus/item-toast/danger-item/
keyboard. All 17 pass; no regression. Component is reusable for R5 toolbar overflow.

## Tooltip position fix — 2026-11-19 (user-reported: row bubbles overlap adjacent row)
User noticed row-action tooltips felt too close / overlapping vertically. Root cause: the R1
tooltip opens ABOVE the button (bottom:calc(100%+6px)); in a dense table (55px rows, 24px buttons)
the ~21px bubble extends ~11px up into the PREVIOUS row. Fix: row-action tooltips now open to the
LEFT (.row-actions [data-tip]::after -> right:calc(100%+6px); top:50%; translateY(-50%)), staying
within the row's own vertical band (actions are right-aligned, so there is room to the left).
Verified: bubble now within-row, no overlap with the row above (measured + screenshot). Non-row
tooltips (topbar etc.) unchanged. Harness 17 pass (tooltip hover/focus opacity still 1).

## Long-content truncate + detail — 2026-11-19 (revision plan R3 = A)
Extended the Events-payload "truncate + view-detail" pattern to the variable-length Clients columns
(Redirect URIs, Scope). Each is now a real <button class="cell-trunc"> (keyboard/focus accessible),
ellipsis at max-width 220px + a dotted underline hinting "click to view full"; clicking opens a
reusable detailModal (openDetail) with the full structured content — URIs one-per-line in sunken
mono boxes, scope rendered as chips. Esc / Close / scrim dismiss it (existing modal machinery).
Scope correction (honesty): reading the actual mock data showed Roles/Groups descriptions are short
one-liners, NOT long text (the R3 pitch overstated them) — left unchanged. Events Payload already
exemplified the pattern. API Keys scopes (chips) / Webhooks URL (copyCell) keep their existing
affordances. New harness group content-detail (18 total): cell is BUTTON + ellipsis, modal opens with
full URI, Esc closes, scope shows 3 chips. All 18 pass; no regression. Screenshot: detail modal.

## Wide-table narrow-screen adaptation — 2026-11-19 (revision plan R4 = A)
Full responsive treatment for the 9 list tables, scoped `.page table:not(.matrix)` (the permission
matrix and modal tables are excluded). Three layers:
- Sticky action column: th/td:last-child position:sticky right:0 with opaque surface/sunken bg + a
  faint left edge shadow, so actions stay reachable while a wide table scrolls horizontally.
- Column priority: data-prio on secondary <th> (p2 hidden <=900px, p3 hidden <=760px); the primary
  name column and Actions are always kept. Per-table mapping keeps the most identifying columns.
- Card view <600px: thead hidden, each row becomes a bordered card, each td a flex label:value row
  (::before content:attr(data-label)); priority-hidden columns re-appear inside the card.
A MutationObserver auto-propagates thead labels + priority onto tbody cells on every re-render
(search/filter/create), with a col-count guard that skips colspan empty-state rows. New harness
group responsive-table (19 total): sticky at 1440, Client ID hidden / Name kept at 800, card thead
none + data-label=Name + flex + prio re-show at 500. All 19 pass; no regression. Screenshots at
500 (card), 800 (column priority), 1440 (sticky, full columns).

## Page-head narrow-screen overflow — 2026-11-19 (revision plan R5 = A; plan COMPLETE)
Page-head now stacks on narrow (<=760px: flex-wrap, title takes a full row) so action buttons are no
longer clipped — at 375px the audit Export button had been pushed off-screen. Secondary actions
(users Import, audit Export) are marked data-phsecondary and collapse into a ⋯ overflow trigger that
reuses the R2 openMenu component; the primary CTA (Create user / Verify chain) stays visible with its
label (discoverability). The Export menu item runs the real export and shows a toast, since the hidden
button's own "Exported" feedback would not be visible on narrow. Fixed a CSS specificity bug: .btn's
display (later in the sheet) overrode the hide rules, so they were scoped under .page-head. New harness
group pagehead-overflow (20 total): wide Export shown / ⋯ hidden; narrow Export hidden / ⋯ shown;
primary kept; page-head wrap; menu opens; Export item -> toast "Exported" + closes. All 20 pass.
This completes the R1–R5 concise/responsive revision plan (harness 15 -> 20 groups, all green).

## Phantom horizontal-scrollbar fix — 2026-11-19 (user-reported: scrollbar always present)
User reported several views keep a horizontal scrollbar even when the window is large enough.
Root cause: with `table-layout:auto`, column widths are driven by content min-width, which slightly
exceeds the container (e.g. users 1139 vs 1126 at 1400px); the R4 sticky action column (opaque bg)
masks that small overflow, so the table *looks* like it fits yet a horizontal scrollbar persists.
Truncation via max-width/overflow does NOT reduce auto-layout min-content (verified ineffective).
Fix: `table-layout:fixed` for list tables at >=900px (first column 22%, action column 110px, rest
share), so the table always fits the container; overlong single-line content ellipsizes (full text
still via R3 detail / R4 card view). Multi-line cells (identity, tags, actions, copyable) keep
wrapping via :has() exceptions. Narrower (<900px) keeps auto + column-priority + card view unchanged.
Also kept truncation hygiene (identity name/email, copyable id, role description, event payload chip).
New harness group table-fit (21 total): at 1440 all 9 list tables scrollWidth<=clientWidth (over=[]).
All 21 pass; no regression. Screenshot 1440: tables fit, email ellipsis, sticky actions retained.

## Chip-column display fix (Scopes / Events / Action) — 2026-11-19 (user-reported)
User flagged poor rendering in the Scopes (API Keys), Events (Webhooks) and Action (Audit) columns:
chips wrapped onto two lines inside the chip (Audit DELETE/PATCH/PUT), chips were ellipsis-clipped
(Webhooks "tenant.created …"), or chips were forced to stack vertically (API Keys scopes). Root cause:
the R6 fixed-layout equal-share middle columns were too narrow for chip content, the R6 td
overflow:hidden+text-overflow:ellipsis clipped overflowing chips with "…", and .tag inherited
white-space:normal so chip text wrapped internally.
Fix: (1) .tag{white-space:nowrap} so a chip is always one line; (2) tag-bearing cells
td:has(.tag){overflow:visible;text-overflow:clip} so whole chips wrap to the next line instead of being
clipped mid-text; (3) explicit column widths at >=900px give chip/content columns room to sit inline
(audit Action 210px / Time 150 / IP 130 / Status 80; webhooks Events 230 / counts 70 / actions 150;
apikeys Prefix 150 / Scopes 170; clients Grant types 180). Verified by screenshot at 1440: Audit action
chips single-line, Webhooks events chips inline full-text, API Keys scopes chips inline. New harness
group chip-columns (22 total): audit chip one line + not clipped, webhooks cell overflow visible /
text-overflow clip / chips not clipped, apikeys two scope chips same row. All 22 pass; no regression.

## Dead-control audit + silent-dead fixes — 2026-11-19 (user-reported: secondary controls unresponsive)
Comprehensive audit of all 75 buttons + 16 inputs + 10 selects cross-referenced against JS handlers.
Classification: (a) WIRED — create/close/tab/menu/detail/copy/rotate/revoke/ping/deliv/manage/rm/role/
tstatus/unlink/code/matrix/profile/pwd/bind/search/filters etc.; (b) DISCLOSED-INERT (intentional
prototype scope) — row Edit/Delete on users/groups/clients/webhooks (toast + opacity .5), overflow-menu
items (toast), 15 disabled buttons (tooltip "not wired"/"Locked"); (c) SILENT-DEAD (real bug: click gave
no response AND no disclosure) — 7 controls, now fixed:
  - users row View(eye): wired to a read-only user detail modal (openDetail, reuse R3 machinery).
  - roles & tenants non-locked row Edit/Delete: data-tip sat on the wrapper .tip-wrap span, so the
    inert-disclosure delegation (button[data-tip=Edit/Delete]) missed them; extended the selector to
    button[aria-label=Edit/Delete] so they disclose like the other tables.
  - Dashboard Refresh: wired to re-render activity + "Refreshed" toast (renderActivity extracted).
  - Dashboard View all: wired to navigate to Audit Log.
Added a toast(msg) helper. New harness group dead-controls (23 total): View opens user detail, roles &
tenants Edit disclose, Refresh toast, View all jumps to Audit. All 23 pass; no regression.
Remaining "not wired" disclosures are intentional prototype scope (edit modals / create-user-role-group
forms / import / reset-password / delete-confirm are design-implied but out of prototype scope).

## Row-level CRUD wired (adjudication A) — 2026-11-19
User ruled A: make the disclosed-inert row Edit/Delete actually operable (in-memory prototype data).
- Edit: opens the existing formModal in EDIT mode, prefilled with the row's current values (per-entity
  EDITDEFS: users name/email/status-select/tenant; roles/groups name/desc; tenants name/slug; clients
  name/redirectUris/scope; apikeys name/scopes/expires; webhooks url/events). Save updates the record in
  place + re-renders + "Saved" toast. Create buttons reset to Create mode.
- Delete: opens a new themed confirmModal ("Remove <name>? cannot be undone") with Cancel + red Delete;
  confirm splices the record + re-renders dependents (roles matrix, groups members/role-checks) + "Deleted"
  toast. users Delete reached via the overflow menu; apikeys row gained Edit/Delete (previously Revoke only).
- Removed the inert dimming (.row-actions Edit/Delete opacity .5) and the inert-disclosure delegation for
  Edit/Delete (now wired). Locked rows (system roles / default tenant) stay disabled+disclosed.
- Delegation infers kind from section.page id and idx from each row's existing anchor (data-more/role/
  manage/tstatus/rotate-client/revoke/ping); roles anchor lives on the <tr> itself (hasAttribute fallback).
- Fixed roles row-select onclick re-rendering (detaching the clicked button) by ignoring button clicks.
New harness row-crud (24 total): edit prefills Jane Doe, save updates row + Saved toast; clients delete
confirm removes row (4->3) + Deleted toast. dead-controls updated (roles/tenants Edit now open edit modal).
All 24 pass. Screenshots: prefilled Edit-user modal; Delete-client confirm modal.
Remaining disclosed-inert (Create user/role/group, Import, reset-password, menu toggle/reset) stay as-is.

## Combobox (native select) popup readability — 2026-11-19 (user-reported)
User reported combobox dropdown popups render abnormally. Root cause (verified by opening a select in
dark): <option> inherits the select's color (light in dark packs) while the native popup backdrop does
not follow the theme -> the open list rendered light-on-light (options invisible; only the highlighted
row readable). Fix: select{color-scheme:light} + html[data-theme=dark] select{color-scheme:dark} so native
popup chrome follows the theme, plus select option{background:var(--surface);color:var(--tx1)} to
guarantee a readable list in every pack/theme. Applies to ALL selects (toolbar filters, scope-box,
add-member, style pack) and the dynamically-built edit-modal selects. Verified: dark popup now dark-bg /
light-text with all options readable (screenshot); harness combobox-popup (25 total) asserts option
contrast + color-scheme across all 10 static selects in light AND dark plus the edit-modal select. All 25
pass; no regression.

## Combobox fully themed (custom widget, not native) — 2026-11-19 (user: "must follow design language")
User clarified the earlier color-scheme fix was insufficient: the dropdown was still the NATIVE OS popup.
Requirement: every combobox must be drawn from the design language (7 packs' tokens), not native widgets.
Implementation: progressive enhancement wraps each <select> in a custom combobox (.cbx): a token-styled
button (surface/bd/r4/fs12/tx1, hover sunken, focus-visible accent ring, rotating chevron) + an absolutely
positioned token-styled listbox (surface/bd/r4, themed thin scrollbar, accent selected row with check,
sunken hover/active). The native <select> is hidden (.cbx-src{display:none}) but remains the value/event
source, so ALL existing onchange/oninput handlers keep working. Sync: label refresh on change/input, on
programmatic .value sets (property descriptor override), and on option rebuild (MutationObserver) so
dynamic selects (member picker, edit-modal status) stay correct; edit-modal selects enhanced on open.
Keyboard (Arrow/Enter/Space/Escape/Tab), aria combobox/listbox/option, outside-click close, single-open.
Context sizing for toolbar/scope-box/add-member/field. Verified screenshots light+dark (ant): listbox uses
pack surface/border/radius, selected accent+check, hover sunken — no native chrome. New harness
combobox-themed (26 total): all 10 selects enhanced + native hidden, listbox bg == token surface, picking
an option fires change (users filter 8->4) + label sync + close. All 26 pass; no regression.

## Adjudication 1 (A): danger button two-tier semantics + cross-pack readability — 2026-11-19
Panel finding F2 (CRITICAL, render-verified): .btn.danger had filled red bg (:117) but a later Profile
rule (:471) overrode only the text color -> text==background in broadsheet (invisible label), ~2.2:1 in
ant/carbon. Ruling A: two tiers. Filled primary-danger (confirm Delete) = new per-pack --danger-solid
(deep red giving >=4.5:1 with white) + --danger-inv text; secondary-danger (Profile Unlink / log-out
other devices) = new .btn.danger.ghost (surface bg + --danger-text + danger border, hover danger-tint).
--txinv proved pack-dependent wrong for red bg (carbon-dark white-on-pink ~2:1), hence dedicated tokens.
Added ant-dark --danger-text:#FF7875 (ghost was 4.35:1). New harness danger-contrast (27 total): WCAG
>=4.5 for filled AND ghost across 7 packs x light/dark; all 27 pass, bad=[].

## Adjudication 2 (A): combobox mirrors select.disabled (system-role scope lock restored) — 2026-11-19
Panel finding F3 (HIGH, render-verified regression from themed-combobox): cbx button ignored
sel.disabled, so system-role scopeSelect (disabled at :855) could still be opened and changed
(all->dept). Ruling A: cbxSyncDisabled mirrors disabled -> btn.disabled + aria-disabled + .cbx-disabled
dim; cbxOpen guards disabled; MutationObserver now watches the disabled attribute so dynamic lock
changes (switching system/non-system role) sync; disabled look opacity .5 + not-allowed. Also cbx focus
ring switched --accent -> --focus (design-system consistency). New harness cbx-disabled (28 total):
system role locked (btn disabled, aria true, no open, value unchanged); non-system re-arms (opens).
All 28 pass.

## Adjudication 3 (A): topbar aligned to real; fictional affordances removed — 2026-11-19
Panel F13 / evidence R2#1-2 falsified "no silent-dead": topbar global search input had no handler and
the tenant "switcher" was a handler-less div; real AdminLayout has NO global search, tenant identity is
a read-only Tag, and menus carry no count badges. Ruling A (donor-method, no invented features):
removed the global search input; tenant switcher -> read-only .tenant-tag (no chevron, title explains
token-set partition); removed all 8 sidebar count badges + dead .badge CSS. New harness topbar-fidelity
(29 total): no global search, tag present w/o chevron + read-only title, 0 badges. All 29 pass.

## Adjudication 4 (A): Settings page added (4 tabs), scope boundary declared — 2026-11-19
Panel F1 (CRITICAL): real AdminLayout has a resident Settings page (general/security/options/email
templates) absent from the prototype and undisclosed. Ruling A: add Settings as the 12th page, grounded
in real Settings.tsx: General (siteName/logoUrl/primaryColor -> updates brand), Security (active sessions
table w/ current Tag + per-row Revoke confirm + log-out-others confirm incl. fail-closed wording; idle
timeout Select wired to session.idle_timeout_seconds option; MFA card w/ setup modal QR+secret+6-digit
code, one-time recovery-codes modal gated by "I have saved" checkbox (Escape/mask cannot dismiss until
acknowledged), disable modal requiring current password; passkeys list + register + remove confirm),
Options (key/value/updated table, sensitive values masked, add/edit via formModal w/ JSON validation,
delete confirm), Email templates (edit subject/body + preview detail). Groups tab machinery scoped to
#groupPanel so Settings tabs don't clash; Settings tables exempted from R4/R6 sticky/fixed/card (.plain)
with overflow-x wrappers. Header comment declares the authenticated-console boundary and lists companion
prototypes (Login/MFA-arm/Magic/Register/Verify/Forgot/Reset/EnrollMfa/Consent/Setup) as TODO-not-here.
Harness: all-pages count 11->12; new settings group (30 total) asserts tabs/sessions/revoke-verb/MFA
one-time gate/masking/JSON-error/preview/idle. All 30 pass. Screenshot: Settings security tab.

## Adjudication 5 (A): API Keys aligned to immutable / revoke-only model — 2026-11-19
Panel F4 / R4#4-5: prototype invented Edit/Delete + scopes editing for API keys; real model is
immutable (revoke-and-recreate), API only list/create/revoke, create form = name+expiresAt (scopes
server-assigned), plaintext shown exactly once (ab_ + 32 chars, DB stores hash). Ruling A: removed
apikeys row Edit/Delete + EDITDEFS/DEL/ROW_NAME/EDIT_ANCHOR entries; revoke now opens a confirm
("stops working immediately, cannot be restored — issue a new key"); create form dropped the scopes
input and now reveals the one-time ab_ plaintext via revealModal with "never shown again" meta;
sample prefixes abk_live_* -> ab_*; subtitle now "immutable — revoke & reissue to change".
New harness apikeys-model (31 total): no Edit/Delete, revoke confirm-gated (cancel keeps Active),
create form name+expires only, reveal ab_ 35-char once. All 31 pass.

## Adjudication 6 (A): Users aligned to real model (mutability / vocab / actions / sort) — 2026-11-19
Panel F5 / R4#9-10 / R2#4: prototype let edit change email/status/tenant; real edit = name+roleIds only
(email read-only, status via independent switch that revokes sessions, tenant is a partition key);
vocab disabled vs real suspended; missing Force logout / Export CSV / sorters. Ruling A: USERS gained a
roles array + Roles column; edit modal = name + roles checkboxes + read-only email/tenant (no status);
status tag became a confirm-gated switch (Suspend/Reactivate, suspend wording revokes all sessions);
vocab suspended everywhere (data/filter/tag); row menu Disable/Enable replaced by Force logout
(confirm, sessions-only wording); overflow gained Export CSV (real blob download); Name/Created headers
sort asc/desc with indicator; page-head sub discloses multi-tenant demo data vs real token partition.
Fixes: tags/esc were late const arrows (TDZ) now hoisted function declarations because renderUsers calls
them at load. Harness synced: filter-narrows suspended, overflow-menu first item = Force logout confirm,
combobox-popup dynamic-select probe moved to Settings idleSelect (users edit no longer has a select),
users-model new group (32 total) incl. narrow-viewport overflow + CSV download + sort. All 32 pass.

## Adjudication 7 (A): Roles permission partition + hierarchy + scope timing + clear confirm — 2026-11-19
Panel F6 / R4#1,#15 / R3#9: prototype matrix let any non-system role toggle platform-only codes
(apikeys:*, tenants:*, options:*, clients:*, permissions:write/delete); real partition is 14
tenant-bindable / 12 platform-only (permission-partition.ts) and tenant binding is refused
(PERMISSION_NOT_BINDABLE). Real editing is Transfer+modal, has parent hierarchy, scope editor only with
users:* (mixed disabled), clear-perms dangerous confirm. Ruling A: matrix kept as a CONCEPT view but
platform-only cells render locked (dashed + lock, disabled) for non-default-tenant roles with a legend
entry; sample roles corrected into the partition (editor 9/26, billing-admin/auditor trimmed); edit modal
gains a Parent role select (data gains parent); scope box shows only when users:* bound and is disabled
for mixed; Clear all button opens a dangerous confirm; legend note states the real console maps to an
AntD Transfer picker saved in a modal. Harness roles-matrix editor count 13->9; new roles-model group
(33 total): 12 locked cells disabled+unchanged on click, editor partition-clean, scope visibility,
parent select, clear confirm -> 0 granted + scope hidden. All 33 pass. Screenshot: locked matrix.

## Adjudication 8 (A): Tenants lifecycle + Init-admin bootstrap aligned — 2026-11-19
Panel F7 / R4#2: prototype delete was a hard splice ("cannot be undone"), suspend flipped instantly,
slug auto-generated, status filter fictional, and the Init-admin bootstrap flow absent. Real: delete is
soft (status->suspended, row kept), suspend/delete revoke all tenant sessions+API keys (reactivate does
not restore), suspend/activate Popconfirm, slug required+SLUG_PATTERN, name-search only, Init admin modal
(email/name/password+policy, 409 EMAIL_EXISTS field error, alreadyBootstrapped branch). Ruling A: added
Init-admin modal + per-row Init button (bootstrapped flags on sample data; EMAIL_EXISTS simulated against
existing user emails; password policy regex; alreadyBootstrapped shows info state); delete now soft
(suspend + confirm wording "soft delete ... kept for reactivation"); suspend/activate confirm-gated with
revoke wording; slug required+pattern on create AND edit (+uniqueness); removed fictional status filter
(harness combobox-popup probe + mgmt-pages switched to name search); tenants actions column widened to
150px so 4 buttons fit. New harness tenants-model (34 total): init flow/policy/EMAIL_EXISTS/bootstrapped,
suspend verb, soft-delete keeps row, slug errors, no status filter. All 34 pass. Screenshot: init modal.

## Adjudication 9 (A): user delete carries the RTBF erasure branch + guards + receipt — 2026-11-19
Panel F8 / R4#3: prototype delete was a generic confirm + splice; real DELETE /users/:id accepts
{eraseAudit:true, legalBasis} (400 VALIDATION_001 when legalBasis missing; erasure requires tenant-wide
'all' scope), runs the sanctioned funnel returning a one-time receipt (hash + rowsAffected), and can
refuse with LAST_ADMIN_GUARD or retryable ERASE_LOCK_BUSY (anchor-worker advisory lock). Ruling A: the
users delete confirm now shows an "Also erase audit data (RTBF)" checkbox revealing a required
legalBasis input (+ all-scope hint); submit validates legalBasis (inline 400), refuses the last active
administrator (inline 409 LAST_ADMIN_GUARD), simulates the anchor lock on the first erase attempt
(inline 409 ERASE_LOCK_BUSY with a Retry button, disclosed as prototype simulation), and on success
shows a one-time erasure receipt (receiptHash 16-hex, rowsAffected, legalBasis, ledger-keeps-hash note)
with Delete hidden and Cancel->Close; plain deletes keep the legacy splice+toast. New harness
users-erasure (35 total): 400/last-admin/lock-busy+retry/receipt/plain-delete; all 35 pass. Screenshot.

## Adjudication 10 (A): Webhooks enabled Switch + delivery vocab + subscription contract — 2026-11-19
Panel F9: prototype "Active" column was a counter (12/5/0) while real is an enabled Switch; deliveries
used success/failed vs real pending/delivered/dead; form lacked description, '*' wildcard and per-event
format validation. Ruling A: Active column -> token-styled Enabled Switch (role=switch, aria-checked,
direct toggle + toast, no confirm like real); pending/dead count columns kept; delivery vocab remapped
(success->delivered, failed->pending unless retries exhausted->dead) and delivCls updated; ping now
records a webhook.test delivery instead of bumping a counter; create/edit forms gain description and
events control with preset chips (*, user.created/updated/deleted, webhook.test) + per-event validation
('*' or ^[a-z]+\.[a-z_]+$) + http(s) url validation; sample data gains enabled/description and legal
event names; actions column widened to 170px. New harness webhooks-model (36 total): switch toggle +
toast, vocab clean, presets=5, url/event inline errors, chip append, description persisted. All 36 pass.

## Adjudication 11 (A): Events catalog/families/date-range aligned to identity events.ts — 2026-11-19
Panel F10: prototype invented role.updated and audit.appended (neither exists in the real catalog);
family filter had audit but lacked group/webhook/auth; no date-range filter (real has RangePicker).
Ruling A: samples remapped to real types (role.changed, auth.login) plus group.changed and webhook.test
examples (8 rows); family filter now user/role/tenant/apikey/group/webhook/auth; from/to date inputs
filter renderEvents by day; fam colors gain group (accent-tint) / webhook+auth (sunken) replacing the
fictional fam-audit; date inputs themed incl. dark color-scheme. Harness mgmt-pages events rows 6->8;
new events-model group (37 total): all types in catalog, no fiction, 7 families, from/to filtering,
group filter. All 37 pass. Screenshot.

## Adjudication 12 (A): three-state contract + full-page error states + toast variants — 2026-11-19
Panel F11: no loading state, empty state only on users, no error/403/404/error-boundary states, success
feedback faked by swapping button text. Ruling A: (1) loading skeleton rows wired to a toolbar Reload
icon on all 9 list pages (real ProTable reload affordance; page switch stays synchronous because
prototype data is local — disclosed in code comment); (2) unified EmptyState component (inbox icon +
title + desc + action) on every list render, distinguishing filter-no-results (Clear filters button
that resets that page's inputs) from truly-empty (Create CTA where a create flow exists); (3) error
banner + Retry on the audit verify failure path (first verify fails with disclosed simulated anchor
lag, retry shows the verified banner) and audit Export became a real CSV download; (4) full-page
403/404/500 states reachable via hash routes #/403 #/404 #/error (no nav items; Back/Retry/Request
access actions; hashchange restores the last content page); (5) toast upgraded to success/error/info
variants with icons + role=status/alert + aria-live, replacing ALL button-text-swap fakes (saveRoles,
revealCopy, export, revokeOthers, pwdSubmit, unwired-menu fallback). Harness mgmt-pages verify now
asserts err-banner then retry->verified; new states group (38 total): skeleton->rows, empty filtered +
clear, truly-empty CTA, error banner + alert toast, retry + polite toast, 403/404/error routing + back +
retry. All 38 pass. Screenshots: 403 page, users empty state.

## Adjudication 13 (A): destructive-action confirm contract completed — 2026-11-19
Panel F12: after rulings 4-8 the remaining zero-confirm destructive actions were group member remove,
Profile OAuth unlink, and log-out-other-devices; real has Popconfirm on all three (Groups.tsx:451-455,
Profile.tsx:210-219 and :376-385). Ruling A: all three now route through the shared confirm modal with
consequence wording — remove member loses every role/permission inherited from the group; unlink means
that identity can no longer sign in until re-linked; log-out-others is fail-closed (kept sessions +
error if revocation fails). New DEL/ROW_NAME entries groups-member / oauth-unlink / sessions-others.
Harness groups-detail and profile synced to confirm-then-execute; new confirm-uniform group (39 total)
asserts cancel-does-not-execute and confirm-executes for all three. All 39 pass.

## Adjudication 14 (A): Clients immutable + full registration contract — 2026-11-19
Panel F14: prototype invented Edit (real API has create/rotate/delete only); create lacked grantTypes /
tokenAuthMethod / backchannelLogoutUri; redirectUris optionality was opposite (real CLIENT_002 requires
non-empty even for M2M, CLIENT_003 https or http://localhost); samples carried refresh_token (not in
ALLOWED_GRANT_TYPES) and an M2M row with empty redirectUris that real create cannot produce. Ruling A:
removed clients Edit button + EDITDEFS (openEdit now guards missing defs; delete anchor kept for the
shared delete delegation); create form gained grantTypes multi-chips (authorization_code /
client_credentials / device_code urn), tokenAuthMethod select (4 whitelist values), scope whitelist
check, backchannelLogoutUri http(s) check, and inline CLIENT_001/002/003/004 + B5 refusal
(none + client_credentials/device_code); generic formCtl builder now honors field types on create;
samples corrected (Web App drops refresh_token; M2M gets an https placeholder redirect URI) and the
page sub discloses immutability + the non-empty-redirectUris-even-for-M2M server rule. New harness
clients-model (40 total): no Edit, 3 grant chips + 4 auth methods + bc field, CLIENT_002/003, B5,
scope whitelist, valid M2M registers with one-time secret. All 40 pass. Screenshot: register modal.

## Adjudication 15 (A): combobox capability parity with AntD Select (resolves divergence C4) — 2026-11-19
Panel F15 / C4: themed custom combobox lacked allowClear / multiple / loading / aria-activedescendant /
typeahead that real AntD Select exercises (UserEdit+UserCreate roleIds = Select mode=multiple+loading;
Users.tsx:192 allowClear; Webhooks.tsx:561 loading). Ruling A keeps the themed外观 but adds the
capabilities: cbx-clear (× on data-clearable selects, clears single value or all multi selections),
cbx multiple mode (chips with per-chip remove + aria-multiselectable list, toggling keeps list open),
cbx-loading spinner (simulated ~400ms on users edit open, disclosed — real fetches roles), typeahead
first-letter cycling + Home/End + aria-activedescendant tracking. Users edit/create roles migrated from
checks (adjudication 6 form) to a native <select multiple> enhanced into cbx-multiple, matching real
UserEdit/UserCreate component form; formSave collects selectedOptions. Chip-remove clicks guarded
against the outer combobox button's stopPropagation. Comment maps 1:1 to <Select showSearch allowClear
mode loading>. Harness users-model roles probe synced to multi select; new cbx-capabilities group
(41 total): clear visibility+effect, typeahead 'c'+aria, Home/End, loading on/off, multi chips add/
remove/clear + save persistence. All 41 pass. Screenshot: chips multi-select.

## Adjudication 16 (A): modal a11y contract (focus trap / initial focus / return / labelledby) — 2026-11-20
Panel F16: openModal/closeModal only toggled .on — focus stayed in the background, Tab escaped the
dialog, close did not return focus, no aria-labelledby. Real AntD Modal (rc-dialog) provides all four.
Ruling A: openModal records document.activeElement as return focus, wires aria-labelledby to the head
h3 (assigning an id when missing), and moves initial focus to [data-autofocus] or the first text
input/textarea else first focusable; a global Tab/Shift+Tab handler cycles focus inside the topmost
open dialog; closeModal returns focus to the trigger when still connected+visible; Escape and overlay
click now route through closeModal (recovery-modal guard preserved). New harness modal-a11y (42 total):
initial focus inside + labelledby=formTitle, trap wrap forward/back, Escape returns to Edit trigger,
detail labelledby=detailTitle, overlay click returns to View trigger. All 42 pass.

## Adjudication 17 (A): tabs WAI-ARIA pattern + keyboard-selectable Roles rows — 2026-11-20
Panel a11y deferred open item: tabs were bare .on buttons (no tablist/tab/aria-selected/aria-controls,
no arrow keys) and Roles selectable rows had no keyboard path. Real Settings uses AntD Tabs (rc-tabs
provides the full APG pattern). Ruling A: both tablists get role=tablist + aria-label; tabs get
role=tab + id + aria-controls + aria-selected + roving tabindex; all six panes get role=tabpanel +
aria-labelledby; syncTabs keeps aria-selected/tabindex in step inside setTab/setSettingsTab; a global
keydown implements Left/Right/Home/End roving focus+activation per tablist; Roles tr.clickable gains
tabindex=0 + aria-selected + Enter/Space selection (re-focus after re-render) + --focus focus ring.
New harness tabs-a11y (43 total): semantics/roving/pane linkage, Right/End/Home/Left-wrap on Settings,
Right on Groups, Roles row Enter/Space selection + aria-selected + focus retention. All 43 pass.

## Adjudication 18 (A): Audit structured verify report + busy + 3 error alerts + range + filtered export — 2026-11-20
Panel Audit surface: verify banners were static strings; real verifyAudit() returns a structured report
(chainOk + rowsChecked + anchorsChecked, or firstFailure{kind,day,seq}) rendered as success/error Alert;
verify/export carry Busy; loadError/exportError/verifyError are three distinct Alerts; filters include a
RangePicker; export is a server-side FULL export honoring filters; status column renders the numeric
status or '-'. Ruling A: verify now async with Busy spinner, first attempt returns a simulated
anchor_mismatch failure report (kind/day/seq, disclosed), retry returns chainOk with rowsChecked/
anchorsChecked meta; export async with Busy, first attempt simulated upstream timeout + exportError
alert + Retry, retry downloads only filter-matching rows (full-export semantics disclosed in page sub);
first audit Reload simulates loadError alert + Retry (sequence-guarded so retry state is stable);
from/to date inputs filter by day and join the clear-filters map; sample statuses remapped to numeric
HTTP-like values incl. null -> '-'. Harness mgmt-pages + states verify steps now await the async Busy;
pagehead-overflow export path awaits failure+retry; new audit-model group (44 total): numeric/'-' status,
range filtering, Busy, failure report fields, success meta, filtered 1-row CSV, load failure+retry.
All 44 pass. Screenshot: verify failure report.

## Adjudication 19 (A): Dashboard real model — live statistics, no chart, wired quick actions, users create — 2026-11-20
Panel Dashboard surface: KPI cards were Total Users/Active Sessions/Tenants/API Keys with invented
deltas; a Sign-in trend chart existed that real Dashboard.tsx does not have; quick actions were four
disabled proto-inert buttons; activity lacked the action/resourceType Tag pair and userId·relTime
description; refresh sat in the page head instead of the activity card head; error Alert + Spin missing.
Ruling A: four live Statistics (Total Users/Active Roles/Active Sessions/Audit Logs) bound to
USERS/ROLES/SESSIONS/AUDIT counts, deltas and trend chart removed; layout 2:1 (activity lg=16 / quick
actions lg=8); activity List items = action Tag + resourceType Tag + userId·relTime; refresh moved to the
activity card head with Spin-like skeleton + simulated first-load failure + error Alert Retry
(disclosed); View all navigates to Audit; quick actions = three wired buttons (Create user opens the
users create form, Manage roles, View audit). The users page-head Create user button was also inert:
now enabled with FORMS.users (name/email/password/roles-multi) + create branch validating email format,
409 EMAIL_EXISTS, and the shared 12+ policy; success pushes the user, prepends a user.created activity
item and refreshes statistics. renderStats initial call moved after demo-data definitions (load order).
Harness dashboard-render synced (no trend); dead-controls refresh path awaits async failure+retry; new
dashboard-model group (45 total): live counts, no deltas/chart, 10 activity tags, refresh-in-head, zero
inert, skeleton+error+retry, wired navigation, create form fields/password type, EMAIL_EXISTS, policy,
count/stat/activity updates. All 45 pass. Screenshot: dashboard.

## Adjudication 20 (A): Profile async contract — Busy + failure branches + name edit validation — 2026-11-20
Panel Profile surface: sendVerify / name-save / password-change / unlink executed synchronously with no
Busy and no failure branch, while real Profile.tsx is fully async (verifyBusy + verifyFailed :61-71;
name Form required + savingName confirm/cancel :226-256; password change revokes sessions + pwdError
:144-151; unlinkError :113-116). Ruling A: sendVerify gains Busy + a simulated first-send failure
(verify-msg err variant) then success; name edit keeps explicit save/cancel but adds required inline
error, savingName Busy and a simulated first-save failure; pwdSubmit gains Busy + a simulated server
rejection branch (fields kept) and clears only on success; unlink routes through a new async run hook
on the shared confirm modal (openConfirm opts.run / submitConfirm d.run) with Busy on the confirm
button, a simulated provider-unreachable failure that keeps the link and turns the confirm button into
Retry, then unlink on retry. Simulated failures disclosed in code comments, consistent with the
audit/dashboard precedent. Harness profile + confirm-uniform synced to the async sequences; new
profile-async group (46 total): verify Busy/fail/retry, name required/cancel/Busy/fail/success, password
Busy/rejection/kept-then-cleared, unlink Busy/failure-keeps-link/retry-unlinks. All 46 pass. Screenshot.

## Adjudication 21 (A): contrast lock extended to all tint-bearing surfaces + per-pack *-text tokens — 2026-11-20
The adjudication-4 contrast lock only asserted semantic tag text. Measured (alpha-composited) across
7 packs x light/dark, 29 tint-bearing surfaces fell below 4.5:1 (material/light ok 4.27 / danger 3.99 /
verify 4.07 / error 3.79; fluent/light verify 4.45; ant/dark activity tag 3.11; carbon/dark 3.64;
cupertino 3.86-4.43; broadsheet/light warn 4.16; dark meta lines 3.17-3.70). Root cause: light *-text
tokens leaked into dark themes and packs lacking them fell back to raw semantic colors; meta lines used
tertiary tx3. Ruling A: an explicit override block defines --ok-text/--warn-text/--danger-text/
--accent-text for EVERY pack x theme (theme-scoped selectors so cupertino's double-attribute light
block cannot outrank them); meta lines (.a-tx .m, .verify-banner .hash, .sys-tag) move tx3 -> tx2;
material dark tx2 lightened. Re-measured: 196 checks, min 4.61, zero failures. New harness
surfaces-contrast group (47 total) locks the full surface set x 14 combos with alpha compositing.
All 47 pass. Screenshot: material dark users.

## Adjudication 22 (A): Settings four-tab parity — gates, validation, load/error states, templates drawer — 2026-11-20
Panel Settings surface: general saved branding instantly with no validation and no localStorage
disclosure; idle Select carried a non-real 15-minute option and had no permission gate / Busy /
saveError; options had no options:read gate, no loading/loadError and no key pattern; templates edit was
a plain modal and preview a static detail (real EmailTemplatesCard uses a Drawer with subjectEn/
subjectZh/htmlEn/htmlZh, a server-rendered STORED-template preview with en/zh locale switch, and a
test-send with recipient validation). Ruling A: general gains inline http(s) logoUrl validation, a
Saved tag and a localStorage-only disclosure (real handleSaveSite is localStorage-only, backend out of
scope); idle drops 15min (real IDLE_OPTIONS = 1h/8h/24h/7d/off), gains an options:write gate, Busy and a
simulated saveError + Retry; options gains an options:read gate (403 banner), skeleton load + simulated
loadError + Retry, and the real OPTION_KEY_PATTERN inline validation; templates edit/preview move into a
right-side drawer reusing the modal focus trap, with four en/zh fields, a stored-template preview
(locale en/zh, SAMPLE_VARS substitution, previewing Busy + simulated previewError + Retry) and a
test-send (recipient email validation, Busy, simulated SMTP failure then success). A demo permission
perspective switch (Administrator / Auditor read-only / Member no-options) exercises the gates.
Harness settings + states synced for the async loads; new settings-model group (48 total): url
validation + localStorage + saved, perspectives gating idle/options, idle 5 values + Busy + error +
retry, options load error + key pattern, drawer fields + stored preview en/zh + unsaved-not-previewed +
test validation/failure/success + save + read-only preview mode. All 48 pass. Screenshot: drawer.

## Adjudication 23 (A): Webhooks async contract — ping queues, toggle/rotate Busy+error+gate, deliveries loading — 2026-11-20
Panel Webhooks surface: ping fabricated an immediately-delivered row (real handlePing reports
pingQueued — a queued webhook.test delivery); the Active switch toggled instantly with no permission
gate / Busy / error (real Switch disabled={!canWrite} + async update + updateError); rotate revealed
instantly with no Busy/error (real async rotateWebhookSecret + rotateError); the deliveries modal
rendered statically (real drawer opens loading then fetches, deliveriesLoadError on failure). Ruling A:
ping now async with Busy, a simulated first pingError, then queues a status=pending webhook.test
delivery (pending count +1) and toasts "Ping queued (webhook.test)"; toggle gains the write gate, Busy,
a simulated updateError and retry success "Endpoint updated"; rotate gains Busy, a simulated
rotateError and retry reveal-once + "Secret rotated"; deliveries open with skeleton rows, a simulated
loadError Alert + Retry, then the real three-state rows; a demo permission perspective switch
(Operator webhooks:write / Auditor read-only) gates switch/ping/edit/rotate/create while deliveries
stay readable. Simulated failures disclosed per the audit/dashboard/settings precedent. Harness
webhooks-model extended (48 total): toggle error-then-update, ping Busy/error/queued-pending, rotate
error/reveal, deliveries skeleton/loadError/retry, perspective gating. All 48 pass. Screenshot.

## Adjudication 24 (A): ApiKeys server-default scopes + expires validation + async create/revoke + copy fallback — 2026-11-20
Panel ApiKeys surface: create hardcoded scopes ['users:read'] while the real UI sends no scopes and the
server defaults new keys to ['*'] (api-keys.ts:54-56); expires was free text with no format/past-date
validation (real DatePicker disabledDate rejects past); create/revoke ran synchronously with no Busy or
error branch (real createError/revokeError); revealCopy swallowed clipboard failures and always toasted
"Copied" (real has fallback + copyFailed). Ruling A: create form gains a date control (min=today) plus
inline YYYY-MM-DD/not-in-the-past validation and a disclosure note (UI sends no scopes; server default
['*']; plaintext once; revoke-only, no rotation); create is async with Busy + a simulated createError
then reveal-once carrying the server-default scopes note; revoke routes through the shared confirm
modal's async run hook with Busy + a simulated revokeError (key kept, confirm becomes Retry) then
revokes; revealCopy tries navigator.clipboard, falls back to a hidden textarea + execCommand, and only
toasts success when a copy actually happened — otherwise an error-variant "Copy failed" toast. Created
keys carry scopes ['*']. Simulated failures disclosed per precedent. Harness apikeys-model extended
(48 total): revoke failure-keeps-key/retry, date type/min/note, past-date rejection, create Busy/failure/
retry, created scopes ['*'], clipboard-rejection + execCommand-false surfaces Copy failed while
execCommand-true copies. All 48 pass. Screenshot: create form.

## Adjudication 25 (A): Roles staged permission editing + empty-save danger confirm + scope fan-out + async delete — 2026-11-20
Panel Roles surface: matrix cells mutated r.perms instantly (real Roles stages bindings in a Transfer
and saves via async doSave with updateError/createError); saving an EMPTY set in the real console raises
a danger Modal.confirm ("deliberate emptying… saves with [] wipe permissions", Roles.tsx:156-166) which
the instant-toggle model had nowhere to host; scopeSelect already disabled for mixed/system but displayed
'all' instead of the real hydration-only 'mixed' value, and change overwrote r.scope with no fan-out onto
users:* permissionScopes (real :120-126 fans only when non-mixed); role delete was synchronous after the
confirm (real async deleteRole + error). Ruling A: cell clicks / scope change / Clear all now stage a
draft with an "Unsaved permission changes" Save/Cancel bar; Save is async with Busy + a simulated
updateError + Retry; saving an empty draft raises the danger confirm (verb "Save empty") through the
shared confirm run hook, failure keeps the draft and the confirm acts as Retry; on commit the non-mixed
scope fans out onto every users:* code in the draft (per-permission scopes map added; billing-admin
sample carries divergent stored scopes -> mixed); mixed shows the disabled Select at value 'mixed' plus
the mixed tag; Cancel restores; role delete routes through the confirm async run hook with a simulated
deleteError then deletes. Matrix legend updated from "concept view" to the staged-edit contract.
Harness roles-model clear path synced to staged+confirm; new roles-edit group (49 total): staged-not-
committed, cancel restore, save Busy/error/retry, scope fan-out, mixed disabled+value+tag, empty draft
danger confirm + failure-keeps + wipe, async delete failure-keeps-row/retry. All 49 pass. Screenshot.

## Adjudication 26 (A): Groups create wired + isDepartment switch + six async points — 2026-11-20
Panel Groups surface: "Create group" was a proto-inert disabled button although real Groups creates
groups (createGroup + isDepartment Switch -> kind, Groups.tsx:104-125); edit lacked the isDepartment
field (:418); detail open, member candidates, add/remove member, saveRoles and delete all ran
synchronously while the real console is async with detailError / memberLoadError / memberAddError /
memberRemoveError / rolesSaveError / deleteError. Ruling A: Create group wired to FORMS.groups
(name required + description + isDepartment switch; formCtl and openEdit gain a switch branch rendered
without a duplicated outer label); edit maps isDepartment <-> kind; openPanel shows skeletons then a
simulated detailError + Retry (banner at panel level so it stays visible on either tab); candidate
load shows memberLoading then a simulated memberLoadError + Retry; add member async Busy + simulated
memberAddError then success; remove member and delete group route through the shared confirm async run
hook with simulated failures that keep the row and turn confirm into Retry; saveRoles keeps the staged
draft but commits async with Busy + simulated rolesSaveError + Retry. Simulated failures disclosed per
precedent. Harness groups-detail rewritten to the async sequences + create-switch assertions;
a11y-keyboard and confirm-uniform synced (49 total). All 49 pass. Screenshot: create form switch.

## Adjudication 27 (A): Tenants bootstrap shared policy + field-level 409 + async create/toggle/delete — 2026-11-20
Panel Tenants surface: init-admin used a stale 8-char password policy while the real bootstrap shares the
UserCreate 12+ policy (Tenants.tsx:34); 409 EMAIL_EXISTS rendered as a banner instead of highlighting the
email field (real setFields precedent); server errors (TENANT_PROTECTED / TENANT_PLATFORM_ONLY /
policy-400) had no inline branch; init/create/edit/toggle/delete all ran synchronously while the real
console is async with initing/createError/updateError/statusError/deleteError. Ruling A: init validates
with the shared pwdPolicyError (12+ upper/lower/digit/special) and renders email/name/password errors at
field level (409 EMAIL_EXISTS highlights email); submit is async with Busy + a simulated TENANT_PROTECTED
inline error + Retry, then bootstraps; create/edit are async with Busy + simulated createError/
updateError + Retry (slug pattern/dup checks kept); suspend/activate and delete route through the shared
confirm async run hook with simulated statusError/deleteError that keep the row and turn confirm into
Retry, with suspended/activated success wording. Policy hint text updated to the shared 12+ wording.
Simulated failures disclosed per precedent. Harness tenants-model synced to field-level errors + async
sequences + create failure/retry (49 total). All 49 pass. Screenshot: init field errors.

## Adjudication 28 (A): Clients enums mirror server + scope required + async create/rotate/delete — 2026-11-20
Panel Clients surface: ALLOWED_GRANTS carried urn:ietf:params:oauth:grant-type:device_code although the
server rejects anything but authorization_code / client_credentials at registration (clients.ts:150);
the tokenAuthMethod select offered private_key_jwt which is not in the real TOKEN_AUTH_METHODS
(basic/post/none, Clients.tsx:38); an empty scope silently defaulted to "openid profile email", masking
the real required rule (:313) and server non-empty check (clients.ts:154); create/rotate/delete ran
synchronously while the real console is async with createError/rotateError/deleteError and reveal-once.
Ruling A: grants reduced to the two server-accepted values; auth-method select reduced to the three real
values; empty scope now raises an inline "scope is required" error (subset whitelist, B5 none-gate and
redirectUris CLIENT_002/003 checks kept); create is async with Busy + a simulated createError then
reveal-once; rotate is async with Busy + a simulated rotateError then reveal-once (flag no longer reset
per click, so retry succeeds); delete routes through the shared confirm async run hook with a simulated
deleteError that keeps the row and turns confirm into Retry. Simulated failures disclosed per precedent.
Harness clients-model synced (grants 2 / methods 3 / scope-required / async create-rotate-delete) and
row-crud clients delete path synced (49 total). All 49 pass. Screenshot: register form.

## Adjudication 29 (A): Events async load + loadError Alert + Search/reset toolbar — 2026-11-20
Panel Events surface: the reload icon re-rendered instantly while the real ProTable request is async with
a try/catch loadError Alert (Events.tsx:96-100,149-170); the real toolbar carries a primary Search button
(reload) and a reset-filters icon button (Tooltip + aria-label, clears filters + reload) which the
prototype lacked (live-input filtering only). Ruling A: reload and a new primary Search button share one
async load path — skeleton rows, then a simulated first-load failure surfaced as an error Alert banner
with Retry, then the real rows on retry; a reset-filters icon button (data-tip + aria-label "Reset
filters") clears search/family/from/to and reloads; the from/to date inputs keep their RangePicker
semantics with a visible "range -> startDate/endDate" disclosure (real maps to startDate/endDate).
Live-input filtering retained as a prototype convenience. Family tags, payload code cell, Fanout
Done/Pending tags and the pretty-printed payload detail modal were already aligned and are kept.
Simulated failure disclosed per precedent. New harness events-load group (50 total): toolbar buttons +
aria/tip + disclosure, skeleton, loadError banner + empty rows, retry restores, Search skeleton + rows,
reset clears filters and reloads. All 50 pass. Screenshot: load error + toolbar.

## Adjudication 30 (A): prefers-reduced-motion degradation + motion regression lock — 2026-11-20
Panel motion surface: the prototype ships five motion families (skeleton shimmer @keyframes skel, busy
spinner @keyframes cbxrot inline + .cbx-load, switch knob and combobox chev transitions, tooltip
translate/opacity, smooth scrollIntoView) with zero prefers-reduced-motion handling, so users who enable
"reduce motion" platform-wide still get shimmer/spin/smooth-scroll; the a11y harness locked focus and
contrast but not motion (same lock-set-smaller-than-surface-set gap as adjudication 21). Ruling A: a
@media (prefers-reduced-motion: reduce) block stops shimmer and spinner animations (spinner keeps its
static ring plus the Busy label), collapses knob/chev/tooltip transitions, removes the tooltip offset
(including the higher-specificity .topbar variant) and forces instant scrolling; openPanel's
scrollIntoView picks 'auto' under reduce via matchMedia. The motion inventory and its AntD motion-token
mapping (motionDurationMid=0) are disclosed in a CSS comment (WCAG 2.3.3 / 2.2.2). New harness
reduced-motion group (51 total): under emulateMedia reduce, skeleton animation-name none, knob/chev/
tooltip transition-duration 0s, tooltip transform translateY 0, scroll-behavior auto; a second
un-emulated page asserts the motion still exists in normal mode (no over-kill). All 51 pass.
Screenshot: reduced-motion users load (static skeleton phase).

## Adjudication 31 (A): bilingual chrome (en/zh) + language toggle + locale-aware relative times + parity lock — 2026-11-20
Panel i18n surface: the prototype was English-only with no language affordance while the real console has
a topbar 中文/EN toggle (stored + navigator probe, aria-label, i18n/index.ts:8-17/111/190-193), en/zh key
parity enforced by i18n/__tests__/parity.test.ts, and relative timestamps that follow the UI language
because Tenants.tsx:57-58 sets dayjs.locale per render (register != activate); the prototype's tenants
created column was even absolute dates while the real one is fromNow(). Ruling A: a topbar language
button (中文/EN swap, aria-label/data-tip, localStorage ab-lang + navigator probe, document.lang) drives
an en->zh translation pass over text nodes and chrome attributes (placeholder/aria-label/data-tip/title)
with a 362-key dictionary plus regex rules for counts, pagination and relative-time forms; data values
(names/emails/ids/urls/JSON/dates/codes) never match keys and stay untouched, with [data-i18n-skip]
exempting group/tenant name cells whose demo names collide with chrome words ("Security", "Default");
originals are stored on nodes so switching back to en restores exactly; a MutationObserver translates
async renders while zh is active. Tenants created now renders relative via relFrom(iso) like the real
fromNow(), and the zh pass localizes it (N 个月前 / 周前 / 天前). The dayjs register-vs-activate gotcha is
disclosed in the layer comment. New harness i18n group (52 total): toggle affordance + stored lang, zh
nav/head/status/placeholder/empty/confirm-verb/settings-tabs/relative forms, data names untouched,
dictionary non-empty + coverage lock, exact en restore, preference survives reload. All 52 pass.
Screenshot: zh tenants.

## Adjudication 32 (A): kit handoff README — 2026-11-20
Commit 5fe8cc4. Added docs/ui/prototypes/README.md as the handoff navigation layer: run instructions,
lock index, simulation disclosure index, adjudication index with commit hashes, provenance and
not-modelled list. (Section reconstructed during the 2026-11-23 panel execution; the original round
shipped the README without a dedicated CHANGELOG section.)

## Adjudication 33 (A): entry-flows companion prototype (nine surfaces) + four auth lock groups — 2026-11-20
The kit covered only the authenticated console; the entire entry layer (Login, MagicLogin, Register,
ForgotPassword, ResetPassword, VerifyEmail, EnrollMfa, Consent, setup wizard) had no reference sample,
so one-time-token consumption, suspended/invalid double branches, consent redirect hygiene and the
setup-vs-console password-policy difference were uncopiable. Ruling A: new companion
docs/ui/prototypes/auth-flows.html reusing admin-console's token packs (data-style x data-theme), theme
toggle and the adjudication-31 zh translation mechanism. Login: inline required errors, async sign-in
with a simulated AUTH_002 then success, magic-link request panel, one-time oauthCode consumption whose
second attempt reports the 401 code-consumed pitfall (Login.tsx:92-98), and a safeOidcRedirect mirror
(api/oidc.ts:53-63: only /oidc/auth|device/, rejects backslash and double-encoded %2F%2F). Magic:
valid/suspended(AUTH_004)/invalid branches. Register: confirm-match + shared 12+ policy + async create.
Forgot: sent alert. Reset: token consumed + confirm. Verify: spin then ok/expired. Enroll: copyable
otpauth URL with clipboard fallback + copyFailed, wrong-code branch (token burns only at the attempt
limit, disclosed), explicit dead-token branch, recovery codes shown once behind an "I have saved" gate.
Consent: load error + Retry, scope checkboxes, approve/deny async with simulated decisionError,
redirecting alert, allowlist refusal. Setup: four Steps with heading focus, admin min-8 policy
(deliberately different from console 12+, disclosed), password-never-stored note, config siteName
required, complete links to console. Four new harness groups (56 total): auth-login,
auth-register-reset, auth-enroll-consent, auth-setup. README gains the companion guide, four lock rows,
adjudication 32/33 rows and entry-flow simulation disclosures. All 56 pass. Screenshot: zh consent.

## Adjudication 34 (A): closure audit — lock set == surface set across both prototypes — 2026-11-20
Final audit of the kit (admin-console.html + auth-flows.html) against the series discipline that the
harness lock set must cover the semantic surface set (adjudications 21/30/31). Three gaps found and
closed: (1) the adjudication-30 reduced-motion block selected .skel/.cbx-load/[style*=cbxrot] but the
companion's busy spinner animates via the .spin class, so it kept spinning under reduce — .spin added to
the degradation selector in BOTH files; (2) the companion's zh dictionary had no parity/coverage/restore
lock — the i18n group now also exercises auth-flows (zh chrome, >100 non-empty keys, coverage list, exact
en restore, data untouched); (3) the companion's new tint surfaces (.auth-ok, .steps-bar on/done,
.code-block, .auth-nav on, recovery banner) were outside surfaces-contrast — the group now measures them
across 7 packs x light/dark (112 checks), which exposed fluent/light 4.21 and cupertino/light 4.23 on the
active nav pill; nav-on and step-on text moved to --tx1 over the tint (min now 4.67, zero failures).
README adjudication-33 commit placeholder filled (cc7aab8) and a 34 row added. Disclosure cross-check:
64 "prototype simulation" strings = en+zh pairs across 13 surface families, all listed in the README
simulation index. Full harness re-run: 56 groups, 0 failures (admin contrast 196+ checks min >= 4.61,
companion 112 checks min 4.67; reduced-motion degraded + normal intact on both files; i18n parity on
both dictionaries). Verdict: the kit is self-consistent — every semantic surface, motion family,
tint-bearing color and locale dictionary is locked, every simulated failure is disclosed, and the
handoff README indexes locks, disclosures, adjudications and provenance. Series closed at 34 rulings.

## Post-closure fix 1 (user-reported): row tooltip obscured by neighbouring rows — body-level floating tooltip — 2026-11-20
Report: in the users detail/list surface the hover hint bubble on row items was hidden behind inline
row content. Root cause analysis found a whole CLASS of clipping/stacking defects in the CSS ::after
tooltip mechanism, not a single position bug: (1) tbody td{overflow:hidden} clips any bubble extending
beyond its cell (Copy/Edit/Delete/More/Manage/Init/rotate/ping/deliveries hints); (2) the sticky actions
column td:last-child{position:sticky;z-index:2} creates a per-cell stacking context, so a later row's
sticky cell paints OVER an earlier row's bubble — exactly the reported symptom; (3) the table wrappers
(div overflow-x:auto), .modal{overflow-y:auto}, .drawer .modal-body{overflow-y:auto}, .matrix-wrap and
.sidebar{overflow:hidden} clip bubbles at their edges. Fix: replace the ::after mechanism in BOTH
prototypes with ONE body-level fixed #floatTip (z-index 600, above menu 400 / modal 50), shown on hover
AND focus of any [data-tip] host (disabled buttons keep their .tip-wrap host), reading the attribute at
show time so the zh pass applies; it flips below near the viewport top, clamps horizontally, and hides
on scroll/resize/Escape/leave/blur — with guards so a focused host's tooltip survives programmatic
scroll and mouse boundary events; aria-describedby links host to tooltip while visible. detailModal's
close button gained data-tip so modal-internal hints exist and are locked. Harness tooltip group
rewritten to lock the whole class: five risky contexts (sticky actions cell, overflow-hidden copy cell,
table-wrapper toolbar, viewport-top flip, modal-internal close) each assert visible + correct text +
opacity 1 + elementFromPoint at bubble center is the tooltip (paint-order proof) + inside viewport +
aria-describedby, plus focus reveal, disabled-wrap reveal and hide-on-leave; reduced-motion group
synced to #floatTip. Full re-run: 56 groups, 0 failures. Screenshot: row bubble unobscured.

## Post-closure fix 2 (user-reported): Create user roles option list unstyled — themed combobox everywhere + option metrics + clipping-proof list — 2026-11-20
Report: the roles option list in the Create user dialog looked bad (row height and styling). Root cause:
enhanceAllSelects() ran only at init and on Settings, so selects built later inside modals were never
themed — the roles field rendered as a NATIVE <select multiple size=4> inline listbox with OS row heights,
OS selection blue and no pack tokens; single-select form fields likewise used OS popups. Comprehensive
scan found the same class in the companion (mkState/vfState/styleSelect native) and a second defect in
the themed list itself: absolute positioning inside modal/drawer/toolbar scroll containers clipped it,
and the selected check mark appeared only when selected, shifting row text on toggle. Fix: openModal now
enhances every select inside the modal; option rows carry AntD-like metrics (min-height 32px, padding
5px 12px, line-height 22px), hover uses --hover, selected uses accent-tint + accent-text with a RESERVED
check column (transparent glyph when unselected, so width never shifts); the list is position:fixed,
placed at open time from the button rect with flip-up near the viewport bottom, horizontal clamp and a
top clamp, content-sized width (max 320px), and closes on scroll/resize; the companion ports the whole
themed-combobox mechanism (CSS + JS) and enhances its selects at init. New harness cbx-option-list group
(57 total) locks: form multi/single selects themed and hidden native, 32px/5px 12px/22px metrics, fixed
list inside viewport with elementFromPoint hitting the option (modal clipping proof), selected tint +
no width shift, flip-up + clamp at 420px viewport, companion parity; surfaces-contrast extended to the
selected-option tint surface in both files. All 57 pass. Screenshot: themed roles list in Create user.

## Post-closure fix 3 (user-reported): allowClear cross on a blank line below the roles control — 2026-11-20
Report: after selecting roles in Create user, a cross icon appeared in the blank space below the option
box. Root cause: the allowClear button was a SIBLING placed after the combobox button; in form fields the
button is width:100%, so the inline-flex cross wrapped onto its own line below the control (same in
toolbar filters once a value is set). A first attempt moved it inside the button, but nested <button> is
invalid HTML and the parser splits it back into siblings. Final fix: keep it a sibling and position it
absolutely (right:6px, vertically centered) inside the relative .cbx wrapper so it renders inside the
control; the chev swaps out while the cross shows (.cbx-has-clear), the value reserves right padding, and
the cross is hidden when the value is empty or the control is disabled (cbxRefresh condition +
.cbx-disabled rule + a disabled guard in its click handler, which previously could mutate a disabled
select). Comprehensive scan: no other widget places an interactive sibling after a full-width control
(chips remove buttons live inside the value; search icons are absolute; add-member/name-form rows are
intentional flex rows); the companion carried a DUPLICATE embedded combobox CSS block from its creation
(the port added a second copy) — the stale copy was removed and the current admin CSS swapped in place,
restoring the 32px option metrics there. Harness cbx-option-list extended: cross is sibling + absolute,
visible with a value, geometrically inside the button rect, wrapper height equals button height (no extra
line), click clears without opening and hides the cross, disabled hides it and ignores clicks, toolbar
filter same geometry, companion same structure. All 57 pass. Screenshot: cross inside the control.

## Post-closure fix 4 (user-reported): edit-group Department checkbox bar — themed switch/checkbox + blanket-rule exclusion + zh action routing — 2026-11-20
Report: the Department control in the edit-group dialog displayed/laid out/styled wrong. Root cause: the
blanket `.field input,.field select,.field textarea{width:100%;padding:6px 8px;border:...}` rule also hit
checkbox inputs, stretching the Department "switch" into a 486x16 native checkbox bar with text-field
border/padding and wrapping its label onto a second line; the same rule stretched the companion's
consent-scope and recovery-gate checkboxes. Fix: the blanket rule now excludes checkbox/radio; all
checkboxes are themed (appearance:none 16px square, border/radius tokens, accent checked state with a
check glyph, focus ring, disabled state) and role=switch inputs render the same 34x20 track + 14px knob
as the .wswitch button (checked = accent track + knob right), with reduce-motion collapsing their
transitions; scope-list/gate labels align center (div.scope-list vs label.scope-list distinguished so the
gate row is not flex-start). Comprehensive scan found a second defect of the same class: the Edit/Delete
click delegates matched English aria-label/data-tip literals, which the zh translation pass rewrites, so
row actions went dead under zh; they now read the en originals the layer stores on nodes
(__i18nEnAttrs), language-independently. New harness switch-checkbox group (58 total): edit/create switch
34x20 + knob 2/16px + track equals .wswitch.on + label centered, gate checkboxes 16px themed, reduce
motion 0s, companion enSaved/scope checkboxes themed + centered; i18n group gains a zh Edit-click
assertion (modal opens under zh). All 58 pass. Screenshot: edit-group switch.

## Post-closure fix 5 (user ruling A): boolean-control rule unification — real + prototype coordinated — 2026-11-23
Question raised: why do some surfaces use Switch and others Checkbox, and would Checkbox be better for
the group Department flag? Analysis showed the mix is a semantic split (AntD: Switch = immediate-effect
toggle, Checkbox = form-submitted marking / multi-select / attestation), not arbitrary — but audit found
two outliers violating the rule (form-submitted switches): real Groups.tsx isDepartment and
UserCreate.tsx isActive, mirrored by the prototype's groups form; plus a parity gap (prototype create
user lacked isActive entirely). Ruling A: unify the RULE, migrate the outliers, keep the domains
disjoint. Real changes: Groups.tsx isDepartment Switch->Checkbox (Form.Item label moved into the
Checkbox child, testid groups-kind-switch -> groups-kind-checkbox), UserCreate.tsx isActive
Switch->Checkbox (child label users.statusActive, new testid users-active-checkbox), unused Switch
imports removed; tsc clean and all 29 real vitest tests pass (i18n parity untouched — existing keys
reused). Prototype mirrors: formCtl/openEdit 'switch' branch replaced by 'checkbox' (ck-field inline
label, themed 16px square, no role=switch), FORMS groups isDepartment -> checkbox, FORMS users gains
['isActive','Active','checkbox',true] (default checked like real initialValues), create handler passes
per-field defaults, formSave users derives status from isActive (active/suspended), dead .sw-field
track CSS removed and reduced-motion selector synced to .wswitch knob + checkbox. Immediate domain
unchanged (.wswitch buttons: webhooks row, detail status). Harness: switch-checkbox group renamed
boolean-controls and re-locked to the rule (form checkboxes 16px/no role/inline label/checked defaults,
immediate .wswitch 34x20+knob+on, gates/scopes 16px centered, reduce-motion 0s both families);
groups-detail createForm assertion now expects checkbox+null role+16px; dashboard-model field list
gains isActive with default-checked assertion. Full re-run: 58 groups, 0 failures. README gains the
boolean-control rule section + migrated-testid disclosure + renamed lock row. Screenshot: edit-group
Department as themed checked checkbox with inline label.

## Post-closure fix 6 (comprehensive follow-up audit): remaining control-representation divergences — 2026-11-23
After the boolean-rule unification, a full re-audit of both prototypes against the real app checked three
axes: rule-domain violations, real<->prototype representation parity, and leftover native/unthemed or
mis-laid-out controls. The boolean rule itself was clean on both sides (real Switch now only Webhooks
row + UserDetail status, both immediate; Checkbox only form-marking/multi/attestation). Three remaining
divergences of the same class were found: (1) prototype client grantTypes rendered as aria-pressed tag
buttons while real Clients.tsx:308 uses Checkbox.Group — converted to a themed checkbox group (ck-group
of ck-field labels), grantsVal reads checked inputs, dead [data-grant] handler removed; (2) prototype
user detail showed status as a read-only Tag while real UserDetail.tsx:139 pairs the Tag with an
immediate-effect Switch (loading + success/error, no confirm) — added a .wswitch data-dstatus toggle
with simulated first-attempt failure then success, re-rendering row + detail; row-level suspend keeps
its confirm like real Users.tsx Popconfirm; (3) dead control branches (formSave 'switch'/'checks',
openEdit 'checks') removed since no defs use them. Webhook events (free-text + preset quick-picks) was
audited against real Select mode=tags with EVENT_PRESETS and judged functionally equivalent
(catalog + custom entries); kept and disclosed in README together with the prototype-only client-side
resource.action validation that real lacks. Harness: clients group grants selectors moved to checkbox
inputs; tooltip group gained detail-switch locks (34x20 .wswitch + knob + on, first-attempt error toast,
second-attempt success toast + row/detail flip to Suspended); boolean-controls gained the grants
checkbox-domain lock (2 inputs, 16px, no role, labels = ALLOWED_GRANTS). Full re-run: 58 groups, 0
failures. Screenshot: user detail Status Tag + immediate Switch.

## Post-closure fix 7 (user-reported): tenants row icon buttons look dead — silent copy feedback class-wide — 2026-11-23
Report: clicking the icon buttons on tenants list rows appeared to do nothing. Per-button reproduction
from a clean state showed Init admin / Edit / Suspend / Delete all open their modals correctly (and the
locked default-tenant row is disabled by design with lock glyphs plus a .tip-wrap hover hint, matching
real Tenants.tsx D5). The genuinely dead-feeling control was the COPY icon: the document-level copy
handler wrote navigator.clipboard and swallowed every rejection with .catch(()=>{}), giving NO success
feedback either — so in clipboard-denied contexts (file://, headless, permission prompts) nothing visible
happened, and even on success the user got no confirmation. This affected EVERY copyable cell class-wide
(users/tenants/clients/webhooks/apikeys ids, slugs, URLs), not just tenants. Fix: AntD copyable-style
feedback — success toast 'Copied' + transient green check glyph (1.2s, .copied color token) with revert;
clipboard-unavailable/rejected paths fall back to a hidden textarea + execCommand('copy'); only when both
paths fail does an error toast 'Copy failed' appear. Comprehensive scan of silent swallows found only this
one user-action handler (the remaining catch(_){} sites are localStorage persistence, disclosed). Real
parity checked: slug stays editable on edit (real Input not disabled), locked actions disabled with lock
glyph (real D5), copyable column feedback mirrors ProTable copyable. Harness tenants-model extended:
copy success toast + #i-check glyph + .copied class, revert to #i-copy after the window, clipboard-reject
+ execCommand-true fallback still 'Copied', both-fail yields 'Copy failed' error toast, locked-row
tip-wrap hint shows on hover, and under zh Edit/Delete/Suspend/Init all still open their modals
(en-original delegates). Full re-run: 58 groups, 0 failures. Screenshot: Acme slug copy icon as green
check with the Copied toast.

## Post-closure panel execution (rulings 1-8, user-adjudicated one by one) — 2026-11-23
Expert panel (5 isolated roles) found 10 HIGH / 21 MEDIUM / 10 LOW + 5 conflicts; user adjudicated all
eight decision points (1A 2A 3A 4A 5C 6A 7A 8B). Executed in five batches:
(1) mechanism/a11y: Escape layering (cbx Esc no longer closes the modal), cbx list survives its own
internal scroll, copy check-glyph timer race fixed, tooltip clears stale aria-describedby, closeModal
focus fallback, detail status switch gains role=switch/aria-checked + focus preservation, disabled row
actions degrade + no hover, --danger-inv defined for dark, invalid ::: scrollbar selectors fixed,
scroll regions keyboard-focusable, companion persists ab_theme/ab_style, webhooks Tried flags hoisted
to module scope (per-open dialog resets kept as disclosed demo semantics).
(2) structure: combobox trigger de-nested to role=combobox div (chip remove buttons valid + tabbable),
hit areas >=24 via pseudo-elements (visual 34x20 / 16px kept), companion ports reserved check column +
accent-text token, error-banner profile clamp scoped to #page-profile, success banner gets .ok-banner.
(3) contrast/scale: tx3 raised per pack/theme and nav-on uses accent-text; contrast lock extended to
7 packs x both themes incl tx3 surface/sunken + nav-on composite (min 4.54); geist spacing scale made
monotonic; raw px fonts tokenized; zh letter-spacing/line-height + lang zh-CN; companion input family
aligned; shadows tokenized light/dark; :active + tabs/pagination/auth-nav hover added.
(4) disclosure/zh: simulation index truth pass (phantom Users create / Profile MFA+session rows removed,
Groups create + detail-status + security loads + fail-closed added, not-modelled list extended), marker
wording normalized, false "real does not validate" claim corrected (identical EVENT_PATTERN), frequency
semantics two-tier; zh dictionary grew 362 -> 425 unique keys covering every dynamic literal + rules for
Exported N rows / Slug exists / event list / bare relative times; new i18n-dynamic source-literal lock;
security tab three-state loads + tplSave bilingual-subject guard + sessions-others fail-closed (confirm
generic toast suppressed when the action reports failure); new security-states lock group.
(5) LOW: fix numbering 1/6 tags, adjudication index title 1-34, CHANGELOG 32 section reconstructed,
SCOPE BOUNDARY TODO comment truthed, companion dead .sw-field port residue removed, duplicate System
key removed, ev-presets become aria-pressed toggles, permissions-seed self-comments 21 -> 26.
Harness: 60 groups, 0 failures (contrast min 4.54 across 14 pack-theme combos; i18n-dynamic 84 admin
literals + companion literals all translate; security-states three-state/guard/fail-closed locked).
Open backlog (explicit): shape/icon scale tokenization (DS-12/L8) deferred to a design ruling round.

## Verification-deepening batch (user ruling B): panel NOT-COVERED automatable subset — 2026-11-23
Executed the automatable part of the panel's not-covered union and locked it. Probes at 640x400
(~200% zoom of 1280x800): no document-level horizontal overflow on users/tenants/settings/audit/roles
(data tables scroll inside their focusable regions); modals and the template drawer fit narrow
viewports; the modal focus trap wraps Tab inside the dialog. Two real gaps found and fixed:
(1) background was NOT inert while a modal/drawer was open (screen-reader virtual cursor and pointer
could reach the page behind) — openModal/closeModal now sync inert on the background containers
(#app > .sidebar / .main; overlays live inside #app so inert must not cover them);
(2) forced-colors mode flattened themed checkbox/switch states (author fills forced to system colors;
headless palette even makes Canvas == HighlightText) — switches keep author system-color rules
(Highlight/HighlightText/ButtonText with forced-color-adjust:none) while checkboxes fall back to the
NATIVE control in forced-colors (appearance:auto, glyph removed) so the OS palette guarantees the
checked/unchecked distinction; selected cbx options and nav-on gain Highlight outlines.
Parity sweep across every real page's control inventory found NO functional gaps (users status/tenant,
audit action/actor/days, events type/range filters all mirror real Select/Input/RangePicker); remaining
divergences are representation-level and now disclosed in README: Roles Transfer -> matrix grid,
Groups/Webhooks Drawer -> panel/modal, DatePicker/RangePicker -> native date inputs + validation +
range note, Profile Descriptions / Dashboard Statistic -> grids/cards. Render spot-checks: carbon dark,
cupertino light, geist light, fluent dark screenshots clean (nav-on readable, tokens consistent).
New harness group a11y-env (61 total): reflow x5 pages, modal fit + trap + inert on/off, forced-colors
native-checkbox fallback + switch state distinction. Manual acceptance (not automatable) disclosed in
README: real screen-reader pass, touch drag, print stylesheet. Full re-run: 61 groups, 0 failures.

## Design backlog execution (rulings 1-3, user-adjudicated one by one A/A/A) — 2026-11-23
Closed DS-12/L8, the last explicit backlog. (1) Icon scale: eight hand-written .ic sizes (10/11/12/13/
14/15/16/17 + display 28/32) remapped to three semantic tiers --ic-s:12 / --ic-m:14 / --ic-l:16 plus
--ic-display:28; cbx-chev and lock-ic tokenized too; control geometry (knob 14, checkbox 16, swatch 14,
scrollbar 10, forced-colors native 13) intentionally stays px. (2) Pop radius: tooltip/cbx-list/toast/
menu/modal now share --r-pop = pack r6 (AntD borderRadiusLG parity: ant 8, cupertino 16, fluent 8,
carbon 0); the edge-attached drawer sheet keeps 0 like real AntD Drawer. (3) Label family: .tag/
.cbx-chip/.sys-tag share --r-tag (base r2); pack personality moved from member-level overrides to the
token (cupertino 999px, material 8px, carbon 0) so the whole family stays intra-consistent. New harness
group shape-scale (62 total) asserts icon tier membership, single pop radius and single label-family
radius per pack across ant/cupertino/fluent. Full re-run: 62 groups, 0 failures. Screenshot: cupertino
create-user dialog with pill chips matching pill tags. README shape-scale section + lock row.

## Post-seal fix 8 (user-reported): narrow-screen sider clipped group labels / Collapse button — 2026-11-23
Report: at ~565px the sidebar showed truncated group words (OVERV/IDENT/ACCES/OPERA/SYSTE) and a
clipped "Collaps" trigger. Root cause: the <=760px media query narrowed the grid to --nav-w-min and
hid .lbl/.brand .name but never applied the .app.collapsed semantics, so .nav .group stayed visible
(white-space:nowrap) and the collapse trigger kept its text at 56px width. Fix: the breakpoint now
owns the collapse with the same semantics as manual collapse (group labels visibility:hidden + 6px
spacers, .side-foot hidden); plus a connected a11y gap found while fixing: display:none on .lbl
removes the link name from the accessibility tree, so icon-only nav (manual collapse OR breakpoint)
now keeps aria-label + hover data-tip on every nav link via syncNavTips() (matchMedia change +
toggle + init after the titles map), localized by the zh layer like other aria/tip attributes.
Also added the missing zh key for the static stat label "Audit Logs". New harness group narrow-nav
(63 total): narrow group hidden/6px + trigger hidden + no sidebar/doc overflow + aria==tip; wide
restores labels/trigger and drops tips; manual collapse hides groups and adds tips. Full re-run:
63 groups, 0 failures. Screenshot: 565px dashboard with clean icon-only sider.

## lesson-review upgrade: script-health lock group (PIT-102 prevention) — 2026-11-23
New harness group script-health (64 total): loads BOTH prototypes, collects pageerror +
console.error (must be zero) and asserts key handlers alive (syncNavTips/syncInert/copyFeedback/tr/
cbxOpen/openModal/closeModal admin; tr/cbxOpen/enhanceSelect companion) plus nav aria-labels >=12 and
rendered rows/flows — a silent top-level TDZ abort (node --check green, page half-dead) now reds the
suite. Verified on BOTH samples per PIT-097: injecting an early syncNavTips() call before the titles
const reds the group; removing it greens it. Full re-run: 64 groups, 0 failures. README lock row.

## Post-seal fix 9 (user-reported): horizontal scrollbar at icon-only sider bottom — 2026-11-23
Report: narrow screen showed a horizontal scrollbar thumb at the sidebar bottom. Root cause: .nav
uses overflow-y:auto, which computes overflow-x to auto; the icon-only group spacers used
visibility:hidden (keeps layout width) with white-space:nowrap, so their text width overflowed the
56px sider and produced the horizontal scrollbar. Fix: .nav overflow-x:hidden (sider never scrolls
horizontally) + icon-only group spacers width:0;overflow:hidden (keep the 6px vertical spacer without
layout width), in both the manual .app.collapsed rule and the <=760px breakpoint rule. narrow-nav lock
extended: nav scrollWidth<=clientWidth + overflowX==='hidden' at narrow. Full re-run: 64 groups, 0
failures. Screenshot: 675px dashboard, sider bottom clean.

## Post-seal fix 10 (user-reported): checkbox label zero gap — descendant label rule specificity — 2026-11-24
Report: Create user "Active" checkbox touched its text. Root cause: .field label{display:block}
(0,1,1) also matched the INNER composite label.ck-field (0,1,0), killing its inline-flex gap:8px;
same for groups isDepartment and the companion recovery gate (label.scope-list self overridden by
.auth-card label). Grants rows escaped because they sit inside .ck-group (not direct children) —
partial-surface normality masked the rule-level defect. Fix: outer-label rules scoped to
.field > label:not(.ck-field) (companion also :not(.scope-list)); gate composite gets a self-selector
label.scope-list{flex-direction:row;gap:8px}. Comprehensive spacing-family scan found no other
zero-gap composite (row-actions 4 / tag 5 / copyable 6 / toolbar-modal-top 8 / nav-brand-panel 10 /
stats 12 / legend 16 all sane). boolean-controls lock extended with geometry dist===8 on visible
surfaces and semantic flex/gap/row on the hidden gate (hidden-block rects are 0, PIT-098). Full
re-run: 64 groups, 0 failures. Screenshot: 8px checkbox-label gap. PIT-106 recorded.

## Post-seal fix 11 (user-reported): STATUS tag occluded at mid width — column floors + 1100px breakpoint + sticky shadow cue — 2026-11-24
Report: at ~940px the API Keys STATUS tag appeared cut off behind the actions column. Root cause:
table-layout:fixed squeezed the status column below tag width; td:has(.tag){overflow:visible} let the
tag overflow into the OPAQUE sticky last column's paint area (sticky itself was correct; the missing
pieces were a column floor and an edge cue). Comprehensive scan of all eight tables at 940/1100/700
confirmed the same class wherever a tag/switch column lacked a floor. Fix: 104px floors for
users-status/tenants-status/apikeys-status/events-type/audit-status, 84px for webhooks-enabled;
over-wide fixed columns rebalanced (apikeys prefix 100 / scopes keeps 170 for the inline-chip lock /
created 80, webhooks events 180, clients grants 160, audit action 180 / time 140, first col 18%,
generic actions 88); new @media(max-width:1100px) hides prio-3 (label() copies th prio to td so rows
stay aligned); sticky last column gains box-shadow -8px 0 12px -8px var(--bd2) as the fixed-edge cue
in both themes. responsive-table lock extended with a mid-width pass: seven tables assert no
horizontal overflow, tag inside its cell, tag clear of the sticky column, and shadow present.
Full re-run: 64 groups, 0 failures. Screenshot: 940px API Keys with complete status tags. PIT-107.

## Post-seal fix 12 (user-reported): row action icon buttons too small / cramped — icon-button scale unified class-wide — 2026-11-24
Report: users row View/Edit/More icons looked undersized and cramped. Probe: ghost row buttons 24x24
with 14px icons and 4px gap, while bordered icon buttons were 30x30/16, inline copy 16x16/12 and
pagination 26x26 — four families, four invented scales. Comprehensive fix: one icon-button scale
(ghost row 28x28/16 gap 8; bordered 32x32/16 incl. modal close; inline copy 20x20/14; pagination
32x32; cbx-clear/chip keep small glyphs with >=24 hit areas per ruling 3A). Two connected defects found
and fixed: (1) .row-actions flex children shrank under table-layout:fixed when the actions column was
too narrow (buttons squeezed to 18px and clipped by td overflow:hidden, intercepting clicks) — added
flex-shrink:0 and per-table actions-column floors sized by button count (users/clients/groups 132,
webhooks 204 for five buttons, roles/apikeys 96, events 88); (2) the opaque sticky last cell did not
follow tbody tr:hover, leaving a mismatched patch on hovered rows — added tr:hover td:last-child
background sync; also removed a duplicate sticky box-shadow rule using raw rgba that overrode fix 11's
token shadow. shape-scale lock extended (ib metrics + hover sync); responsive-table mid-width pass
still green for seven tables. Full re-run: 64 groups, 0 failures. Screenshot: hovered users row with
16px icons, 8px gaps and fully synced row hover. PIT-109 recorded.

## Post-seal fix 13 (user-reported): search vs refresh button height mismatch — two-tier control height scale — 2026-11-24
Report: on Events the search input and the refresh icon button differed visibly in height. Root
cause: no explicit height scale existed — every control family derived its height from
padding+font-size (search ~32, toolbar select/date ~29, btn.sm ~25, icon-btn 32), so one toolbar mixed
four heights; topbar mixed 24/29/32 and card-head mixed 24/32. Comprehensive fix: two-tier tokens
--ctl-h:32 / --ctl-h-sm:24 applied as explicit heights to btn, btn.sm, icon-btn, search input, toolbar
select, date inputs and form input/select; one tier per container family (toolbar / page-head /
modal-foot / form = 32; topbar / card-head = 24 including their icon buttons and the avatar); the
toolbar Search button dropped its sm class; the style-pack select's inline padding style was folded
into the topbar family rule. New harness group control-heights (65 total) asserts each container's
control-height set is a single value equal to its tier across five pages plus topbar/page-head/
modal-foot/form/card-head. Full re-run: 65 groups, 0 failures. Screenshot: 860px Events toolbar with
uniform 32px controls and uniform 24px topbar. PIT-110 recorded.

## Post-seal fix 14 (user-reported): combobox vs refresh button height mismatch — cbx joins the height scale — 2026-11-24
Report: after fix 13 the users toolbar comboboxes still looked shorter than the search input and the
refresh button. Root cause: the themed combobox is a DIV control (.cbx-btn with padding-derived
height ~29) that fix 13's select-height rules never covered; the topbar pack selector (also enhanced)
was 29 among 24px neighbors. The control-heights lock had a blind spot: it sampled .toolbar select,
which enhanceSelect hides (height 0 filtered out), instead of the visible .cbx-btn — a tautological
sample of the same class as PIT-098. Fix: .cbx-btn gets explicit height var(--ctl-h); multi-select
cbx uses min-height + 4px padding so chips can wrap; compact tier (24) applied to cbx inside
.top-actions, .scope-box and .panel-head; companion cbx synced. Lock selectors extended with .cbx-btn
in toolbar/topbar/form plus a new panel-compact probe (scope cbx + matrix Save/Cancel = 24). Full
re-run: 65 groups, 0 failures, every container single-tier including cbx. Screenshot: users toolbar
with cbx, search and refresh all 32px; topbar all 24px. PIT-111 recorded.

## Post-seal fix 15 (user-reported): Create user button wraps at mid width — fixed-height buttons must not wrap or shrink — 2026-11-24
Report: at ~830px the page-head Create user button folded into two lines and painted taller than its
Import neighbor. Root cause: after fix 13 gave .btn a fixed 32px height, buttons remained shrinkable
flex items with default white-space:normal, so the page-head title squeezed them and the label
wrapped beyond the fixed height. Fix: .btn gets white-space:nowrap + flex-shrink:0; the page-head
action group gets flex-shrink:0 so the title text wraps instead of the buttons; tabs and tags gain
nowrap as same-family protection. control-heights lock gains an 830px probe asserting page-head
buttons are single-tier 32, unwrapped (scrollHeight<=clientHeight+1) and no document overflow. Full
re-run: 65 groups, 0 failures. Screenshot: 830px page-head with single-line Create user. PIT-112.

## Post-seal fix 16 (user-reported): matrix panel editing controls on the compact tier — tier assignment by semantics, not container — 2026-11-24
Report: on Roles the Clear all button and the Department scope combobox looked smaller than the
page's other buttons/dropdowns. Probe showed they were internally consistent (24) but sat on the
compact tier while toolbar/form controls use 32; the real contract (Roles.tsx scope Select inside a
Form.Item, default size) is 32. Root cause: fix 13/14 assigned tiers by CONTAINER (panel-head =
compact) instead of by control semantics. Fix: tier assignment now semantic — editing controls
(forms, toolbars, page-head, modal-foot, and the matrix panel editing bar: Clear all / scope cbx /
draft Save / Cancel) use the default 32 tier; compact 24 is reserved for chrome (topbar), secondary
actions (card-head View all) and error-banner retries. clearPermsBtn/mtxSave/mtxCancel dropped their
sm class; the scope-box/panel-head cbx compact override removed. control-heights lock panel probe
renamed panelEditing and asserts 32 (scope cbx + Save + Cancel + Clear all), cardHead/topbar stay 24.
Full re-run: 65 groups, 0 failures. Screenshot: roles matrix panel controls at 32 matching the
toolbar. PIT-113 recorded; README tier wording updated to semantics-based assignment.

## Post-seal fix 17 (user-reported): profile action buttons on compact tier — semantic tier assignment completed across all usage sites — 2026-11-24
Report: Profile mixed 24px actions (Send verification, Log out other devices, Unlink) with the 32px
Change password submit. Root cause: fix 16 defined the semantics rule (editing/actions = 32) but only
migrated the matrix panel; the remaining sm usage sites were never enumerated. Fix: full sm inventory
re-classified — only topbar chrome (langBtn) and the 16 error-retry buttons keep 24; every action
button drops sm (viewAllBtn, sendVerifyBtn, revokeOthersBtn/2, passkeyAdd, tplPreviewBtn, tplTestBtn,
row Unlink); the card-head icon-btn compact override removed so card-head is uniformly 32; inline
link-btn (name edit pencil) joins the inline icon scale (20x20 box / 14px glyph, same family as copy).
control-heights lock extended: profileActions single-tier 32 (sendVerify/revoke/pwdSubmit/bind/unlink),
retriesCompact computed 24px across eight retry ids, cardHead 32, topbar 24. Full re-run: 65 groups,
0 failures. Screenshot: profile with uniform 32px actions. PIT-114 recorded; README tier wording
finalized (compact = topbar chrome + error retries only).

## Post-seal fix 18 (user-reported): cupertino pack selector would not open — two fixed-pop traps — 2026-11-24
Report: after choosing the cupertino pack, clicking the topbar style selector did not open the
dropdown. Instrumenting cbxClose call stacks revealed TWO stacked defects: (1) cbxSetActive used
opts[ai].scrollIntoView({block:'nearest'}); with the last option selected (cupertino) the UA scrolled
an ancestor (the fixed list lives inside the backdrop-filter topbar, so the scroll reached document),
and the capture-phase outside-scroll guard (openCbx.contains(e.target) is false for document-level
scroll targets) closed the pop immediately — packs whose selected option is first (broadsheet) needed
no scroll and appeared fine, a sample-dependent defect. (2) Even when open, the pop was shifted right
by the sidebar width and clipped: backdrop-filter on the cupertino topbar creates a containing block
for fixed-position descendants, so cbxPlace's viewport coordinates resolved against the topbar box.
Fix: active-option scrolling now uses list-local scrollTop math (offsetTop/offsetHeight vs
scrollTop/clientHeight) and never scrolls ancestors; cbxPlace adds a measure-and-correct pass
(getBoundingClientRect delta re-added to left/top) so placement is containing-block agnostic.
shape-scale lock extended with cupOpen {open, aria-expanded, stays open on internal scroll, last
option active, aligned to trigger within viewport}; double-sample verified (restoring scrollIntoView
reds the group, the fix greens it). Full re-run: 65 groups, 0 failures. Screenshot: cupertino dropdown
aligned under the trigger, fully visible, current pack checked. PIT-116 recorded.

## Adjudication 35 — contract extension P0 (admin-ui alignment gap list, 2026-11-24)
Clients create form gains caepEndpointUri (optional, https-only) mirroring real Clients.tsx:338-351
Form.Item rules (type:url + pattern /^https:\/\//): invalid URL and non-https produce FIELD-LEVEL
inline errors (.field-err + role=alert + aria-invalid/aria-describedby, cleared on input), testid
clients-caep-input. ApiKeys create form gains cidrAllowlist textarea (rows=3, one CIDR per line,
blank = unrestricted, testid api-keys-cidr-input) mirroring ApiKeys.tsx:276-286; because the real
validation is server-side, the prototype simulates the server deterministically (octet/prefix bounds)
and echoes "Server rejected CIDR line(s): … (prototype simulation)" as a field error; valid lines pass
and are stored on the key. New fieldErr/clearFieldErr mechanism is the shared inline-error contract for
future Form.Item-rule surfaces. zh keys added; i18n-dynamic prefix sample extended; clients-model and
apikeys-model locks extended (caep url/https/clear/testid/aria; cidr bad/good/testid/rows). README lock
rows + simulation index + adjudication index 35. 65 groups, 0 failures.

## Adjudication 36 — contract extension P1 (user routes + UserDetail, 2026-11-24)
UserCreate/UserEdit route-page contract is represented by the shared modal form (二选一 adjudicated):
same fields, validation and failure states; users create is now ASYNC with a simulated first-attempt
failure ("Create failed: user service timeout (prototype simulation) — retry.", per-open re-arm, zh key)
mirroring real UserCreate createError; retry succeeds and updates stats/activity. UserDetail gains a
real deep-link page #/users/:id (page-user-detail) rendered by the SAME builder as the quick-view modal
(userDetailHtml extracted; modal entry unchanged), with a "Open as full page" affordance in the modal
and Back-to-users on the page; hash router extended (applyHash) alongside #/403/#/404/#/error. The
immediate status switch now also writes an inline .field-err (role=alert) next to the switch on failure
(real UserDetail.tsx:139 inline-feedback precedent) and removes it on success, in both entry points.
Locks: users-model extended (async create fail/retry via USERS.length), dashboard-model create flow
re-timed for async + first-failure, new user-detail-page group (page on/title/switch role+checked/
modal closed/inline error/retry flip/back), all-pages-high-fidelity section count 12→13. README
simulation index + Not-modelled truthed + representation note + lock rows + adjudication 36.
66 groups, 0 failures.

## Adjudication 37 — contract extension P1 (ImportUsersModal, 2026-11-24)
The gray proto-inert Import button on Users is now a live two-phase import modal mirroring real
users/ImportUsersModal.tsx: paste CSV (strict header email,name,password; exactly 3 columns; quoted/
embedded commas unsupported, disclosed via import-csv-limitation alert) -> Check dry-run report
(per-row Valid/Skipped(EMAIL_EXISTS)/Error(password policy) + counts) -> Import commit gated on a
successful check, with a simulated first-attempt commit failure (per-open re-arm, zh key) then retry
commits valid rows into USERS + activity + stats and re-renders the report as Committed/Imported.
Testids mirror real: import-users-open/import-input/import-csv-limitation/import-check/import-commit/
import-report. Modal lives with the other overlays (outside the inert background containers). zh keys
for all new literals incl. busy states; i18n-dynamic scan covers them. New import-users lock group.
README simulation index + lock row + adjudication 37. 67 groups, 0 failures.

## Adjudication 38 — contract extension P2 (login MFA arm + SMS section, 2026-11-24)
auth-flows login gains the two real extension arms: (1) MFA arm — signing in as mfa@globex.com opens
a TOTP card (6-digit input maxlength=6 inputmode=numeric autocomplete=one-time-code, testid
mfa-code-input; mfa-error alert on wrong code; Verify/Cancel) mirroring login/MfaArm.tsx; (2) SMS
section — sms-trigger toggles phone input (sms-phone, 6-15 digits optional +, inline field error),
sms-send busy -> sms-sent alert + sms-code (maxlength 6) + sms-submit; wrong code shows sms-error,
correct code signs in. Demo codes fixed at 123456 (disclosed in-page + simulation index); error
branches deterministic. zh keys for all new literals (duplicate Sending…/Register/Create account keys
deduped). auth-login lock extended (mfa open/bad/ok+maxlen, sms phone err/sent/code maxlen/bad/ok).
67 groups, 0 failures.

## Adjudication 39 — contract extension P2 (settings MfaCard, 2026-11-24)
Security tab gains the fourth card mirroring real settings/MfaCard.tsx: disabled state offers
Set up MFA (mfa-setup-btn) opening a setup modal with QR placeholder + secret + 6-digit code
(mfa-code-input) and Enable (mfa-enable-btn); wrong code shows mfa-enable-error; correct demo code
123456 flips to the enabled state (mfa-enabled-alert + Disable via confirm) and opens the ONE-TIME
recovery-codes modal (8 codes, not reopenable). Testids mirror real (mfa-card/mfa-setup-btn/
mfa-code-input/mfa-enable-btn/mfa-enable-error/mfa-enabled-alert/mfa-disable-btn). New ids namespaced
mfaCard* to avoid colliding with the pre-existing adjudication-4 MFA setup modal (#mfaCode etc.);
DEL['mfa'] registered for the confirm pipeline. zh keys added (pre-existing duplicates deduped).
security-states lock extended (card/off-on states, enable error, enabled alert, recovery 8 codes,
disable confirm restores setup). 67 groups, 0 failures.

## Adjudication 40 — contract extension P2 (standalone 403/404 pages, 2026-11-24)
Real Forbidden/NotFound routes sit OUTSIDE the ProLayout route (App.tsx:285-287), i.e. full pages
without sider/topbar; the prototype previously rendered them as in-main state sections with chrome
visible. Now #/403, #/404 and #/error switch the app into state-mode: sider+topbar hidden, main padding
zero, state section fills the viewport (min-height:100vh), back-to-dashboard CTA promoted to primary
(real Result extra Button type=primary); leaving the hash restores chrome, nav highlight and the last
page. states lock extended (chrome hidden + viewport-filling + primary CTA on 403/404, back restores
single page + sider). 67 groups, 0 failures.

## Adjudication 41 — contract extension P2 (audit server-side full export, 2026-11-24)
The audit export is now modeled as a SERVER job mirroring api/audit.ts exportAuditLogs: busy state on
the export button (testid audit-export), first-attempt upstream failure with the real error testid
audit-export-error + Retry, then a download of the FULL filtered set (server params = current filters,
no client paging) named audit-logs-<ISO>.csv exactly like the real blob download. The client-built blob
stands in for the server stream and is disclosed as such (README not-modelled truthed). audit-model
lock extended: busy during job, error testid, filename prefix, csv row count == full filtered count,
filter-respecting export (POST subset). 67 groups, 0 failures.

## Adjudication 42 — contract extension P2 (forced change + admin reset/invite, 2026-11-24)
auth-flows login gains the forced password-change handoff mirroring real Login.tsx:344-349
(passwordChangeToken → /reset-password?mode=force): signing in as force@globex.com opens a force panel
(new password + confirm, inline policy + mismatch errors) instead of the signed-in state. admin-console
UserDetail (modal + #/users/:id page, shared builder) gains the real admin actions: Reset password
(user-admin-reset) opening a modal with policy validation + simulated first-attempt service failure +
retry (real POST /v1/users/:id/reset-password semantics: sessions revoked, disclosed), and Resend
invite (user-invite) with busy state, success toast for active accounts and "Invite not eligible" for
suspended ones (real UserDetail.tsx:120-128). zh keys for all new literals; auth-login and
user-detail-page locks extended (force open/policy/mismatch/success; reset policy/fail/retry; invite
dual-branch). Cross-cutting sweep: detail action row unified to the 32 tier; i18n-dynamic covers 91
admin literals; contrast/a11y/shape locks unchanged-green over the new surfaces. README lock index 67
+ adjudication 42. 67 groups, 0 failures.

## Post-seal fix 19 (self-caught during contract-extension evidence): standalone state pages clipped by grid auto-placement — 2026-11-24
Evidence screenshots for adjudication 40 showed a BLANK 403 page while the states lock reported
full=true. Root cause: .app uses grid-template-rows var(--top-h) 1fr; in state-mode the topbar and
sider are display:none, so main becomes the first grid item and is auto-placed into the 52px first
row; overflow-y:auto then clips the 600px state page into an invisible window. The lock had measured
the CHILD rect (still 600 while overflowing) instead of the clipping window — a tautological blind
spot of the PIT-098 family. Fix: .app.state-mode collapses to grid-template-rows:1fr; the states lock
gains visible-window probes (main.clientHeight >= viewport-1 and elementFromPoint at viewport center
hits the state page). Double-sample verified: removing the single-row rule reds the group, restoring
greens it. Full re-run: 67 groups, 0 failures. Screenshot: chrome-less centered 403 with primary back
CTA. PIT-117 recorded.

## Gate upgrade (lesson-review round 4): id-uniqueness harness group — 2026-11-24
PIT-118 prevention upgraded to a CI gate: new group id-uniqueness (68 total) scans both prototypes'
markup (scripts stripped) and asserts the id namespace is unique per file. The baseline scan immediately
caught a REAL cross-surface collision: verifyMsg existed twice (audit hash-verify banner span + profile
email-verification div); getElementById first-match meant the profile send-verification handler wrote
the AUDIT span and profile users saw no message (locks had been reading the wrong element too). Fixed
by renaming the profile side to profVerifyMsg (markup + handler + four lock references). Double-sample
verified: injecting a duplicate id reds the group, removing it greens it. Full re-run: 68 groups,
0 failures. README lock index 68; PIT-118 verify field now cites the gate.

## Adjudication 43 — visual grammar B1: border roles + rounded nav selection (2026-11-25)
Grounded in version-pinned official semantics (antd 5.29.3 alias.js colorSplit derived from
colorBorderSecondary; menu itemBorderRadius = borderRadiusLG; M3 active indicator pill): the prototype
had been using the CONTROL border color (--bd, #d9d9d9 in ant) for cards and separators, producing the
"boxed" look versus the real web's hairline cards. Fix: new --bd-hair token (color-mix 40% of --bd into
--surface, per pack/theme) applied to 20 admin + 27 companion structural separators and card borders;
inputs/buttons keep --bd. Nav selection becomes a rounded tinted block (margin 8px inset, radius =
pack --r6; ant 8px) and the Carbon-style full-bleed left bar (::before) is retired. Title single-layer
verified already compliant on all nine list pages (page-head h1 only; card heads belong to sub-panels)
— no change needed, disclosed. shape-scale lock extended: card border != control border, nav radius ==
pack r6, left bar content none. 68 groups, 0 failures. Screenshot: ant light users with hairline cards
and pill nav selection.

## Adjudication 44 — visual grammar B2: ProTable list grammar + density + showTotal (2026-11-25)
Nine list pages split into filter card + table card (ProTable two-card grammar); the table card head
carries reload + row-density + column-chooser icons (pro-table 3.21.0 defaultOptions density/setting
grounded the pair). Row density is functional: default/middle/small tiers via --row-pad on the card
(44/38/34px measured, monotonic, cycles back); column chooser is a toast-disclosed demo (real ProTable
setting), added to the README demo-only list. Pagination keeps the EN builder as single source and the
existing zh I18N rule supplies 第 x–y 条，共 n 条 (a redundant zh branch introduced mid-batch was removed
after the diag showed the rule already owned the wording). New list-grammar lock (69 total): two-card
structure + head tools on eight pages, density monotonic <=58px default, showTotal wording zh/EN.
Batch incident disclosed: the first split script cut at the spacer's own closing tag, prematurely
closing card/section and pushing later sections out of main (blank 403 + dead density); caught by
states/list-grammar locks, markup restored from HEAD and the split re-run with the corrected anchor.
69 groups, 0 failures. Screenshot: ant light users two-card layout.
