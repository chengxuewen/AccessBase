# UI Conformance Wave — Plan (2026-11-25)

Origin: user challenge "实际页面和原型差距太大…没有使用 MCP 对比验证？…有必要增加约束、技能？社区调研" → honest audit (3 failures) + community research (visual closed loop / pixel-diff skill / "green CI ≠ UI safe") → **user approved C1+C2+C3 + MCP-first rule** → this plan.

## §0 The audit (facts, no defense)

1. MCP Playwright used ONCE (W0.7), abandoned on a version error, never used for visual verification — the rev.4 "MCP in-loop" discipline was written but NOT practiced in S1-S3.
2. Visual baselines compare app-vs-itself; **nothing compared app-vs-prototype**. Golden locks verified token VALUES, not composition.
3. "完成/落地/全绿" claims carried gate checklists — none of the gates measured design conformance. The completion definition lacked the evidence.

## §1 Ratified constraints (C1/C2/C3, 2026-11-25)

- **C1**: UI "done" = dual-screenshot evidence (prototype + implementation + gap list) attached. No images = not done. Gate-green ≠ done.
- **C2**: skill `ui-conformance` (`.agents/skills/ui-conformance/` + `.codebuddy` mirror) — capture spec `e2e/conformance.spec.ts` shoots BOTH sides per page (prototype is living: re-shot every run), AI writes the gap matrix into `docs/ui/conformance/report.md` (the deliverable).
- **C3**: CRITICAL (composition-level) gaps must be fixed before "done"; MINOR ledgered. Grading lives in the report, not in vibes.
- **MCP rule**: interactive verification uses the PROJECT's Playwright MCP first; **MCP error/unavailable → STOP and prompt the user to check/fix — silent fallback forbidden**. (Current state: MCP wants chromium-1200, host has 1234 — user notified, awaiting their fix. Capture specs use the repo runner = legitimate test assets, not a bypass.)

## §2 Wave tasks

- **W1 ring build** ✅ DONE this session: skill + mirror link + capture spec + first run (12 prototype + 12 app shots).
- **W2 first baseline report** ✅ DONE (users full matrix + cross-cutting G1-G6; 11 pages captured, AI review scheduled next pass — report says so honestly).
- **W3 route re-ruling — RULED 2026-11-25 (user-adjudicated one by one, 2/2)**:
  - **Adjudication 1 = C — four global surfaces rebuilt to the prototype** (`ConsoleSider` grouped+brand block / `ConsoleHeader` breadcrumb+right action zone / `TableToolbar` search row+filter chips+meta row / `PageHead` title+subtitle+primary actions). Page interiors keep AntD. Startable immediately — NOT gated on the prototype extension. P-1=A (token re-skin) stays as the THEME layer (S1-S3 kept as foundation); the STRUCTURE layer is now C.
  - **Adjudication 2 = B — table-cell contract components** (`EntityCell` avatar+name+sub / `StatusPill` dot+tinted tag via tokens / `Chip` role & label chips / `IconActions` eye-pencil-overflow + tooltips). One set, nine list pages benefit. Closes U1-U3 + G6 → C3 gate clears with NO exemption.
  - Superseded: the report's "A keep / B full rebuild" options. Slice insertion: **S3.5 cell contract components** before S4; S4-S9 scope = adopt the 8 contract components + usage rules (three-states, copy feedback, control tiers). e2e migration: table-toolbar queries + column assertions (~8 specs) move to testids/within-column locators.
- **W4 per-page AI review pass**: remaining 11 page matrices + Broadsheet-pack color re-check (now also serves as the per-slice CRITICAL ledger for S3.5/S4-S9).
- **W5 constraint landing in governance**: C1/MCP rule need a home in AGENTS.md — landed via the skill registration (2e067e6); the C1 completion-definition line itself still rides the skill + this plan + status.md (AGENTS.md prose is the parallel session's file).
- **W6 MCP repair follow-up**: user fixes MCP browser (1200); after repair, first MCP-driven interactive pass over login/pack-switch/collapse with screenshots attached.

## §2.1 Execution order after the W3 ruling (C + B)

```
S3'  Shell rebuild   G1 sider groups + G2 brand block + G3 topbar composition   (AdminLayout + 2 new components)
S3.5 Cell components EntityCell / StatusPill / Chip / IconActions (+ contrast/a11y locks + unit tests)
S4   Page-head + toolbar adoption on the first family (users) — proves the G4/G5 components on a real page
S4-S9 remaining families adopt the 8 components + usage rules; each slice closes its report rows and re-shoots dual images
S10   close (visual baseline refresh after the LAST structural change; full regression; divergence ledger)
```
Per-slice gate (updated): existing gates + **conformance capture + report rows closed (CRITICAL=0 for the touched surfaces)** + MCP interactive pass (or MCP-down reported).

## §3 Gates per UI slice (updated definition)

1. existing: tsc / eslint / vitest / family e2e / visual regression (app-vs-self)
2. **NEW: conformance capture + gap matrix update; CRITICAL=0 or explicitly ledgered with user awareness**
3. NEW: MCP interactive pass (or documented MCP-down + user notified)
4. Delivery report MUST link the dual screenshots + updated report section.

## §4 Sequencing after W3 ruling (recommended C)

G1-G3 shell rebuild (sidebar groups/brand block/topbar composition) → G4-G5 PageHead+TableToolbar contract components → U1-U2 entity-cell/status-tag components → S4-S9 page families adopt the contract components (each slice closes its report rows, re-shoots dual images) → S10 close. The prototype extension (P-7=A) gates S4-S9 page-level locks, NOT the global-surface rebuild — C can start immediately.
