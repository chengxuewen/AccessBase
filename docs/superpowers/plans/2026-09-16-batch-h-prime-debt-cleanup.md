# Batch H′ — Debt Cleanup + Test Signal Hygiene Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Kill the 3 PG-down recurring vitest failures (conditional skip + timing fix), close the security-flavored backlog (Host poisoning / SMTP timing / login schema), and sweep the small hygiene batch.

**Architecture:** No new features. Test-signal fixes are probe-based conditional skips (health.spec precedent); security fixes are minimal route-level changes with TDD; hygiene is one-liners with prior rulings.

**Spec:** docs/superpowers/specs/2026-09-16-batch-h-prime-debt-cleanup-design.md

## Global Constraints

- Standing PITs: 048 (identity build), 051 (root tsc), 053 (branch check per commit), 054 (workers=1 e2e)
- H′5 touches production response schema → full e2e mandatory
- Each task commits independently; English comments; no as any
- Verify-before-skip: items marked "DONE in prior batch — verify" must be checked before skipping

---

## Task 1: PG-required test conditional skip + rate-limit timing fix (H′1+H′2)

**Files:**
- Modify: `apps/server/src/__tests__/mfa-integration.test.ts`, `oidc-flow.test.ts` (beforeAll PG probe → describe.skip)
- Modify: `apps/server/src/__tests__/security.test.ts` (rate-limit assertion fix)
- Modify: `.agents/memorys/conventions.md` (gate baseline line)

**Interfaces:**
- Consumes: health.spec.ts:15 skip precedent text
- Produces: `vitest apps/server` with PG down → 0 failed (PG files skip); PG up → tests run as before. Rate-limit case deterministic.

- [ ] **Step 1: RED** — run `pixi run npx vitest run apps/server` with PG down → confirm 3 failures (baseline reproduction, already known)
- [ ] **Step 2: Implement skips** — both PG files: beforeAll probe → `describe.skip` + reason string; rate-limit: implementer judges `retry-after`/status-set or fake-timers, documents choice
- [ ] **Step 3: GREEN + PG-up spot** — vitest apps/server → 0 failed with PG down; (PG up verification optional if native PG available — document NOT VERIFIED if not)
- [ ] **Step 4: conventions line + commit** — `test(server): PG-required vitest conditional skip + deterministic rate-limit assertion (H′)`

## Task 2: Magic-link Host mitigation + SMTP async (H′3+H′4)

**Files:**
- Modify: `apps/server/src/routes/auth.ts` (origin resolution :701 + send call)
- Modify: `apps/server/src/__tests__/magic-login.test.ts` (Host matrix tests)
- Modify: `.env.example` (SITE_URL production note)

**Interfaces:**
- Produces: origin = site.url → SITE_URL → (TRUST_PROXY=true ? x-forwarded-host : host) + one-time warn when falling to request Host; SMTP send fire-and-forget with catch-warn

- [ ] **Step 1: RED** — tests: poisoned Host + no config → link uses Host + warn logged (current behavior); TRUST_PROXY=true + x-forwarded-host attacker → link uses forwarded host ONLY when trusted; async send → request resolves without awaiting SMTP (mock mailer with a deferred promise, assert response arrives)
- [ ] **Step 2: Implement** — origin chain + async send (+ forgot-password same pattern if it awaits inline)
- [ ] **Step 3: GREEN + full vitest + commit** — `fix(server): magic-link Host trust gating + SMTP async send (H′)`

## Task 3: login schema user declaration (H′5)

**Files:**
- Modify: `apps/server/src/routes/auth.ts` (login 200 schema — add `user` object declaration mirroring saml/magic union shape)
- Test: extend auth login test — decode response JSON, assert `user` object present with id/email/name/roles

**Interfaces:**
- Produces: login wire response includes `user` (previously potentially stripped); frontend unaffected (already hydrates from /auth/me)

- [ ] **Step 1: RED** — test asserting response.user present → likely FAILS (stripped) — this CONFIRMS the stripping was real (record finding)
- [ ] **Step 2: Fix schema** → GREEN
- [ ] **Step 3: full gates + commit** — vitest + 双闸 tsc + FULL e2e (schema change → mandatory) — `fix(server): login 200 schema declares user object (H′)`

## Task 4: hygiene sweep (H′6)

**Files:** various one-liners per design §3 — verify-then-fix each; skip with note if already done.

- [ ] **Step 1: verify DONE-items** (oauth stub burn — batch F; TTL-300 assertion — batch G) — skip with note if present
- [ ] **Step 2: AUTH_SAML_003 comment** (fold ruling documented)
- [ ] **Step 3: R2 expect.poll** (single-flight e2e)
- [ ] **Step 4: setOauthBusy rename** (zero-impact check first)
- [ ] **Step 5: MagicLogin 403 distinct copy** (AUTH_004 → suspended i18n, zh/en)
- [ ] **Step 6: commit(s)** — `chore: hygiene sweep from E/F/G backlogs (H′)`

## 验收清单

- [ ] vitest apps/server: PG down → 0 failed（信号归零）; rate-limit deterministic
- [ ] Host matrix tested; SITE_URL production note in .env.example
- [ ] SMTP async both sites; login schema user declared + RED evidence recorded
- [ ] Hygiene items done-or-skipped-with-note
- [ ] vitest 全绿 / 双闸+根 tsc / e2e full 0 failed (workers=1)
