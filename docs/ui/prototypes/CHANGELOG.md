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
