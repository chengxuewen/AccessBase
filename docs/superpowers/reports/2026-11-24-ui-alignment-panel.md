# UI Alignment Refactor — Expert Panel Review (2026-11-24)

**Artifact under review:** proposed undertaking — refactor `apps/admin-ui` (React 19 + AntD 5 + ProLayout, 26 page components / 27 routes, 29 files with data-testid, 37 e2e specs ≈190–203 tests) to align with the prototype design contract (`docs/ui/prototypes/` — admin-console.html 264KB + auth-flows.html + README/CHANGELOG, 7 style packs × light/dark, 65-group locked harness, bilingual, actively refined: post-seal reports 8–14 within 2 days, latest same-day).

**Gate:** Deep, 4 roles — frontend architecture (web-frontend), correctness (code-reviewer), evidence/gap-inventory (evidence-critic), test architecture (test-strategist). Parallel isolated; disagreements preserved.

## Merged verdict

- **Architecture:** FEASIBLE WITH ADJUDICATED EXEMPTION — the prototype's own CHANGELOG (admin-console CHANGELOG.md:71-72) records that ConfigProvider theme.token is isomorphic to the pack mechanism. Token re-skin route viable; ~13 reviewable slices.
- **Correctness:** BLOCK as proposed — no contract freeze mechanism, bidirectional drift already real, e2e baseline already red, phantom skill authority.
- **Test:** BLOCK — zero visual lock (grep toHaveScreenshot = 0); baseline stale.

**BLOCK lifts only via the rulings below + the pre-flight wave (§P-4).**

## CRITICAL (merged)

- **C-1 — moving target (all lenses).** Post-seal 8–14 landed 2026-11-23→24 (CHANGELOG.md:1282-1385); "versioned archive [reserved — not yet populated]" (:5) — the snapshot mechanism was reserved, never built. Any alignment without freeze = chasing a ghost.
- **C-2 — bidirectional drift (corr F2 + evid D).** Real console has 4A-era features the contract does not know: `clients-caep-input` (Clients.tsx:338-351), `api-keys-cidr-input` (ApiKeys.tsx:276-286), Consent `groups` scope (Consent.tsx:12) — prototype greps = 0 hits. Aligning naively deletes functionality. Reverse hole: prototype audit Export models client-side filtered export; real side has Q1-f6 server-side export (Audit.tsx:99-136) the contract doesn't model.
- **C-3 — e2e baseline ALREADY RED (corr F4 + test C1, independent).** `e2e/groups-crud.spec.ts:565,586,587` still use `groups-kind-switch`; the app only has `groups-kind-checkbox` (Groups.tsx:420, migrated by the prototype session's post-closure ruling 15cc20f which touched REAL source). 3 tests stale. Also count corrections: 203 test() sites / 245 testid occurrences (not 198).
- **C-4 — zero visual regression coverage (test C2).** All ~190 tests are behavior/text; a full visual redesign passes green. toHaveScreenshot grep = 0.

## HIGH (merged)

- **H-1 — 212 `.ant-` selector refs / 25 specs** + 151 zh-text assertion lines / 21 specs + 9 specs pinning `localStorage['lng']`. Route decision determines churn: token re-skin keeps them alive; component transplant (`.wswitch/.cbx/#floatTip` DOM) kills 212 refs in one stroke = rewrite of 25 spec files.
- **H-2 — design-system skill is phantom authority (corr F6).** `.agents/skills/design-system/SKILL.md` points at `packages/admin-ui/`, `theme/tokens.ts` (does not exist), `aude-theme` key (0 hits), `zh-CN.json` (real: `zh.json`). Same defect class as the security-check-deprecation incident (E20). Must be regenerated BEFORE refactor; add a path-resolvable gate.
- **H-3 — a11y/contrast floors exist only on the prototype side** (65-group harness locks file:// DOM). Real side: no contrast assertion anywhere, sparse aria, no reduced-motion/reflow/forced-colors.
- **H-4 — harness is rewrite-not-port (test M1, architecture-concurs).** 65 groups bind to hand-rolled DOM/JS lexicals (`declare const GROUPS`, `#userRows tr`, sync data). Recommended: (b) NEW contract specs on the real console + (c) token-level unit locks (pack → ConfigProvider snapshot + programmatic 4.5:1 ratio checks). Option (a) (adapt harness to localhost) rejected 2-vs-1 — disguised rewrite at zero fidelity gain.
- **H-5 — parallel-session collision (corr F3).** PIT-108 recorded as pitfall (AGENTS.md:203) but never codified. Real shared write-surface = governance files. Ownership de facto clean: prototypes/** + .harness = theirs; apps/admin-ui/** + e2e/** = ours.

## Architecture findings (web-frontend, summarized)

- **Pack → AntD mapping:** palettes/radius(3 tiers)/fonts/density/geist table padding/32-24 control heights all express via `theme.token` + `theme.components` (S). Danger two-tier = per-component explicit mapping (M, most tedious). **Six features NOT expressible via tokens:** r-tag family (Tag/Select chip have no borderRadius component token), focus ring (2px --focus, carbon-dark focus=white), cupertino frosted topbar, wswitch 34×20 geometry, material pill buttons, per-container control-tier usage rules (lint-enforced not theme-enforced).
- **Prototype's combobox/tooltip are environment substitutes, not contract essence** — they reverse-mirror AntD metrics (README:25-28); AntD Select (portal) + Tooltip (portal) satisfy the contract semantics with token tweaks (S).
- **Proposed token bridge:** `tokens/{pack}.ts` ×7 exporting `{themes:{light,dark ThemeConfig}, cssVars:{light,dark}}`; one `<PackStyleVars>` writes CSS vars + `data-pack/data-style`; dark = darkAlgorithm + explicit pack-dark palette (prototype dark is hand-authored, NOT inverted — algorithm-derived secondary states must be pinned or contrast locks break).
- **brandTheme conflict:** 7 auth pages each wrap local ConfigProvider (Login.tsx:360-362) — centralize into one `useConsoleTheme()`.
- **Kill risk: ProLayout ≤760px narrow-nav semantics** (contract: forced icon-only + hidden trigger + aria-label groups) — ProLayout's breakpoint behavior cannot be disabled via config. Options: accept divergence / CSS override (fragile) / rebuild shell on antd Layout (L). Needs ruling.
- **Font licensing:** Segoe UI/SF Pro/IBM Plex cannot be self-hosted — packs degrade to fallbacks off-Windows/macOS; degradation matrix must be documented.
- **Real i18n single namespace + parity test (474 keys) already green; AppBridge feedback already green** — two contract surfaces need no work.

## Gap matrix headline (evidence §C)

16 cross-cutting contract features: **4 ABSENT** (packs, contrast lock, skeleton states, reduced-motion), **1 DIVERGENT** (responsive tables — 9/9 pages use `scroll={{x:'max-content'}}` horizontal scroll vs priority-columns+card-mode contract), 3 equivalent-different (tooltip/combobox/i18n), 6 partial, 1 compliant, 1 un-locked. All 12 console pages + 9 auth surfaces EXIST on the real side (IA isomorphic). **13 real-side items have NO contract coverage** (users sub-routes ×3, import modal [prototype button explicitly disabled "not wired"], errors/ ×2, MFA arm + SMS section, MfaCard, caep field, cidr field, server-side export, forced-password-change handoff). Default pack = **broadsheet** (`:root` baseline, admin-console.html:12-26) — not Ant.

## CONFLICT items (preserved for adjudication, one by one)

1. **P-1 alignment route:** token re-skin (AntD DOM preserved, .ant-* survives) vs component transplant (full fidelity, 212-selector massacre). [arch+test converge on re-skin; preserved because it caps fidelity ~90%]
2. **P-2 pack scope + default:** all 7 packs shipped vs subset vs single default. Default pack question (broadsheet is the prototype's :root baseline; Ant is just one of seven). Contrast matrix and visual-baseline size scale with this.
3. **P-3 contract freeze protocol:** version tag + contract.json snapshot + CI diff gate + negative no-shrink gate (testid/feature monotonicity). Owner = prototype session (their tree).
4. **P-4 pre-flight wave scope:** fix C-3 baseline; shared mock fixture (385 inline routes → e2e/fixtures/mocks.ts); visual regression layer (toHaveScreenshot — repo has ZERO precedent, font-noise risk, test recommends, preserved dissent); regenerate design-system skill + path gate; codify PIT-108 ownership/pathspec protocol.
5. **P-5 CSS-var exemption boundary:** scoped hand-CSS allowance for the 6 token-inexpressible features (≤1 central file + tokens modules) vs literal no-hand-CSS doctrine (caps fidelity ~90%).
6. **P-6 ProLayout narrow-nav:** accept+record divergence vs CSS override vs shell rebuild (L).
7. **P-7 uncovered-13 disposition:** extend contract (requires prototype-session cooperation — they own the tree) vs mark out-of-scope-with-record vs extend-in-real-side-only with mirrored contract specs.
8. **P-8 slice plan + per-slice gates:** ~13 slices (S0 baseline → S1 tokens/packs → S2 control primitives → S3 shell → S4-S12 page families → S13 extensions); per-slice gate = token unit locks + tsc + family spec + smoke set; full 190+visuals on merge/CI only.

## Explicitly not covered (panel-wide)

No suite was EXECUTED (read-only constraint) — C-3 "already red" is static inference from two independent lenses (high confidence, needs one confirming run). Pack target undefined in any doc. Real-browser/perf/mobile/SR coverage out of scope. The prototype session's intentions for the reserved versioned archive are unknown to this panel.

---

## DISPOSITION (ruled by user 2026-11-24, one by one)

P-1=A token re-skin (AntD stays; 212 selector refs survive) · P-2=B ship Ant+Broadsheet, 5 packs ledgered · P-3=LIGHT tag-only freeze (post-extension; user attests prototype stable) · P-4=C full pre-flight wave (5 items, starts immediately) · P-5=B centralized CSS exemption (pack-vars.css + boundary test) · P-6=A accept ProLayout divergence (breakPoint 768 + ledger) · P-7=A prototype session extends the 13-surface contract FIRST (work order delivered) · P-8=B layered slices with per-slice gates. BLOCK lifted: execution = plan `docs/superpowers/plans/2026-11-24-ui-alignment-refactor.md` rev.1; blocked only on the prototype extension; W0 runs in parallel starting now.

---

# Panel Run 2 — PLAN rev.2 review (2026-11-24)

**Artifact:** plans/2026-11-24-ui-alignment-refactor.md rev.2. **Gate:** Deep, 4 roles (correctness / evidence / architecture / test). **Verdict: REVISE BEFORE EXECUTION — 1 CRITICAL + 2 BLOCKER-level technical falsifications + 8 HIGH; anchors verified 95% true, rulings transcribed 8/8 faithful; no slice may start until the folds below land.**

- **C-1 (test):** per-slice gates cite an UNDEFINED "smoke quartet" (repo vocabulary collision with hygiene-batch G7 quartet) and S1's core new behavior (pack switch/persist/data-pack) has ZERO spec coverage — gates unexecutable as written. Fix: fix quartet membership (NEW e2e/pack.spec.ts + branding + auth + dashboard) with runtime budget.
- **B-1 (arch):** `breakPoint={768}` is a PHANTOM prop — installed pro-layout 7.22.7 exposes `breakpoint` taking breakpoint KEYS ('md'≈768), not pixels (SiderMenu.d.ts:80). P-6 ruling text carries the phantom — erratum + rewrite as breakpoint="md" + rule the controlled-collapse persistence interaction (viewport resize currently would overwrite the persisted collapsed state via onCollapse).
- **B-2 (arch):** css-boundary test self-detonates on existing compliant `src/index.css` (.sr-only, main.tsx:8) — needs an allowlist {src/index.css}.
- **H-1 (corr):** early-start allowance lacks a cross-cutting token-diff gate — the extension session has historically touched cross-cutting blocks post-seal (adjudication 21 added *-text tokens); plan wording also self-contradicts ("blocked" vs "may start").
- **H-2 (corr):** `colorBgContainerHover` named in S1 is a phantom token (hover surfaces need per-surface enumeration via colorFill*/component tokens); contract's SIX shadow values vs TWO token channels — shadow overflow uncovered by ruling or exemption.
- **H-3 (corr):** W0.2 whitelist consolidation is a semantic change (3 whitelists differ in strength: users-crud wide / ui-quality narrow / branding regex) — union loosens, intersection tightens; unrulled.
- **H-4 (corr):** default pack 'ant' contradicts the contract default (broadsheet, admin-console.html:1193,1223) — P-2 ruled "2 packs" but NOT the default; plan chose silently; W0.3 baselines anchor on the divergent side. USER CONTEST.
- **H-5 (test):** no-shrink count shape is rename-blind — upgrade to bidirectional NAME-set equality with a payload ledger (ledger entries must reference real ledger file lines).
- **H-6 (test):** visual determinism unspecified (animations:'disabled', caret hide, scrollbars, pinned locale, fonts.ready, dedicated project workers=1) + W0.2→W0.3 hard ordering (or frozen visual fixtures) + S1-entry green-run (baseline-rot window) + 0.01 ratio too loose locally (0.002 + masks) + modal baselines must re-shoot with S1 in the SAME commit.
- **H-7 (test):** control-tier usage rules downgraded from the panel-ruled "lint-enforced" to manual audit — restore as static scan test (size=/Switch-vs-Checkbox per-page allowlist).
- **H-8 (evid):** i18n floor 474 is STALE — actual 702 keys (floor must be re-baselined or it greenlights −228). "3 red tests" = 3 refs / 2 test blocks. page.route = 394. rev.1 overwritten (offline "as rev.1" refs unverifiable — inline floors). Work order NOT in repo (wait-point entry unverifiable). Contrast "algorithm reuse" overstated (inline ×3 in harness — manual ~10-line port). antd actual 5.29.3 not ^5.24.7 (cssVar mode available; version pin advised).
- **MEDIUM folds:** MfaArm wrap placement + branding-primary must NOT reach AdminLayout (existing semantic boundary — preserve, document) · S1 memo the merged ThemeConfig + useLayoutEffect for dataset writes + evaluate cssVar:true · column-priority freeze moves from S10-entry to the wait point · contrast mapping declared PARTIAL (shared tint-composition util + 3-5 e2e computed-style spot checks) · two-direction baseline proof (catch red AND idempotent green) · quartet runtime conditional (cold vs warm).

**Adjudication agenda:** A-1 default pack (USER) · A-2 breakpoint erratum + collapse-persistence semantics (USER, sub-ruling) · A-3 early-start keep/drop + token-diff gate (USER) · A-4 whitelist consolidation direction (USER). All other findings = mechanical folds into plan rev.3.

**DISPOSITION run 2 (ruled by user 2026-11-24):** A-1=B default pack 'ant' (zero-shock; contract-default divergence ledgered) · A-2=A responsive collapse transient (persist only clickTrigger) · A-3=B early-start kept + pre-merge token-diff gate · A-4=B strictest-core whitelist + named exceptions. All mechanical folds applied to plan rev.3 (quartet defined incl. NEW pack.spec; breakpoint erratum; boundary allowlist {src/index.css}; phantom-token fixes; name-set no-shrink lock; 702 floor; determinism checklist; frozen visual fixtures; control-tier static lock W0.6; golden-fixture RED; column-priority freeze at wait point; work-order mirror requirement). VERDICT: plan rev.3 EXECUTION-READY for W0.

---

# Panel Run 3 — rev.3/rev.4 DELTA re-review (2026-11-24)

**Artifact:** plan rev.4 delta (A-series applications, mechanical folds, test-automation upgrades). **Gate:** Standard, 3 roles (correctness / evidence / test). **Verdict: REVISE — 1 CRITICAL (A-2 carrier is a SECOND phantom API of the breakPoint family: pro-layout 7.22.7 onCollapse is single-param, type stripped at two layers — carrier re-specified via collapsedButtonRender intent flag) + 6 HIGH (W0.7 mechanism misattribution + unbounded mandatory set + destructive resetBackend; first-frame check false-negative by design; axe suppression policy absent; A-4 intersection reds 22 files day-one; MCP loophole). All findings text-level; no user contests — folded directly.**

**Folds applied to rev.5:** onCollapse erratum + carrier · W0.7 rewrite (honest boot story, scratch-DB mandate, minimal mandatory ≈3-5min, per-family CRUD per slice, OAuth = new increment, testDir constraint) · axe policy (tags wcag2a/wcag2aa + impact critical/serious + antd disable list + named-exception escape) + keyboard-honesty line · first-frame → double-rAF sentinel (not screenshot) · A-4 transition clause (day-one named list) · W0.6 content deferred to wait point · MCP hard rule (prerequisite-never-substitute; gate red > self-check green) · manual-work honesty ledger · reviewer assignment (code-reviewer subagent). Evidence run confirmed: anchors/counts verified (394/702/7 files 7/7), quartet files exist, work-order mirror requirement intact.
