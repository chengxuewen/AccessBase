# Prototype Concise + Responsive Revision Plan — icon actions, tooltips, narrow-screen

> **Provenance:** user observed "好多都是大段、长文本" in `docs/ui/prototypes/admin-console.html`
> and asked whether icon-buttons + hover tooltips, responsive / narrow-screen adaptation would make
> it more concise, and what mainstream projects do. Analysis delivered 2026-11-19 (analysis-only,
> no code changed). This plan turns that analysis into candidate adjudication points.
> Point-in-time evidence (2026-11-19) with file:line refs below; re-verify before execution.

> **Scope boundary:** visual/interaction layer of the SINGLE-FILE prototype only. No functional
> logic, no design-language identity tokens (accent/radius/font), no dark-mode color model.
> MediaServo-style new pack is PARKED separately as open item **O3** (adjudication 13, deferred) —
> NOT part of this plan.

**Status:** DRAFT — 待裁 (NOT adjudicated). Execution NOT sanctioned. Walk R1→R5 one at a time
via adjudication-walkthrough when the user sanctions; record rulings in the Adjudication record.

---

## Baseline findings (current state, evidence)

1. **Row actions are ALREADY icon-only + native `title`** (24×24 buttons):
   Users View/Edit/More (`admin-console.html:697`), Groups Manage/Edit/Delete (`:760`),
   Clients rotate/more. Style `.row-actions` (`:140-143`); dead Edit/Delete muted (`:355`).
   → the icon-action direction is already taken; the gap is the TOOLTIP MECHANISM + a11y.
2. **Tooltip mechanism = native `title` only.** `grep -c 'class="tooltip|role="tooltip"|\.tooltip'` = 0.
   Native title: ~1s delay, unstyleable, off-theme, NOT shown on keyboard focus or touch.
3. **Primary CTAs = icon + short text** (Create tenant / Issue key / Export / Refresh, `:555-595`).
   These are NOT long-text; mainstream keeps text on primary actions. Leave them.
4. **The real "大段长文本" is TABLE CONTENT, not buttons:** Roles/Groups `Description`,
   Clients `Redirect URIs` (joined) + `Scope`, API Keys `Scopes`, Events `Payload` (JSON),
   Audit `Resource`. Wide tables: Clients/API Keys/Webhooks/Groups = 7 cols, Roles/Audit = 6.
5. **Responsive already has 3 breakpoints** (`:154-155`, `:314`): 1100px (stats 2-col, grid-2→1),
   760px (mini sidebar, hide nav labels/badges/brand, stats 1-col, hide search), 900px (scope-box
   full-width). Tables wrapped in `overflow-x:auto` (`:505-588`) → horizontal scroll only;
   NO column-priority, NO card view, NO sticky action column, NO toolbar overflow.

**Core distinction (drives the whole plan):** icon-buttons + tooltips fix **ACTIONS**;
**CONTENT** long-text needs truncation + tooltip/detail, and narrow-screen needs column-priority /
card / overflow. Do NOT turn content into icons (icons carry no information).

## Principles / constraints (bind every item)

- **P-a** Icon for high-frequency/repetitive/conventional actions; KEEP TEXT on primary /
  low-frequency / ambiguous actions (main CTA stays labeled).
- **P-b** Content long-text is information, never an icon → ellipsis + tooltip/detail/expand.
- **P-c** Icon-only buttons MUST have `aria-label` (accessible name); tooltip uses
  `aria-describedby` and triggers on keyboard focus, not hover-only. Touch has no hover →
  tooltip must not be the only information channel. (Links open item **O2** a11y.)
- **P-d** 7-pack fidelity: tooltip radius/density/color ride each pack's tokens; do not break
  pack identity (carbon square/flat, broadsheet editorial, etc.).
- **P-e** de-AI-slop no-regression: no cliché gradients/emoji; single-file offline (tooltip =
  inline CSS/JS, no external dep).

---

## Candidate adjudication points

### R1 — Tooltip mechanism: native `title` → themed custom tooltip
- **Problem:** finding 2 (native title is slow/off-theme/inaccessible on focus+touch).
- **Options:**
  - **A** Full custom tooltip: token-driven, 7-pack consistent, `aria-describedby`, hover+focus
    trigger, controlled delay, touch fallback (long-press or visible label). [主流: AntD Tooltip /
    Radix / Floating UI; Carbon data-tooltip; M3 icon-button tooltip.]
  - **B** Lightweight CSS-only tooltip (`::after` + `data-tip`, hover/focus show, themed); no JS
    component; touch still limited. (proportionate prototype grade)
  - **C** Keep native `title`, only add `aria-label`.
- **Impact:** foundation for R3/R4/R5 (they reuse the tooltip). Touches all packs.
- **Recommendation:** A (or B if prototype-grade proportionality preferred). C leaves the real gap.

### R2 — Row-action icon buttons: a11y + semantics
- **Problem:** icon-only buttons have `title` but no `aria-label`; "More"(…) is vague.
- **Options:**
  - **A** Add `aria-label` + turn "More" into an overflow menu (secondary actions) + keyboard-operable.
  - **B** Add `aria-label` only (keep "More" as-is).
  - **C** No change.
- **主流:** icon-only needs accessible name; Carbon/GitHub use overflow menu for secondary row actions.
- **Impact:** merges with open item **O2** (a11y). Low risk.
- **Recommendation:** A.

### R3 — Long content cells: truncate + detail
- **Problem:** finding 4 (Description / Redirect URIs / Scope / Payload dumped whole into cells).
- **Options:**
  - **A** `ellipsis` truncate + tooltip full-text + click → detail drawer/modal (structured view,
    best for JSON / multi-URI). [主流: AntD Table `ellipsis` + Tooltip / expandable row.]
  - **B** `ellipsis` + tooltip full-text only (no detail panel).
  - **C** No change.
- **Impact:** depends on R1 tooltip. Content stays readable, table becomes concise.
- **Recommendation:** A (detail drawer suits JSON/URIs); B acceptable minimal.

### R4 — Wide-table narrow-screen adaptation
- **Problem:** finding 5 (7-col tables only horizontal-scroll; no adaptation).
- **Options:**
  - **A** Column-priority (hide secondary cols on narrow) + sticky-right action column +
    card view at very narrow (<600px). [主流: AntD Pro / react-admin / Refine responsive tables.]
  - **B** Column-priority + sticky action column (no card view).
  - **C** Sticky action column only.
- **Impact:** narrow-screen usability; must keep action reachable while横滚. Per-pack density respected.
- **Recommendation:** A (complete) or B (proportionate).

### R5 — Page-head / toolbar narrow-screen overflow
- **Problem:** page-head buttons keep full text on narrow → crowd/wrap.
- **Options:**
  - **A** Keep primary CTA labeled; collapse secondary actions into a "…" overflow menu on narrow.
    [主流: Fluent CommandBar auto-overflow; GitHub narrow collapse.]
  - **B** Iconify page-head buttons on narrow (primary CTA also icon+tooltip).
  - **C** No change (allow wrap).
- **Impact:** B violates P-a (primary CTA keeps text) → NOT recommended.
- **Recommendation:** A.

---

## Phasing / batches (dependencies)

- **P1 (foundation + a11y):** R1 + R2. Do first — R3/R4/R5 reuse R1's tooltip; R2 merges O2.
- **P2 (content concise):** R3 (needs R1).
- **P3 (narrow-screen):** R4 + R5 (need R1; R5 overflow reuses R2 menu pattern).
Each batch: implement → browser verify (7 packs × light/dark × widths) → harness regression →
CHANGELOG + commit (single concern per commit, per repo discipline).

## Verification plan

- **Harness new groups:** tooltip (hover+focus shows, `aria-describedby`), icon-button `aria-label`,
  ellipsis truncation, narrow column-hide / card view, overflow menu. Extend `.harness/prototype.spec.ts`.
- **Browser matrix:** widths 1440 / 1100 / 760 / 600 / 375 × 7 packs × light/dark; screenshot key states.
- **A11y:** keyboard focus triggers tooltip; screen-reader accessible name on icon buttons; touch fallback.
- **No-regression:** existing 15 harness groups stay green; de-AI-slop holds; 7-pack identity intact.

## Open-item linkage

- **O2 (a11y pass):** R1/R2 advance it (icon aria-label, tooltip aria/keyboard). Coordinate, don't duplicate.
- **O3 (MediaServo-style new pack):** PARKED (adjudication 13 deferred). Independent of this plan.

## Adjudication record (to fill when sanctioned)

| Point | Ruling | Date | Note |
|---|---|---|---|
| R1 | **B** (CSS-only themed tooltip) | 2026-11-19 | user-adjudicated; implemented + verified |
| R2 | — | — | — |
| R3 | — | — | — |
| R4 | — | — | — |
| R5 | — | — | — |
## Execution log
- **R1 = B (2026-11-19, implemented + verified):** added themed CSS-only tooltip (`[data-tip]::after`,
  pack-token surface/border/radius, hover + :focus + :focus-within reveal, topbar flips below).
  Migrated 27 icon-only action buttons title -> data-tip + aria-label (21 direct, 6 disabled wrapped
  in `.tip-wrap` so locked/not-wired hints still show on hover — disabled buttons get no :hover).
  Updated the 2 title-keyed selectors (:355 muting, :808 dead-button toast) to data-tip. Kept native
  title on matrix perm-cell / page-head Create / style select (layout / replaced-element safety).
  New harness group `tooltip` (16 total) passes: hover/focus opacity 1, disabled-wrapper hover 1,
  aria-label present. Screenshot: themed "Edit" bubble, no clipping. No regression (16 pass).
