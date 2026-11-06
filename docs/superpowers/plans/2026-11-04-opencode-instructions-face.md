# OpenCode instructions face (Batch 8) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate the `instructions[]` key of `.opencode/opencode.json` from a new dispatcher layer (ADJ-OC-1), fed by the full rules layer + the two memory files + CONSTRAINTS.md first (ADJ-OC-2/4), with a warn-only budget line (ADJ-OC-3).

**Architecture:** New per-layer generator `scripts/agents/instructions-links.mts` (VE 2-B small-layer discipline) joins the dispatcher as the 5th generator. Citation-fidelity note: the ADJ-OC-1 ruling note sketched "rules-links gains an opencode face"; Batch 8 implements it as its own layer per VE 2-B — the ruling's outcome (generated face + drift-check + zero new wiring via `generated_tracked`) is identical. Shared helpers (`collectRules`, `deepEqual`) move to `agent-common.mts`. The face is a FULL REWRITE (RCH D20, same philosophy as the `mcp{}` region): hand edits are erased by sync — sources are registered in `.agents/`, not in the config. Budget is warn-only: the size line prints on every check/sync (via the summary line; on drift the layer returns before it), WARN past the threshold, never touches the exit code.

**Tech Stack:** TypeScript `.mts` run by node ≥22.6 native type-stripping (same as the existing 8 layers; no new deps, no build step).

**Spec:** `docs/superpowers/plans/2026-11-04-agent-governance-port.md` — "OpenCode-adaptation adjudications" section (ADJ-OC-1..4, user-adjudicated one by one 2026-11-04). This plan argues from that section; executors read both.

## Measured baselines (2026-11-04, repo root — recount before trusting)

| Fact                                                   | Value                                                                                                                                                                                                                                                                       | How measured                                                                                                                                                                                       |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| rules-layer census (collectRules sense)                | **79** files                                                                                                                                                                                                                                                                | `node scripts/agents/agent-links.mts check` → `rules-links: clean (79 rules)`                                                                                                                      |
| find census (adds top-level `.agents/rules/README.md`) | 80                                                                                                                                                                                                                                                                          | `find .agents/rules -name '*.md' -not -path '*/zh/*' \| wc -l`                                                                                                                                     |
| language-dir READMEs                                   | **0**                                                                                                                                                                                                                                                                       | `find .agents/rules -mindepth 2 -name 'README.md' -not -path '*/zh/*'` → empty; the top-level README is the only one and is already excluded by `collectRules` (it only descends into directories) |
| current handwritten face                               | 19 entries / **171,946 bytes**                                                                                                                                                                                                                                              | `python3 -c` over `opencode.json` (status.md 76,830 + conventions.md 47,163 dominate)                                                                                                              |
| projected generated face                               | **291,106 bytes** (79 rules + 2 memory files + CONSTRAINTS.md 2,490; re-verified at review close-out — a panel claim of "drifted to 288,616 / −0.9%" was a measurement-scope artifact: the panel's re-run omitted CONSTRAINTS.md from its glob, difference = exactly 2,490) | `glob + os.path.getsize`                                                                                                                                                                           |
| `budget_warn_bytes` initial                            | **350,000** (~20% headroom over the projection; recalibrate in Task 2 Step 7 against the real sync output: measured × 1.2, rounded to 10K)                                                                                                                                  | this plan                                                                                                                                                                                          |
| `opencode.json` serialization                          | 2-space JSON, trailing `\n`; last bytes are `}\n` (od-verified)                                                                                                                                                                                                             | `tail -c 4 .opencode/opencode.json`                                                                                                                                                                |

## Global Constraints

- D121 language policy: plan, comments, and commit messages are English; no CJK in persisted files. This applies to NEW content in legacy memory files too (the policy governs new writes regardless of the file's legacy language). Legacy heading names referenced from English prose are written as literal quoted pointers ("the 近期工作 list") and are exempt as citations; the plan body itself stays CJK-free.
- No new dependencies; **no vitest for this layer** — the existing 8 governance layers have none; the accepted test form is red/green demonstration (RCH CONSTRAINTS verification discipline, Batch 1-5 precedent).
- `.mts` scripts are outside every tsconfig (Batch 7 execution log, fact 1) — `tsc --noEmit` does NOT check them; ESLint DOES lint `scripts/`. Verification = ESLint + live command demos.
- `opencode.json` will carry TWO generated keys (`instructions`, `mcp`) and stays in `generated_tracked` — the pre-commit hook syncs + stages it automatically; no new wiring.
- Exit-code convention unchanged (0 clean / 1 findings / 2 guard). The new layer never exits 2 (no marker regions involved) and its budget WARN never affects the exit code (ADJ-OC-3).
- Deterministic ordering without locale dependence: plain `Array.prototype.sort()` (UTF-16 code-unit order); never `localeCompare` in serialized orderings (ICU drift = fingerprint churn). `deepEqual`'s internal key canonicalization is comparison-only and never persisted — exempt. `deepEqual` is key-order-insensitive for objects but ARRAY-ORDER-SENSITIVE — correct, because instruction load order is semantics.
- Key ownership: `mcp` stays owned by `mcp-links`; `instructions` becomes owned by `instructions-links`. Both read-modify-write the same file via `writeIfChanged` with identical serialization (`JSON.stringify(doc, null, 2) + "\n"`). Dispatcher order is functionally irrelevant (each layer parses the on-disk state, writes only its own key) but is fixed at `memory-aggregate → instructions-links → mcp-links` for reviewability.
- Reload timing: `opencode.json` changes take effect on the NEXT OpenCode session; the running session is unaffected. Note this in the Task 3 write-back.
- Do NOT touch `rules-links`' mdc projection behavior (README/other) — ADJ-OC-2 rules the opencode face only; CodeBuddy's 79-file mdc layer is out of scope.
- Pre-execution: node ≥22.6 probe (same as `.githooks/pre-commit`); all commands run from repo root.

---

### Task 1: Shared base extraction + registry extension

**Files:**

- Modify: `scripts/agents/agent-common.mts` (fs imports; `Targets.instructions_face`; move in `deepEqual` + `collectRules`/`RuleFile`)
- Modify: `scripts/agents/mcp-links.mts:42-53` (delete local `deepEqual`, import from agent-common)
- Modify: `scripts/agents/rules-links.mts:17-30` (delete local `RuleFile`/`collectRules`, import from agent-common)
- Modify: `scripts/agents/agent-targets.json` (opencode target gains `instructions_face`; note rewritten)

**Interfaces:**

- Consumes: nothing new (pure refactor + config).
- Produces (Task 2 relies on these exact names):
  - `agent-common.mts`: `export interface RuleFile { lang: string; topic: string; src: string; }`
  - `agent-common.mts`: `export function collectRules(rulesRoot: string, exclude: string[]): RuleFile[]`
  - `agent-common.mts`: `export function deepEqual(a: unknown, b: unknown): boolean`
  - `Targets.targets[]` element gains optional `instructions_face?: { memory_files: string[]; budget_warn_bytes: number }`
  - `agent-targets.json`: opencode target carries `instructions_face.memory_files = [".agents/memorys/status.md", ".agents/memorys/conventions.md"]` and `instructions_face.budget_warn_bytes = 350000`.

- [ ] **Step 1: Extend `agent-common.mts` — imports and `Targets` interface**

Line 18 import becomes:

```ts
import {
  readFileSync,
  existsSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
  lstatSync,
} from 'node:fs';
```

In the `Targets` interface, the `targets` array element type gains one optional field (append after `note?: string;`):

```ts
    instructions_face?: {
      memory_files: string[];
      budget_warn_bytes: number;
    };
```

- [ ] **Step 2: Move `deepEqual` into `agent-common.mts`**

Append to the `// --- misc ---` section (after `relRoot`), verbatim from `mcp-links.mts:42-53` — no logic change:

```ts
/** Structural deep-equality: key-order-insensitive for objects; array order IS significant. */
export function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));
  function sortKeys(x: unknown): unknown {
    if (Array.isArray(x)) return x.map(sortKeys);
    if (x && typeof x === 'object') {
      return Object.fromEntries(
        Object.entries(x as Record<string, unknown>)
          .sort(([k1], [k2]) => k1.localeCompare(k2))
          .map(([k, v]) => [k, sortKeys(v)]),
      );
    }
    return x;
  }
}
```

- [ ] **Step 3: Move `RuleFile` + `collectRules` into `agent-common.mts`**

Append after `deepEqual` (verbatim from `rules-links.mts:17-30` — no logic change):

```ts
// --- rules collection (rules-links + instructions-links) --------------------

export interface RuleFile {
  lang: string;
  topic: string;
  src: string;
}

export function collectRules(rulesRoot: string, exclude: string[]): RuleFile[] {
  const out: RuleFile[] = [];
  for (const lang of readdirSync(rulesRoot)) {
    if (exclude.includes(lang)) continue;
    const langDir = path.join(rulesRoot, lang);
    if (!lstatSync(langDir).isDirectory()) continue;
    for (const f of readdirSync(langDir)) {
      if (f.endsWith('.md'))
        out.push({ lang, topic: f.replace(/\.md$/, ''), src: path.join(langDir, f) });
    }
  }
  return out;
}
```

- [ ] **Step 4: Retarget the two consumers to the shared helpers**

`mcp-links.mts`: delete lines 42-53 (the local `deepEqual`) and add `deepEqual` to the existing agent-common import (line 26):

```ts
import {
  ROOT,
  EXIT_CLEAN,
  EXIT_FINDINGS,
  writeIfChanged,
  relRoot,
  deepEqual,
} from './agent-common.mts';
```

`rules-links.mts`: delete lines 17-30 (local `RuleFile` interface + `collectRules`) and add both to the existing agent-common import (lines 12-15):

```ts
import {
  ROOT,
  loadTargets,
  guard,
  sha256Short,
  writeIfChanged,
  relRoot,
  EXIT_CLEAN,
  EXIT_FINDINGS,
  collectRules,
  type RuleFile,
} from './agent-common.mts';
```

(The `RuleFile` type is still used by `renderMdc`/`run` locals in rules-links — keep those references, they now resolve to the shared interface.)

**Same commit, staleness touch:** fix the now-stale header comment in `mcp-links.mts:10-11` — "All other keys (instructions, model, plugins) stay handwritten — only `mcp` is generated" becomes "All other keys stay handwritten EXCEPT `instructions`, generated by instructions-links (Batch 8); `mcp` is generated here." Also refresh the Batch-3-era layer list in `agent-links.mts:7-10` (currently missing mcp-links/gate-mcp) to the nine-layer truth this batch lands.

- [ ] **Step 5: Extend the registry — `agent-targets.json`**

Replace the opencode target entry (currently lines 29-33) with:

```json
{
  "label": "opencode",
  "enabled": true,
  "instructions_face": {
    "memory_files": [".agents/memorys/status.md", ".agents/memorys/conventions.md"],
    "budget_warn_bytes": 350000
  },
  "note": "reads .agents/ directly; instructions[] GENERATED by instructions-links (Batch 8, ADJ-OC-1..4: full rules layer excl. zh/ + the two memory files + CONSTRAINTS.md first; warn-only budget ADJ-OC-3) — hand edits to the instructions key are erased by sync (RCH D20); mcp{} region generated by mcp-links (Batch 4)"
}
```

Also append to the `$comment` head: `Batch 8 adds the opencode instructions face (instructions-links layer).`

- [ ] **Step 6: Verify the refactor is behavior-neutral**

Run: `node scripts/agents/agent-links.mts check && node scripts/agents/agent-links.mts status`
Expected: exit 0, `rules-links: clean (79 rules)`, `mcp-links: clean (2 faces)`, all 8 layers unchanged. Verify the registry fields directly (`status` does NOT render `instructions_face` — its printer covers label/enabled/rules_dir/skills_dir only): `node -e 'console.log(require("./scripts/agents/agent-targets.json").targets.find(t=>t.label==="opencode"))'`.

Run: `pixi run npx eslint scripts/agents/*.mts`
Expected: 0 errors (warnings = pre-existing baseline).

- [ ] **Step 7: Commit**

```bash
git add scripts/agents/agent-common.mts scripts/agents/mcp-links.mts scripts/agents/rules-links.mts scripts/agents/agent-targets.json
git commit -m "refactor(governance): extract collectRules/deepEqual to agent-common; declare opencode instructions_face (Batch 8 prep)"
```

(The pre-commit hook re-syncs generated layers — expect it green.)

---

### Task 2: instructions-links layer + dispatcher wiring + red/green demos

**Files:**

- Create: `scripts/agents/instructions-links.mts`
- Modify: `scripts/agents/agent-links.mts:30-41,69-81` (import + GENERATORS + runLayers)

**Interfaces:**

- Consumes (from Task 1): `collectRules`, `deepEqual`, `RuleFile`, `Targets.instructions_face`, `writeIfChanged`, `EXIT_*`, `loadTargets`, `ROOT`.
- Produces: `export function run(mode: "check" | "sync"): { code: number; summary: string }` — dispatcher contract identical to the other four generators. Owns the `instructions` key of `opencode.json`.

- [ ] **Step 1: Record the pre-batch baseline**

Run: `node scripts/agents/agent-links.mts check; echo "exit=$?"`
Expected: exit 0 — the pre-batch baseline with 8 layers, all green (rules census 79, mcp 2 faces, hub under caps). This is a RECORDING step, not a red proof: the new layer does not exist yet. The REAL red comes in Step 4 after wiring.

- [ ] **Step 2: Create `scripts/agents/instructions-links.mts`**

```ts
/**
 * instructions-links — .agents/rules/** (excl. zh/, excl. README) + memory
 * files + CONSTRAINTS.md → .opencode/opencode.json `instructions[]`
 * (plan Batch 8; ADJ-OC-1/2/3/4).
 *
 * ADJ-OC-1: the handwritten 19-entry list sat outside every generator and
 * check — Batch 4's tool-routing.md silently never reached OpenCode. The face
 * is a FULL REWRITE (RCH D20: additive merge cannot reclaim removed entries).
 * Register rule sources in .agents/, never hand-edit this key.
 * ADJ-OC-2: full rules layer (79, excl. zh/; collectRules already excludes the
 * top-level README) + the two registry-declared memory files + CONSTRAINTS.md
 * FIRST (ADJ-OC-4). Per-turn cost (~291KB measured 2026-11-04) is knowingly
 * bought — OpenCode instructions are always-on full-text injection.
 * ADJ-OC-3: budget is warn-only — the size line prints on every run; WARN past
 * budget_warn_bytes; NEVER affects the exit code.
 * ADJ-OC-4: CONSTRAINTS.md is a fixed first entry, path from the registry
 * `constraints_hub` field.
 *
 * Ordering: deterministic plain sort() (UTF-16 code units) on the rule paths;
 * fixed prefix [CONSTRAINTS.md, ...memory_files] in registry order. Never
 * localeCompare (ICU drift = churn).
 */

import { readFileSync, existsSync } from 'node:fs';
import * as path from 'node:path';
import {
  ROOT,
  loadTargets,
  EXIT_CLEAN,
  EXIT_FINDINGS,
  writeIfChanged,
  collectRules,
  deepEqual,
  type Targets,
} from './agent-common.mts';

const OPENCODE = path.join(ROOT, '.opencode', 'opencode.json');

function wantInstructions(cfg: Targets): string[] {
  const face = cfg.targets.find((t) => t.label === 'opencode' && t.enabled)?.instructions_face;
  if (!face) return [];
  const rulesRoot = path.join(ROOT, cfg.rules_root);
  const rules = collectRules(rulesRoot, cfg.rules_exclude_dirs)
    .map((r) => path.relative(ROOT, r.src).split(path.sep).join('/'))
    .filter((p) => path.posix.basename(p) !== 'README.md')
    .sort();
  return [cfg.constraints_hub, ...face.memory_files, ...rules];
}

export function run(mode: 'check' | 'sync'): { code: number; summary: string } {
  const cfg = loadTargets();
  const target = cfg.targets.find((t) => t.label === 'opencode' && t.enabled);
  const face = target?.instructions_face;
  if (!target || !face)
    return {
      code: EXIT_CLEAN,
      summary: 'instructions-links: no enabled opencode instructions_face, skip',
    };

  const want = wantInstructions(cfg);

  // Missing source = finding on BOTH modes (a sync over missing files would
  // either crash mid-read or write a face pointing at absent files).
  const missing = want.filter((p) => !existsSync(path.join(ROOT, p)));
  if (missing.length > 0) {
    console.error('instructions-links: source files missing — restore them or fix the registry:');
    for (const m of missing) console.error(`  ${m}`);
    return {
      code: EXIT_FINDINGS,
      summary: `instructions-links: ${missing.length} source file(s) missing`,
    };
  }

  const doc = JSON.parse(readFileSync(OPENCODE, 'utf8')) as Record<string, unknown>;
  if (mode === 'sync') {
    doc.instructions = want;
    writeIfChanged(OPENCODE, JSON.stringify(doc, null, 2) + '\n');
  } else if (!deepEqual(doc.instructions, want)) {
    console.log(
      'instructions-links: instructions[] drifted (hand-written entries, or sources changed without sync — RCH D20: this key is generated; register sources in .agents/)',
    );
    const prevArr = Array.isArray(doc.instructions) ? doc.instructions : [];
    const wantSet = new Set(want);
    for (const e of prevArr)
      if (typeof e === 'string' && !wantSet.has(e)) console.log(`  orphan entry: ${e}`);
    for (const e of want)
      if (!(prevArr as string[]).includes(e)) console.log(`  missing entry: ${e}`);
    return { code: EXIT_FINDINGS, summary: 'instructions-links: drift' };
  }

  // ADJ-OC-3: warn-only budget line — prints on both modes, never touches code.
  const contents = want.map((p) => readFileSync(path.join(ROOT, p), 'utf8'));
  const chars = contents.reduce((n, c) => n + [...c].length, 0);
  const bytes = contents.reduce((n, c) => n + Buffer.byteLength(c, 'utf8'), 0);
  const loc = `(${want.length} entries / ${chars} chars / ${bytes} bytes; warn ${face.budget_warn_bytes})`;
  if (bytes > face.budget_warn_bytes) {
    console.log(
      `  instructions budget WARNING ${loc} — load cost is knowingly bought (ADJ-OC-2); act only if it keeps growing`,
    );
  }
  return mode === 'sync'
    ? { code: EXIT_CLEAN, summary: `instructions-links: face written ${loc}` }
    : { code: EXIT_CLEAN, summary: `instructions-links: clean ${loc}` };
}
```

- [ ] **Step 3: Wire the dispatcher — `agent-links.mts`**

Three edits:

Import block (after line 33, alphabetical among the generator imports):

```ts
import * as instructionsLinks from './instructions-links.mts';
```

`GENERATORS` constant (line 40) becomes:

```ts
const GENERATORS = [
  'rules-links',
  'skills-index',
  'memory-aggregate',
  'instructions-links',
  'mcp-links',
] as const;
```

`runLayers` (lines 69-81) — insert the call BETWEEN `memoryAggregate.run(mode)` and `mcpLinks.run(mode)` (fixed order per Global Constraints):

```ts
    memoryAggregate.run(mode),
    instructionsLinks.run(mode),
    mcpLinks.run(mode),
```

- [ ] **Step 4: RED proof — the gate has teeth**

Run: `node scripts/agents/agent-links.mts check; echo "exit=$?"`
Expected: exit 1 with `instructions-links: drift` — the handwritten 19-entry list vs the generated 82-entry shape (1 CONSTRAINTS + 2 memory + 79 rules). The orphan/missing entry dump names `tool-routing.md` among the missing — the exact silent gap ADJ-OC-1 was adjudicated for. RECORD THE OUTPUT in the execution log.

- [ ] **Step 5: GREEN — sync repairs**

Run: `node scripts/agents/agent-links.mts sync; echo "exit=$?"`
Expected: exit 0, `instructions-links: face written (82 entries / ... chars / ... bytes; warn 350000)`. The `instructions` key of `opencode.json` now carries `[CONSTRAINTS.md, status.md, conventions.md, ...79 sorted rule paths]`; the `tool-routing.md` entry appears. `mcp` key untouched.

Run: `node scripts/agents/agent-links.mts check; echo "exit=$?"`
Expected: exit 0, all 9 layers green.

- [ ] **Step 6: Idempotency + RCH-D20 erasure demos**

Run: `node scripts/agents/agent-links.mts sync` again.
Expected: exit 0, same summary; the file is byte-identical to the Step 5 sync output (writeIfChanged no-op — compare with `git diff --stat` which, at this pre-commit point, shows the whole Step 5 face rewrite against HEAD, NOT zero; the idempotency assertion is "identical to Step 5 output", not "diff-empty").

Hand-plant a ghost entry:

```bash
python3 - <<'EOF'
import json
p='.opencode/opencode.json'
d=json.load(open(p))
d['instructions'].append('.agents/rules/common/ghost-rule.md')
json.dump(d,open(p,'w'),indent=2,ensure_ascii=False)
open(p,'a').write('\n')
EOF
node scripts/agents/agent-links.mts check; echo "exit=$?"
```

Expected: exit 1, `orphan entry: .agents/rules/common/ghost-rule.md` named.

Run: `node scripts/agents/agent-links.mts sync && node scripts/agents/agent-links.mts check`
Expected: ghost erased, exit 0; the file is byte-identical to the Step 5 sync output again (assert with `cmp` against a saved copy, or eyeball the ghost gone in `git diff`).

- [ ] **Step 7: Missing-source guard demo + budget recalibration**

```bash
cp .agents/memorys/conventions.md /tmp/opencode/conventions.md.bak
mv .agents/memorys/conventions.md /tmp/opencode/conventions.md.moved
node scripts/agents/agent-links.mts check; echo "exit=$?"
mv /tmp/opencode/conventions.md.moved .agents/memorys/conventions.md
cmp /tmp/opencode/conventions.md.bak .agents/memorys/conventions.md && node scripts/agents/agent-links.mts check; echo "exit=$?"
```

Expected: first check exit 1 with `instructions-links: source files missing` naming `.agents/memorys/conventions.md`. WHY conventions.md and NOT status.md: memory-aggregate (dispatcher position 3, BEFORE instructions-links) does an unguarded `readFileSync` of status.md — moving status.md crashes the dispatcher with an ENOENT traceback before the guard prints (exit code coincidentally 1, message wrong). conventions.md is read by NO earlier layer (memory-aggregate reads decisions/pitfalls/status only), so the guard message prints as designed. Restore + `cmp` → exit 0.

RECALIBRATE the budget: read the real byte figure from the Step 5 output. If the projected 291,106 drifted by more than 5%, update `budget_warn_bytes` in `agent-targets.json` (target ≈ measured × 1.2, rounded to 10K) and re-run sync (the registry is the single source; the change rides the same commit).

- [ ] **Step 8: ESLint + commit**

Run: `pixi run npx eslint scripts/agents/instructions-links.mts scripts/agents/agent-links.mts`
Expected: 0 errors.

```bash
git add scripts/agents/instructions-links.mts scripts/agents/agent-links.mts scripts/agents/agent-targets.json .opencode/opencode.json
git commit -m "feat(governance): generate the opencode instructions face (Batch 8, ADJ-OC-1..4)"
```

(The hook re-syncs + stages generated_tracked — expect green. Face takes effect on the NEXT OpenCode session.)

---

### Task 3: Docs write-back

**Files:**

- Modify: `docs/superpowers/plans/2026-11-04-agent-governance-port.md` (append "Batch 8 execution log" after the existing Batch 7 log)
- Modify: `.agents/memorys/status.md` (one line appended to the "recent work" list — the literal heading is 近期工作)
- Modify: `.agents/memorys/conventions.md` (one governance constraints entry, ENGLISH — see the D121 note at Step 3)

**Interfaces:**

- Consumes: Task 2's real measured numbers (entries/bytes from the sync output).
- Produces: the paper trail — findings referenced by future audits live here.

- [ ] **Step 1: Write the Batch 8 execution log into the governance port plan**

Append at the end of `docs/superpowers/plans/2026-11-04-agent-governance-port.md`:

```markdown
---

## Batch 8 execution log (OpenCode instructions face — ADJ-OC-1..4, LANDED 2026-11-04)

- Task 1 shared-base extraction + registry extension: <commit>. Behavior-neutral proven
  (8-layer check green pre-wiring; eslint clean).
- Task 2 instructions-links layer: <commit>. RED proof recorded (handwritten 19-entry face
  vs generated shape; orphan/missing dump named tool-routing.md — the adjudicated gap).
  Sync → 82 entries / <measured bytes> (warn 350000). Idempotent; ghost-entry RCH-D20 erasure
  demo green; missing-source guard demo green (conventions.md variant — see the plan's Step 7 note on why status.md would crash memory-aggregate first).
- Task 3 this log + status/conventions entries: <commit>.
- Constraint surfaced for operators: `opencode.json` `instructions` key is GENERATED — hand
  edits are erased by sync (RCH D20). Register new rule files under `.agents/rules/` (they
  join the face automatically) or edit `instructions_face.memory_files` in the registry.
  Face reload = next OpenCode session.
```

(Fill `<commit>` hashes and `<measured bytes>` from the actual run.)

- [ ] **Step 2: Add the status.md recent-work line**

Append one line to the "近期工作" (recent work) list, matching the file's established format — the line itself is ENGLISH per D121 (new memory entries are English regardless of the file's legacy language):

```markdown
- 2026-11-04: Governance Batch 8 (OpenCode instructions face) LANDED — ADJ-OC-1..4; instructions-links layer generates opencode.json instructions[] (CONSTRAINTS.md + 2 memory files + 79 rules, full-rewrite RCH D20, warn-only budget); handwritten 19-entry list retired; tool-routing.md now reaches OpenCode. Gates: 9-layer agents check green, eslint clean, red/green demos recorded in the plan's Batch 8 log.
```

- [ ] **Step 3: Add the conventions.md constraints entry**

Append a short section following the file's constraints-plus-check-command pattern (shape), WRITTEN IN ENGLISH. D121 mandates English for all NEW memory entries — the file's post-2026-09 governance sections are already English-bodied (multi-node, logout-coherence, data-scope, Q3D), so this entry follows the live precedent, not the legacy Chinese sections:

```markdown
## Governance Batch 8 constraints (2026-11-04)

- **The opencode.json `instructions` key is GENERATED** (instructions-links layer, ADJ-OC-1): a new rule file dropped under `.agents/rules/` joins the OpenCode load face automatically; NEVER hand-edit that key — the pre-commit sync erases hand edits (RCH D20). The memory-file list and the warn threshold are adjusted in the opencode `instructions_face` field of `scripts/agents/agent-targets.json`.
- Check: `node scripts/agents/agent-links.mts check` — instructions-links red = hand-edit drift or missing source file; green = consistent.
```

(The literal Chinese heading name "近期工作" above is a quoted pointer to existing file structure, not new CJK prose.)

- [ ] **Step 4: Final verification + commit**

Run: `node scripts/agents/agent-links.mts check`
Expected: exit 0 — 9 layers green. NOTE on the hub: the memory-aggregate digest is heading-scoped (status = section headings only; conventions is NOT read by memory-aggregate at all), so these edits do NOT alter AGENTS.md — hub budget unaffected (the safe conclusion the earlier draft reached by wrong reasoning).

Run: `pixi run npx eslint scripts/agents/*.mts && bash accessbase.sh typecheck`
Expected: 0 errors / double-green (repo-wide gates untouched).

```bash
git add docs/superpowers/plans/2026-11-04-agent-governance-port.md .agents/memorys/status.md .agents/memorys/conventions.md
git commit -m "docs(governance): Batch 8 write-back (execution log, status, conventions)"
```

---

## Self-review notes (post-write, pre-review)

- Spec coverage: ADJ-OC-1 → Task 2 Step 2-3 (generation); ADJ-OC-2 → Task 1 Step 5 + Task 2 Step 2 (full layer + memory files, measured baselines table); ADJ-OC-3 → Task 2 Step 2 budget block + Step 7 recalibration; ADJ-OC-4 → Task 2 Step 2 fixed first entry from `constraints_hub`. All four carry demos or measured proof.
- Placeholder scan: `<commit>`/`<measured bytes>` in Task 3 are fill-at-execution fields with explicit instructions, not design gaps; every code block is complete.
- Type consistency: `run()` contract, `RuleFile`, `collectRules`, `deepEqual`, `instructions_face` names are identical across Tasks 1-2.
