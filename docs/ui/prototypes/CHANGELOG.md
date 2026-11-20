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
