# UI Alignment Refactor — Execution Plan (rev.5; rulings P-1..P-8 + A-1..A-4 ratified; runs 2+3 folds applied)

Date: 2026-11-24 · Origin: user direction → panel run 1 (proposal) → P-1..P-8 → plan rev.2 → **panel run 2 (plan) → A-1..A-4 + folds → rev.3 → test-automation audit → rev.4 → panel run 3 (delta re-review) → rev.5**. Reports: `docs/superpowers/reports/2026-11-24-ui-alignment-panel.md` (runs 1-3).

**Status: RATIFIED, execution-ready for W0 immediately. Blocked from S4+ on the prototype 13-surface extension (P-7=A); S1-S3 early-start allowed with the token-diff gate (A-3=B).**

**rev.5 change log (run-3 folds):** A-2 carrier ERRATUM (phantom `onCollapse(collapsed, type)` — single-param in pro-layout 7.22.7; carrier = collapsedButtonRender intent flag, decision semantics unchanged) · W0.7 rewritten honestly (waitForServer not boot; scratch-DB mandatory — resetBackend is destructive; minimal mandatory set ≈3-5min; per-family CRUD rides its own slice; OAuth round = new increment not reuse; e2e-real dir invisible to testDir) · axe suppression policy written (tags/impact/disable-list/named-exception escape) · first-frame check → double-rAF computed-style sentinel · A-4 transition clause (day-one exception list for 22 files' antd entries) · W0.6 allowlist content deferred to wait point · MCP hard rule (prerequisite-never-substitute) · manual-work honesty ledger · S1/S3/S10 reviewer = code-reviewer subagent.

## §0 Anchor facts (corrected per run-2 evidence audit)

- Global theme = `components/LocaleGate.tsx:27-34` (algorithm only). dataset.theme :22-24. **Write dataset via useLayoutEffect when packs land (flash seam).**
- Store = `stores/ui.ts` (theme, `ui-storage`, partialize theme only — **adding `pack` MUST extend partialize or persistence silently dies**).
- Shell = `layouts/AdminLayout.tsx`: actionsRender :172-195, collapse persist :116-123, menu items :52-63 + permission filter :64-67 (codeOf :40-50). Installed pro-layout **7.22.7** (SiderMenu.d.ts:80: `breakpoint?: SiderProps['breakpoint']|false` — KEY names, not px). Installed antd **5.29.3** (package.json says ^5.24.7 — pin exact at S1; cssVar mode available).
- Stale baseline: `e2e/groups-crud.spec.ts:565,586,587` = 3 refs in 2 test blocks using dead `groups-kind-switch`; app has `groups-kind-checkbox` (Groups.tsx:420). AntD Checkbox assertions (toBeChecked/click) verified sound (proven precedent groups-crud:639).
- i18n: single namespace zh/en.json, parity lock exists, **actual key count 702** (not 474 — floor re-baselined).
- Pack source: broadsheet `:root` admin-console.html:12-26; [data-style] region **:294-384**; broadsheet *-text :386-387. Contract default = broadsheet (:1193,:1223) — **our default diverges by A-1=B, ledgered**.
- 4A must-survive: clients-caep-input (Clients.tsx:338-351) · api-keys-cidr-input (ApiKeys.tsx:276-286) · Consent groups scope (Consent.tsx:12) · Audit server export (Audit.tsx:99-136).
- page.route census **394 / 35 specs**. Auth pages with local brandTheme (colorPrimary only): Login:400/Consent:105/ResetPassword:49/Register:53/ForgotPassword:43/MagicLogin:59/VerifyEmail:34; MfaArm early-return sits OUTSIDE Login's wrap; EnrollMfa + setup/index take NO branding today — **preserve that boundary (branding primary never reaches AdminLayout)**.

## §0.5 Rulings

**Run 1:** P-1=A token re-skin · P-2=B Ant+Broadsheet, 5 ledgered · P-3=light tag freeze (post-extension) · P-4=C full pre-flight · P-5=B centralized CSS exemption · **P-6=A (ERRATUM: `breakpoint="md"`, not `breakPoint={768}` — phantom prop)** · P-7=A prototype extends 13 surfaces first · P-8=B layered slices.
**Run 2:** A-1=**B default pack 'ant'** (zero-shock; Broadsheet opt-in; contract-default divergence ledgered; baselines anchor Ant side) · A-2=**A responsive collapse transient** (persist only user-intent — **ERRATUM run 3: pro-layout 7.22.7 `onCollapse` is SINGLE-PARAM, no `type` discriminator (ProLayout.d.ts:87; the antd Sider type is stripped at SiderMenu.js:271-274 and the click path never passes through antd Sider at all, SiderMenu.js:182-194). Carrier = `collapsedButtonRender` wrapper: the custom trigger sets a user-intent flag read-and-cleared by onCollapse. Decision semantics unchanged.**) · A-3=**B early-start kept + token-diff gate** (pre-merge diff of the prototype's cross-cutting token block; changed → rerun packs checklist before merge; "blocked" wording = S4+ only) · A-4=**B strictest-core whitelist + named per-spec exceptions**.
**Run 4 (2026-11-25, conformance wave — ROUTE AMENDMENT, user-adjudicated one by one):** the first conformance report (`docs/ui/conformance/report.md`) quantified the P-1=A cap — 6 cross-cutting + 2 page-level CRITICAL, ALL composition-level. **Adjudication 1 = C: four GLOBAL SURFACES rebuilt to the prototype** (`ConsoleSider` / `ConsoleHeader` / `TableToolbar` / `PageHead`) — the STRUCTURE layer is no longer re-skin; P-1=A remains the THEME layer (S1-S3 kept). **Adjudication 2 = B: table-cell contract components** (`EntityCell` / `StatusPill` / `Chip` / `IconActions`) — one set, nine list pages. New slice **S3.5** before S4; S4-S9 scope = adopt the 8 components + usage rules. Execution order + updated per-slice gate (conformance rows CRITICAL=0 + MCP pass): `plans/2026-11-25-ui-conformance-wave.md` §2.1. S3' shell rebuild is startable immediately (not gated on the prototype extension).

---

## W0 — pre-flight (start NOW)

### W0.1 Fix red baseline — 3 refs → `groups-kind-checkbox`. Gate: groups-crud green + full e2e green (confirms the run-1 static claim).

### W0.2 Mock consolidation
- NEW `e2e/fixtures/mocks.ts`; 394 inline routes / 35 specs → typed helpers. Shapes verbatim (PIT-033). **Override-timing rule: helpers register in the test body (not beforeEach) where a spec overrides (groups-crud :599 FULL_PERMS_ME pattern) — Playwright last-registered wins.**
- **Console-error whitelists (A-4=B): shared core = INTERSECTION of the three (users-crud:55-62 wide / ui-quality:30-38 narrow / branding:80-87 strictest); any spec needing a wider entry declares it as a NAMED, commented exception in its own file.** Direction is strict-only; loosening requires an explicit ledgered exception. **TRANSITION CLAUSE (run 3): the literal intersection drops `[antd: compatible]`/`[antd: message]`/`Failed to load resource` — currently filtered by 22 spec files. W0.2 lands the shared core AND the day-one named-exception list for exactly those entries in the same commit (pre-enumerated, not discovered-by-red).**

### W0.3 Visual baselines (depends on W0.2 merged)
- NEW `e2e/visual/pages.spec.ts` — **dedicated playwright project, workers:1** (fullyParallel off for visuals). Determinism checklist: `animations:'disabled'`, `caret:'hide'`, `scrollbars:'hidden'` (assertion options), **locale pinned zh**, `document.fonts.ready` awaited (Broadsheet webfont prep), dynamic cells masked via `mask:` (cheaper than per-cell testids; `data-testid="visual-stable"` retained as fallback).
- `maxDiffPixelRatio 0.002` local (0.01 only if/when CI cross-machine lands); config via `use.expect.toHaveScreenshot` block in playwright.config.
- **Frozen fixtures:** `mockVisual(page)` with fixed strings/dates — baselines decoupled from any later legitimate mock evolution.
- 12 menu-level pages × light/dark on the CURRENT look (pack axis lands S1; **Ant-side re-baseline expected minimal per A-1=B**) + 3 key modals.
- Proof is TWO-directional: deliberate pixel change → exactly its page reds; same-machine double-run → idempotent green.

### W0.4 Regenerate design-system skill — paths per §0 reality; pack architecture; P-5 exemption boundary incl. allowlist; control-tier usage rules (**lint-enforced, see W0.6**). Path-resolvable gate. Gate: gate red on a broken path in a throwaway.

### W0.5 No-shrink lock (upgraded shape per run 2)
- NEW `apps/admin-ui/src/__tests__/no-shrink.test.ts` + `baseline.ts` fixture exporting **`Set<testid>` + `ledger: Record<name, ledgerRef>`** (TS, not JSON).
- Assertions: (i) src testid NAME-set == baseline ∪ ledger-deleted, bidirectional; (ii) every ledger entry references a real, non-empty line in a real ledger file (grep-verified — payload, not comments); (iii) testid→file map captured (catches silent moves); (iv) e2e per-FILE `test(` counts ≥ baseline (catches whole-file deletion); (v) i18n key count ≥ **702** + parity; (vi) e2e references no unknown testids.
- RED-first honest (real oracle: current census); deletions only via ledger payload.

### W0.6 Control-tier static lock (restores run-1 ruling "lint-enforced")
- NEW `apps/admin-ui/src/__tests__/control-tier.test.ts`: static scan of tsx for `size="large|small"`, Switch-vs-Checkbox placement vs a **per-page allowlist**. **Sourcing corrected (run 3): the contract mirror does not exist at W0 time — the scanner + EMPTY allowlist land now (RED-first against the current census), allowlist CONTENT fills at the wait point from the mirrored contract**; entries grow per slice (S4-S9 pre-declared at slice start). Audit becomes a gate.

### W0.7 Real-stack smoke lane (rev.4 — the "real functional testing" carrier; REVISED run 3)
- NEW tagged playwright project INSIDE e2e/ (root `testDir './e2e'` does not discover a sibling `e2e-real/` dir — a separate dir would need config surgery). Reuses `e2e/helpers/backend-control.ts` HONESTLY: `waitForServer` WAITS for an already-running stack; `restartServer` is the only full-boot path and carries three known fragilities that W0.7 must fix FIRST: (i) `/tmp/opencode` log dir needs `mkdir -p`; (ii) `accessbase.sh stop`+dev port conflicts with playwright's webServer (5101/5173); (iii) env coupling — document as lane prerequisites.
- **Dedicated scratch DB — `resetBackend()` is DESTRUCTIVE (drop/recreate): the lane must NEVER point at the dev database.** Boot story: reset a throwaway DB → `accessbase.sh dev` stack (cold boot 60-180s) OR reuse a warm stack when present; a dedicated config/project with its own webServer wiring.
- **MANDATORY minimal set at S1/S3/S10 pre-merge (≈3-5min warm): boot + login/logout round-trip + ONE canonical CRUD (users) + pack switch + persistence (S1).**
- **Per-family real CRUD rides ITS OWN slice (S4-S9): that slice's family CRUD against the real stack, 1-2min warm — page-family slices refactor CRUD UI; mock-only would leave them with zero real-backend proof (the exact hole the lane exists to close).**
- Full floor (12 families + MFA path + consent + OAuth round) = on-demand + once at S10. **No portable OAuth scaffolding exists — `oidc-flow` is a server-side vitest file; the real OAuth round is a NEW increment (seed OIDC client in the scratch DB), not a reuse.**
- CI: stays local-only (ci.yml keeps backend DOWN) — the mandatory gate therefore depends on lead's local env; declared.

---

## Wait point — prototype extension absorption

Entry: extension + version tag (work order delivered in-conversation 2026-11-24; **mirror the order into `docs/ui/contracts/` at entry — currently unverifiable in-repo**). Actions: (1) page-inventory diff; (2) **cross-cutting token-block diff (A-3 gate — also re-run at every S1-S3 merge)**; (3) fold page-level locks into S4-S9; (4) **freeze column PRIORITY lists here (moved from S10-entry — S4-S9 need them when touching columns)**; (5) pin tag.

## S1 Theme layer (user checkpoint: first visual proof of pack switching; entry requires visual spec green on HEAD — baseline-rot window closed)
- Files: `theme/packs/{ant,broadsheet}.ts` (`{themes:{light,dark}, cssVars}`); `theme/PackStyleVars.tsx` (vars + `data-pack`, written via useLayoutEffect); `stores/ui.ts` += `pack:'ant'|'broadsheet'` default **'ant' (A-1=B)** + **partialize extended**; LocaleGate merges pack config **inside `useMemo([pack,resolved])`** (object identity → cssinjs re-hash); AdminLayout actionsRender += **labeled pack selector (Segmented/Select with visible labels, i18n aria — contract selector family, extensible to 5 ledgered packs), `data-testid="pack-select"`**; `theme/useConsoleTheme.ts` — per-page merge (same subtree wraps as today; branding colorPrimary NEVER reaches AdminLayout/ProLayout — existing semantic boundary preserved; MfaArm stays outside the branded wrap — ledger both).
- Dark: hand-authored pack-dark palettes; **hover/secondary surfaces enumerated per-surface via real tokens (colorFill* / component tokens — `colorBgContainerHover` does NOT exist, phantom)**. **Evaluate `theme.cssVar:true` (antd 5.29.3) at checkpoint — O(1) pack switch if ProLayout tolerates.**
- Tests: (a) token **golden fixtures derived from the CONTRACT side** (not first-run snapshots) — RED-first viable; (b) cssVars key parity; (c) contrast ≥4.5:1 computed via ONE shared tint-composition util (pack modules + test share it; ~10-line WCAG port — the prototype's is inline ×3, "reuse" = port) over the contract's *-text pairs — **declared PARTIAL coverage; 3-5 e2e getComputedStyle spot checks + axe DOM scan cover derived pairs**; (d) useConsoleTheme merge semantics **+ branding.spec gains a getComputedStyle primaryColor assertion (currently presence-only — the theme seam's e2e protection would otherwise ride pack.spec alone)**; (e) NEW `e2e/pack.spec.ts`: data-pack attr, switch, reload persistence, default ant, Broadsheet+branding-primary coexistence, **flash detector (run 3 form): double-rAF computed-style sentinel — after toggle, sample a token-driven color via getComputedStyle on consecutive animation frames; any frame showing new-pack marker + old-pack color = flash = red. NOT a screenshot assertion (toHaveScreenshot waits for stability — a 1-2-frame flash is invisible to it; no oracle exists for "mixed") — screenshots stay evidence artifacts only.**
- **Modal baselines re-shot in the SAME commit as S1** (link rule — no orphaned stale modals); page re-baselines are the checkpoint artifact.

## S2 Control primitives
- components overrides per run-1 + run-2 fixes: **switch geometry via `components.Switch` tokens (trackWidth/trackHeight/handleSize) — CSS only as fallback, bare-CSS track sizing skews knob travel**; focus ring enumerated per control family or `:where()` low-selectivity (avoid double-ring with antd activeShadow); tinted-selected via components.Select tokens (NOT CSS — chips vs selection would fork).
- `theme/pack-vars.css` exemption file: r-tag family · focus-visible · switch fallback · danger-solid pins · **shadow family (contract 6 values vs 2 token channels — derivation change from run-1's "4 rules", recorded)**.
- Boundary test: **allowlist `{src/index.css}`** (existing .sr-only is compliant — unlisted test self-detonates).

## S3 Shell
- `breakpoint="md"` (=768; P-6 erratum applied); **A-2 carrier (run-3 erratum): `collapsedButtonRender` wraps the default trigger and sets a user-intent flag; the single-param `onCollapse(collapsed)` handler persists ONLY when the flag is set (read-and-clear) — responsive collapse stays transient.** Divergence ledger records trigger semantics + `disableMobile` drawer-mode relationship.

## S4-S9 Page families (per-slice definitions finalized at the wait point)
S4 users (list + 3 routes + import modal; Users.tsx copyable ids) · S5 mgmt lists (+caep/cidr per extension) · S6 roles+groups · S7 settings (+MfaCard) · S8 dashboard/events/audit (Skeleton three-state introduced; server-export surface) · S9 auth 9 surfaces (+MFA arm/SMS/forced-change). Each slice: family spec + page visuals + control-tier allowlist entries pre-declared.

## S10 Close
- errors pages + remaining extension surfaces; responsive-table conversion (9 pages verified) using the **wait-point-frozen column priorities**; divergence ledger finalized; skill refresh; full regression + prototype harness cross-check.

## §4 Test architecture
Contract specs in `e2e/contract/` (role/testid only) — **each contract spec runs an axe-core scan (NEW devDep `@axe-core/playwright`) after load, with a WRITTEN suppression policy (run 3): tags `wcag2a/wcag2aa` + impact ∈ {critical, serious} only; antd-internals disable list (rule + reason, populated from the FIRST real run — axe-on-AntD is a known noise source: modal focus traps, rc-* presentation roles, Select portal duplicate ids); escape process = NAMED commented per-file exceptions + ledger entry, direction strict-only (mirrors A-4 verbatim).** Keyboard honesty on record: **admin 12 pages' keyboard-path coverage is ZERO today — axe is static DOM only; the 9 auth specs carry the real keyboard floors; S4-S9 contract specs add tab-path assertions per family.** Token golden-fixture unit locks per slice. Visual layer per W0.3. Control-tier static lock W0.6. **Real-stack smoke lane W0.7 (revised): minimal mandatory at S1/S3/S10 ≈3-5min warm; per-family CRUD rides its own slice S4-S9 (1-2min warm); full floor on-demand + S10.** **Per-slice gate = token locks + tsc + family spec + quartet {e2e/pack.spec, branding.spec, auth.spec, dashboard.spec} + slice visuals + (S4-S9) the slice's real-stack family CRUD; ≈10min WARM-server conditional excluding the real-stack leg (visuals timed separately).** Full suite + visuals on merge/CI.
Floors (inline, supersedes lost rev.1): 9 auth-surface specs' assertions never weakened · 403/404/500 states · zh/EN parity + count ≥702 · keyboard paths (auth specs + per-family tab paths from S4) · contrast (unit + axe DOM spot) · console-error strictest-core whitelist + day-one exception list · no-shrink name-set lock · control-tier allowlist · real-stack rounds per the W0.7 tiering.

## §5 Coordination
PIT-108 pathspec commits always + pre-commit `git diff --cached --name-only` ownership audit (ours: apps/admin-ui + e2e; theirs: docs/ui/prototypes + .harness; shared: governance files). Sync rule: prototype CHANGELOG touching a landed behavior ⇒ same-PR real-side spec update. Work-order mirror lands at wait point.

## §6 Ledger
5 style packs (additive) · cupertino frosted/material pills (with their packs) · contract-default pack divergence (A-1=B) · ProLayout full narrow-nav parity · branding-primary scope boundary (preserved, documented) · CI screenshot wiring + cross-machine ratio relaxation (post-S1) · shadow-family exemption derivation change · responsive-table overflow beyond S10 scope · opportunistic 212-selector migration · antd exact-version pin.

## §7 Discipline
slice → RED (honest: golden-fixture/behavior = RED-first; pure snapshots = post-impl characterization, labeled) → implement → **MCP in-loop self-verification (lead drives Playwright MCP interactively during slice development: real clicks/inputs/pack-switch/screenshots per the slice's acceptance list — self-check green BEFORE the gate runs). HARD RULE (run 3): MCP self-check is a PREREQUISITE, never a SUBSTITUTE — gate red overrides self-check green; no spec may be skipped/weakened/deferred on MCP evidence; MCP transcripts never appear in merge rationale (archived as supplementary artifacts only); the slice PR carries the gate's run output.** → per-slice gate → independent review on S1/S3/S10 (reviewer = code-reviewer subagent, not the lead) → user checkpoints after S1, before S10. No slice merges red.
**Manual-work honesty ledger (run 3): USER = design signoff at the two checkpoints + baseline-image acceptances per re-baselined slice. LEAD = MCP sessions, named-exception adjudication, wait-point token-diff judgment, ledger upkeep. AUTOMATED = everything else.** Plan rev.1/rev.2 superseded (rev.2 content folded here; rev.1 known only via panel transcription — noted for provenance).
