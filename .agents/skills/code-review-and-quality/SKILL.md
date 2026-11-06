---
name: code-review-and-quality
description: 'Structured code review for this repo: deterministic checks first (machines are the authority), then a six-domain deep pass with a confidence gate. Use when reviewing any code change before delivery — own edits, batch outputs, or ported code — or when the user says 审查/复审这份代码/review this change.'
---

# code-review-and-quality — structured review, deterministic checks first

> Ported from VE `code-review-and-quality` / RCH `qt-*-review` shapes and
> rewritten for this repo (Fastify + React + Drizzle). The two-phase structure
> is the invariant: machines rule Phase 1, judgment only spends effort where
> machines cannot look.

## Phase 1 — deterministic checks (machines are the authority)

Run these first; a red here ends the review — fix, then come back. A tool
missing from the machine = SKIP with a note (never a blocker, never silent):

| #   | Check                             | Command                                                                                         | Red when                                                                              |
| --- | --------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| 1   | Type double-green                 | `bash accessbase.sh typecheck`                                                                  | any error                                                                             |
| 2   | Lint                              | `bash accessbase.sh lint`                                                                       | any error                                                                             |
| 3   | Banned syntax, zero NEW instances | `git diff -U0 \| grep -E "as any\\                                                              | @ts-ignore\\                                                                          | @ts-expect-error"` | any hit in added lines  |
| 4   | Tests did not silently shrink     | `git diff -- '*test*' '*spec*'`                                                                 | deletions/skips/weakened assertions without a stated reason (CONSTRAINTS.md Never #3) |
| 5   | Frontend change → E2E duty        | touched `apps/admin-ui/**` → run the mock-first suites                                          | E2E skipped for a UI behavior change                                                  |
| 6   | Governance surfaces               | touched `.agents/**`, generated layers, or `CONSTRAINTS.md` → `bash accessbase.sh agents check` | any finding                                                                           |
| 7   | Plaintext secrets                 | `git diff \| grep -iE "password\\                                                               | secret\\                                                                              | token\\            | api_key"` (added lines) | any literal that is not `${VAR}` / env indirection |

## Phase 2 — six-domain deep pass (this repo's domains)

Only after Phase 1 is green. Each domain: read the diff in context, check the
domain invariants, record findings with evidence.

1. **API surface** — response envelope discipline (global `{success,data}` vs
   documented machine-route exceptions — IdP-facing routes stay spec-shaped);
   `requirePermission` guards present on new routes; tenant partition
   respected (no cross-tenant reachability introduced).
2. **Auth & security** — mount the `skill:security-hardening` lens for
   anything touching auth/session/keys: JWT lifetimes, session-family
   coherence, CIDR/MFA gates, key handling.
3. **DB & migrations** — Drizzle three-phase flow respected; migrations are
   reversible or explicitly one-way with a stated reason; schema shape matches
   the owning module doc's Implementation status.
4. **UI consistency** — mount the `skill:design-system` lens: AntD usage
   patterns, inline feedback (no static `message.*` — logged pitfall),
   i18n keys not hardcoded strings.
5. **Test coverage** — new behavior has a failing-first test story; the right
   layer (unit/integration/E2E per `rule:testing`); baseline health via
   `bash accessbase.sh test` (never quote counts from memory — run it).
6. **Governance coherence** — generated layers untouched by hand; marker
   regions intact; memory numbering taken after reading the current max
   (`rule:lesson-memory` discipline).

## Confidence gate (per finding)

| Confidence | Action                                              |
| ---------- | --------------------------------------------------- |
| > 80       | Report with severity + fix                          |
| 60–80      | Report, marked "needs human confirmation"           |
| < 60       | Suppress (a vague finding costs more than it saves) |

## Output format

One row per finding: `severity (CRITICAL/HIGH/MEDIUM/LOW) | domain | file:line |
issue | fix | evidence (command output or quoted diff)`.

Disposition follows the panel rule: CRITICAL must be fixed before delivery;
LOW may be recorded as debt with a one-line reason. Multi-domain or contested
findings escalate to `skill:expert-panel-review` instead of being argued in
place.

## Anti-excuse table

| Excuse                                       | Answer                                                                       |
| -------------------------------------------- | ---------------------------------------------------------------------------- |
| "Typecheck takes long, skip to judgment"     | Phase 1 is not optional; judgment on unverified code is theater              |
| "It's just a small change"                   | Small changes still run the Phase 1 table — it is minutes of machine time    |
| "The test will probably pass"                | Run it (`rule:testing`); "probably" is a Phase-2 confidence < 60 = suppress  |
| "The finding is obvious, no evidence needed" | Evidence column is mandatory; an unfounded finding is noise with authority   |
| "Baseline counts are X tests"                | Never quote counts from memory — the gate prints them (scale literals drift) |
