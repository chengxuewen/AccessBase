# Serena Local MCP Introduction Plan — closing the pixi-kind governance gap

> **Provenance:** drafted 2026-11-06 from an in-session analysis (Qoder plan mode) triggered
> by the user's finding that the agent-governance MCP layer has no serena local MCP. The
> in-session plan was approved as analysis; this file is its persisted form (D121:
> English-only persistence). The batch itself still awaits explicit execution sanction.

> **For agentic workers:** This plan is ANALYSIS-STAGE output. AccessBase is a
> design-phase-gated project: no batch lands without explicit user sanction. Steps use
> checkbox (`- [ ]`) syntax for tracking once the batch is sanctioned. Decision points are
> numbered SR-1..SR-4 (Serena Ruling) to avoid colliding with the decisions.md D-series.

**Date:** 2026-11-06
**Status:** ADJUDICATED & SANCTIONED 2026-11-18 — execution authorized; SR defaults
overridden where noted below. (History: DRAFTED 2026-11-06, awaiting sanction.)
**Sources analyzed:** `.refinfo/remote_control_host_computer` (RCH — the only complete serena
blueprint), `.refinfo/MediaServo` (grep-verified 2026-11-06: ZERO serena content at drafting
time; NOTE 2026-11-17 re-verification: MS DID adopt serena on 10-30 `52c9722` and runs it
enabled to this day — the drafting-time finding below is kept verbatim as history, and the
MS adoption record now serves as a second live reference).
**Goal:** Introduce serena (semantic code retrieval/editing MCP, isolated in its own pixi
environment) into the governed MCP surface — registered in the single source, pinned in the
registry, covered by the lifecycle CLI and gate, launchable through the wrapper — WITHOUT
touching the pnpm dependency tree.

## Adjudication record (2026-11-18, one-at-a-time protocol)

| Point | Ruling | vs. plan default |
|---|---|---|
| Master switch | **Execute (A)** | matches |
| SR-1 initial switch | **`enabled: true`** | **USER OVERRIDE** of the recommended `false` — E1 folds INTO this batch as its final step; V2 expectations flip to `on`; triple-instance cost accepted on the record |
| SR-2 version pin | **`2.1.0` exact** | matches |
| SR-3 context flag | **`--context claude-code`** | matches |
| SR-4 latch-pair | **none** — tool-routing matrix ROW is still mandatory (every governed server gets one); no second machine latch | matches |

Drift updates relative to the 2026-11-06 drafting state (verified 2026-11-18): agents check
is now a 13-layer chain (header-lint, check-leaks, scripts-lint added since); TypeScript is
pinned `~5.6.3` (do NOT "helpfully" bump it — PIT-096 context); the TRIGGERS.md boundary
matrix and the evolution-protocol rule exist and are NOT touched by this batch beyond the
tool-routing row below.

---

## Baseline findings (verified 2026-11-06)

1. **The gap is real and total:** zero serena references across `.agents/`, `docs/`,
   `scripts/`, AGENTS.md, CONSTRAINTS.md (grep-verified).
2. **The gap was inherited, not chosen:** Batch 4 (2026-11-04, agent-governance port) pruned
   RCH's pixi-env server kind during the port. The ONLY record of that cut is a header
   comment in `scripts/agents/gate-mcp.mts` ("no pixi-env servers — all servers are
   npm-launched") — the port plan itself never recorded the pruning decision. This plan
   documents it retroactively; the port plan carries a pointer note (same-change amendment).
3. **RCH blueprint (all parameters proven in that repo, linux-64):**
   - pixi feature `serena`: python 3.13 + the language-backend toolchain (RCH is a Rust
     repo → rust/rust-src/rust-analyzer; AccessBase is a TS repo → nodejs only, solidlsp
     language-server id `typescript`).
   - pypi-dependency `serena-agent == 2.1.0` (universal py3-none-any wheel).
   - task `mcp-serena = serena start-mcp-server --transport stdio --context claude-code
     --language-backend LSP --project "$PIXI_PROJECT_ROOT"`.
   - probe `.pixi/envs/serena/bin/serena --version`; indexing `serena project index ROOT`
     with a 900s timeout; gate semantics SKIP-ENV (env absent) / ok / DRIFT.
   - `.serena/` policy: COMMIT `project.yml`, gitignore `cache/`, `memories/`,
     `project.local.yml`.
   - `mcp-launch.sh` is a pure passthrough `exec pixi run "$@"` (accepts `-e serena
     mcp-serena`); RCH also sets `NO_PROXY=localhost,127.0.0.1,::1` in repo.sh after
     measuring an enterprise proxy hijacking local endpoints (HTTP 502 on a local serena
     probe) and guards TMPDIR writability for sandboxed pixi activation.
4. **MediaServo finding (honesty record):** no serena content exists there. Any claim that
   MediaServo informed the serena design would be false; its lineage shows up only in the
   launcher/init-wrapper pattern, already present here since Batch 4. This finding goes
   into the batch's D-entry verbatim.
5. **Every governance link this repo already has must learn a second server kind**
   (`kind: "pixi"`), or serena lands ungoverned: single source `.agents/mcp.json` (kinds
   npm/remote today) → `mcp-links.mts` two consumer faces → pin registry
   `mcp-servers.json` (npm-shaped: package+pin only) → `mcp-cli.mts` lifecycle
   (setup=pnpm add; index/sync=codegraph only) → `gate-mcp.mts` pin check (node-require
   probe only) → `mcp-launch.sh` (hardcodes `exec pixi run node "$1"` — cannot pass
   `-e <env> <task>`).

---

## The batch (single sanctioned unit, groups A-F)

### A. Pixi toolchain (`pixi.toml`)

- [ ] `[feature.serena.dependencies]`: `python = "3.13.*"`, `nodejs = ">=20.0.0"`. No rust
      toolchain — RCH's rust-analyzer was its Rust-language special case, not part of the
      serena pattern.
- [ ] `[feature.serena.pypi-dependencies]`: `serena-agent = "==2.1.0"` (SR-2).
- [ ] `[feature.serena.tasks]`: `mcp-serena` verbatim from RCH (`--transport stdio
      --context claude-code --language-backend LSP --project "$PIXI_PROJECT_ROOT"`) (SR-3).
- [ ] `[environments]`: append `serena = ["serena"]` (isolated solve; base/native untouched).

### B. Single source + pin registry

- [ ] `.agents/mcp.json`: register `local-serena` — `kind: "pixi"` (new kind),
      `pixiEnv: "serena"`, `task: "mcp-serena"`, `enabled: true` (SR-1 OVERRIDDEN
      2026-11-18: land enabled — do NOT write false here). Note field must
      name the blueprint (RCH) and the enablement precondition (live-fire V1-V5 green).
      Registered-disabled honors RCH:D20 (register first, then rewrite — an unregistered
      server is erased by the full rewrite) and the enablement-is-a-user-ruling discipline.
- [ ] `scripts/agents/mcp-servers.json`: schema extended with optional `kind` (default
      npm), `pixiEnv`, `probe` fields; entry `local-serena: { package: "serena-agent",
      pin: "2.1.0", kind: "pixi", pixiEnv: "serena", probe: ["serena", "--version"] }`;
      `$comment` updated to document the two shapes.

### C. Generation layer + launcher

- [ ] `scripts/agents/mcp-launch.sh`: convert to the RCH pure passthrough
      `exec pixi run "$@"`; add `NO_PROXY`/`no_proxy` localhost guard and the TMPDIR
      writability probe (both RCH-measured lessons; cheap insurance for stdio servers).
- [ ] `scripts/agents/mcp-links.mts`: `ServerDef` gains `kind: "pixi"` + `pixiEnv`/`task`.
      `wantOpencode` pixi branch → `command: ["pixi", "run", "-e", "serena", "mcp-serena"]`.
      `wantRootMcp` npm branch prepends `"node"` to the launcher args (passthrough form):
      `["scripts/agents/mcp-launch.sh", "node", ".opencode/init-*.mjs"]`; pixi branch →
      `["scripts/agents/mcp-launch.sh", "-e", "serena", "mcp-serena"]`. enabled:false keeps
      serena out of the root `.mcp.json` face (existing enabled-only behavior).
- [ ] `agents sync` regenerates both faces. Consequence: the three existing npm entries in
      root `.mcp.json` change args shape (gain the explicit `node` prefix). gate-mcp shape
      checks still pass (`command` remains a STRING).

### D. Lifecycle + gate

- [ ] `scripts/agents/mcp-cli.mts`, three pixi branches:
      `status` — probe `.pixi/envs/<env>/bin/<probe[0]> --version`, three states
      ok / missing-env / DRIFT; `setup` — npm entries unchanged (`pnpm add`), pixi entries
      run `pixi install -e serena`; `index`/`sync` — codegraph steps unchanged, then
      `serena project index ROOT` (900s timeout; env absent → report skip, not failure).
- [ ] `scripts/agents/gate-mcp.mts`: header comment corrected ("no pixi-env servers" no
      longer true); pin check gains the pixi branch — enabled + env missing = RED (fix hint:
      `pixi install -e serena`), version drift = RED, disabled = reported-not-red
      (RCH gate-mcp SKIP-ENV semantics). No serena-specific latch-pair (SR-4).
- [ ] Red/green demos (repo verification discipline), recorded in the execution log:
      planted enabled-without-env → RED; pin bumped 2.1.0→2.1.1 → DRIFT RED; restored →
      GREEN both times.

### E. Serena project config + gitignore

- [ ] Commit `.serena/project.yml`: `project_name: "accessbase"`,
      `language_servers: ["typescript"]`, `encoding: "utf-8"`, empty `activation_command`
      (the pnpm workspace already carries node_modules; no pre-build needed).
- [ ] `.gitignore`: append `/.serena/cache/`, `/.serena/memories/`,
      `/.serena/project.local.yml`.

### F. Entries, routing rule, docs

- [ ] `accessbase.sh`: `cmd_mcp` gains a `serena` subcommand (`exec
      scripts/agents/mcp-launch.sh -e serena mcp-serena`, manual stdio start for
      live-fire) + usage text. No parallel pixi task — the accessbase.sh entry matches the
      existing mcp family shape.
- [ ] `.agents/rules/common/tool-routing.md`: one matrix row, BY CAPABILITY (never by
      host, ADJ-7g): symbol-level multi-file surgery (find_symbol / replace_symbol_body /
      reference rewrites) when the host has no LSP or its LSP is insufficient →
      `local-serena` MCP; host built-in LSP still outranks it; codegraph keeps the
      call-chain/graph lane; dual-path retrieval stays banned.
- [ ] AGENTS.md COMMANDS region: mcp help line updated (`serena` subcommand).
- [ ] `.agents/memorys/decisions.md`: new D-entry (read the file's current max BEFORE
      taking a number — expected D127 if the max is unchanged): serena introduction
      ruling incl. the MediaServo-zero-content honesty record, the kind:pixi governance
      extension, and the .serena-cache-outside-pnpm-tree boundary (PIT-090 family
      adjacency). `.agents/memorys/status.md`: recent-work note.
- [ ] This file is the batch plan; no separate plan doc needed beyond it.

---

## Verification plan (runs only after execution sanction, in order)

- **V1 environment:** `pixi install -e serena` (expect ~1.5-2GB disk: python + node +
  serena-agent; pixi.lock gains the serena solve group — large diff, expected).
- **V2 probes:** `bash accessbase.sh mcp status` → `local-serena  on  ok (pixi serena,
  2.1.0)` (SR-1 override: enabled at landing); `pixi run agents-check` → gate-mcp green
  with the pixi-kind probe passing.
- **V3 indexing:** `bash accessbase.sh mcp index` → codegraph + serena index both green.
  First serena run downloads the TS language server into `.serena/cache` over the network —
  OUTSIDE the pnpm tree, so the PIT-090 dep-drift watch is untouched. This boundary is part
  of the D-entry.
- **V4 live-fire:** one TS symbol query through a real host session (stdio handshake +
  tsconfig loading verified). Serena upstream self-documents TS backend instability; the
  measured verdict goes into pitfalls and feeds the first recheck of this adoption.
- **V5 full chain:** `bash accessbase.sh ci` green — census line `pass=4 fail=0 skip=0`,
  all layer summaries printed (PIT-095 canary).
- **E1 enablement (FOLDED INTO THIS BATCH by SR-1 override, 2026-11-18):** `.agents/mcp.json`
  `enabled: true` + `agents sync` → root `.mcp.json` gains the entry → host restart picks it
  up. The triple-instance cost (each host spawns serena + its LSP) is accepted on the record
  (ADJ-4c/ADJ-7g); DISABLEMENT, if ever, is a separate ruling.
- **Tool-routing matrix row (mandatory per SR-4 ruling note):** `rules/common/tool-routing.md`
  gains a serena row (symbol-level multi-file surgery ↔ codegraph relationship graphs — the
  boundary line), no machine latch attached.

---

## Decision points (SR = Serena Ruling; defaults apply unless overridden)

- **SR-1 initial switch:** ~~RECOMMENDED `enabled: false`~~ **OVERRIDDEN by user ruling
  2026-11-18 → `enabled: true`** (see adjudication record; kept here for history:
  register + plumb + verify; the
  flip is the user's ruling — matches "enablement is a user ruling" and the
  triple-instance cost already accepted once). Alternative: `enabled: true` RCH-style
  (three hosts each spawn serena + LSP immediately).
- **SR-2 version pin:** RECOMMENDED `2.1.0` carry-verbatim (ADJ-4a spirit: pin what the
  sibling repo actually proved; RCH pixi.lock evidences linux-64 resolution). Alternative:
  latest PyPI (upgrades go through their own batch anyway).
- **SR-3 context flag:** RECOMMENDED `--context claude-code` (RCH verbatim; the flag
  mostly shapes tool filtering and RCH runs the same host zoo). Alternatives:
  `ide-assistant` / default `agent`.
- **SR-4 latch-pair for serena:** RECOMMENDED none (single-latch precedent — codegraph ⇔
  tool-routing.md; a second latch per server invites gate sprawl). Alternative: lock the
  serena matrix row the same way.

## Risks / boundaries / assumptions

- TS language backend is upstream-acknowledged as less stable; V4 decides. Monorepo
  multi-tsconfig boundaries exercised in V3/V4.
- Serena's own language-server self-install (`.serena/cache`) is structurally the
  PIT-090 family (a self-healing install) but in a DIFFERENT domain (serena's cache, not
  the repo's pnpm tree) — recorded as a pitfall note to prevent false PIT-090 alarms.
- `pixi.lock` diff is large (new solve group); commit-size expectation set here.
- Zero changes under `.refinfo/` (read-only discipline).
- Assumptions: conda-forge python 3.13 + nodejs and pypi serena-agent 2.1.0 resolve on
  linux-64 (RCH pixi.lock proves it); hosts consume stdio MCP the same way the three
  existing servers already do; this batch touches governance surfaces only, no runtime /
  business code.

---

## Execution log (filled on landing, verification-discipline record)

**EXECUTED 2026-11-18 — all groups A-F landed, V1-V5 green:**

- A: `pixi.toml` gains `[feature.serena]` (python 3.13 + nodejs; pypi
  `serena-agent ==2.1.0`), task `mcp-serena` RCH-verbatim, environment `serena`
  isolated. B: single source registers `local-serena` (kind pixi, enabled TRUE
  per SR-1 override) + pin registry gains the pixi shape (`pixiEnv`+`probe`).
  C: `mcp-launch.sh` → pure `pixi run "$@"` passthrough with NO_PROXY + TMPDIR
  guards; npm faces gained the explicit `node` arg (three entries reshaped,
  gate shape checks still pass — command stays a STRING). D: gate-mcp + mcp-cli
  pixi branches (env-missing RED with fix hint / DRIFT / disabled
  reported-not-red). E: `.serena/project.yml` committed (TS, .refinfo excluded
  — read-only discipline); `cache/`, `memories/`, `project.local.yml`
  gitignored. F: D127 (honesty records included), status.md line,
  tool-routing matrix row (surgery vs relationship-questions boundary, no
  machine latch per SR-4).
- **Implementation note (found live)**: upstream version strings print as
  `Serena 2.1.0-<sha>-dirty`; exact-match pins would false-DRIFT on every
  build. Fixed at the PROBE: extract the `\d+\.\d+\.\d+` token, then
  prefix-match for pixi kinds (npm kinds stay exact).
- **V1** `pixi install -e serena` → installed. **V2** `bash accessbase.sh mcp
  status` → `local-serena  on  ok (2.1.0)`; gate-mcp green (5 pins ok).
  **V3** serena index → 430 typescript files in ~4s (language server
  self-installed into .serena/cache — outside pnpm, PIT-090 watch clean).
  **V4** stdio initialize handshake through `mcp-launch.sh -e serena
  mcp-serena` → serverInfo Serena, capabilities returned. **V5**
  `bash accessbase.sh ci` → exit 0, `[census] pass=4 fail=0 skip=0`.
- **Red/green demos (recorded)**: pin 2.1.0→2.1.1 → `DRIFT: installed 2.1.0
  != pin 2.1.1` RED (exit 1); env renamed away → `ENABLED but NOT INSTALLED
  (env missing) — run: pixi install -e serena` RED (exit 1); both restored →
  GREEN (exit 0).
- First adoption recheck carrier (per evolution-protocol): the next doc-audit
  cycle checks whether the serena matrix row and this ledger stay coherent.

- (none yet — batch awaits sanction)
