# AccessBase Admin Prototypes CHANGELOG

> Method adopted from MediaServo `docs/ui/prototypes` (single-file HTML,
> design-token system, dual theme, inline interaction, harness assertions,
> versioned archive). Scope ruling 2026-11-18: optimize EXISTING web
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
- **google** (Material 3): large radius 12/16, capsule buttons (999px),
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
- google -> **material** (Material 3; cf. MUI / Material UI precedent)
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
  400 + middle table density. THIS IS THE admin-ui IMPLEMENTATION LAYER —
  the pack gives a 1:1 prototype-to-implementation reference (the real
  product's face). Distinct axis vs the other four (none was the AntD look).
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
