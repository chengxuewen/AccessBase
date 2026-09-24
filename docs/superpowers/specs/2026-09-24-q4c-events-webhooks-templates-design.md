# Q4c — Events Outbox + Webhooks + Email Templates

**Date:** 2026-09-24 · **Status:** rev.2 (dual-Momus absorbed: flows R1-R12 `bg_0268a203`, blockers B1-B9 `bg_4b49ab0a` — cross-hits B1×R2, B2×R6, B5×R5) · **Parent:** `2026-09-23-q4-productization-proposal.md` §3+§4 (approved sequence; SSRF ruling: allow internal, DENY loopback)

## 1. Scope

Two independent sub-batches, landable in parallel:

- **C-A Events outbox + webhooks (M):** `events` table written at the manager funnels; per-tenant `webhook_endpoints` (HMAC-signed dispatcher, retry/backoff, dead ledger); `webhook_deliveries`; admin UI + test-ping; codes `webhooks:read/write`.
- **C-B Email templates + localization (S-M):** options-backed bilingual templates (4 fixed ids) + `{{var}}` renderer + migration of the four mail lanes + Settings editor/preview. No new tables, no new permission codes (reuses `options:*`).

**Non-goal:** audit_logs HTTP-middleware behavior UNCHANGED; the proposal's "audit fold-in" discharges as the durable `events` trail for manager-level mutations (incl. non-HTTP callers). Wizard/init direct-SQL writes (verify in T1 whether any bypass funnels — R12) are a documented coverage edge, not a promised gap-closer. `GET /events` history UI deferred (deliveries ledger covers debugging).

## 2. Grounding facts

F1-F15 as in rev.1 (line numbers verified EXACT by both reviewers), corrections:

- F2-CORRECTION (R5): TenantManager has NO `db?: DbLike` on any method (create :61 / update :149 / delete :233); likewise UM.update :193 / UM.delete :219 / RM.delete :264 / RM.revokeFromUser :435 / ApiKeyManager.revoke :122 / GM.create/update/delete/addMember/removeMember. §4 widens ALL of them.
- F5-CORRECTION (R4): `decryptSecret` derives its key with synchronous `scryptSync(N=16384)` PER CALL (OidcClientManager.ts:19-24) — measured 36.6ms → dispatcher must never call it per-delivery (§5.4 per-tick cache).
- F16 (R11): repo has ZERO pg-23505 handling; every unique-conflict precedent is a pre-check SELECT (GroupManager dup-check).
- F17 (R12): `text[]` has zero precedent in `packages/identity/src/db/schema.ts` — verify `pnpm db:generate` emits it (fallback: explicit `.array()` + snapshot diff check); schema path is `src/db/schema.ts`.
- F18 (B7): `TenantManager.update:179-188` suspend already revokes sessions+keys (W3-3) — webhook fan-out must respect tenant status too.
- F19 (batch-B precedent): jsonb-object vs JSON.parse-string assumption is a recorded silent-failure trap — §7 pins the option value shape explicitly.

## 3. C-A tables (chain 0009, one `pnpm db:generate`, 3 tables)

```
events              id bigserial PK, tenant_id uuid NOT NULL, type text NOT NULL
                    (catalog: user.created|user.updated|user.deleted|user.suspended | role.changed |
                     tenant.created|tenant.updated|tenant.suspended|tenant.deleted | apikey.revoked |
                     group.changed | webhook.test — append-only strings),
                    payload jsonb NOT NULL (non-secret projections: id/email/name/slug/actor/op),
                    created_at timestamptz default now(),
                    fanout_complete_at timestamptz NULL   -- rev.2 rename+semantics: see terminality below
                    partial index (tenant_id) WHERE fanout_complete_at IS NULL
webhook_endpoints   id uuid PK default gen_random_uuid(), tenant_id uuid NOT NULL, url text NOT NULL,
                    description text, secret_encrypted text NOT NULL (AES-GCM v1 envelope, F5),
                    subscribed_events text[] NOT NULL DEFAULT '{*}',  -- rev.2 renamed off `events` (collision, R12)
                    active boolean NOT NULL DEFAULT true, created_at/updated_at,
                    UNIQUE (tenant_id, url)
webhook_deliveries  id bigserial PRIMARY KEY,             -- rev.2 R1: surrogate id — the claim needs one
                    event_id bigint NOT NULL REFERENCES events ON DELETE CASCADE,
                    endpoint_id uuid NOT NULL REFERENCES webhook_endpoints ON DELETE CASCADE,
                    status text NOT NULL DEFAULT 'pending' (pending|delivered|dead),
                    attempts int NOT NULL DEFAULT 0, next_attempt_at timestamptz NOT NULL DEFAULT now(),
                    last_error text, response_status int, delivered_at timestamptz, created_at,
                    UNIQUE (event_id, endpoint_id),       -- fan-out ON CONFLICT target
                    index (next_attempt_at) WHERE status = 'pending'
```

**Terminality (rev.2 — kills B1/R2):** an event is fan-out-terminal iff `NOT EXISTS (pending delivery for it)`. Zero matching endpoints ⇒ terminal on the FIRST fan-out pass (vacuous rule made explicit, locked by unit §8.10). Mixed outcomes (one delivered + one dead) = terminal; per-delivery truth lives ONLY in the ledger — **`events.dead_at` is DELETED from the model** (rev.1 ambiguity removed).
**Retention (rev.2):** prune by AGE ALONE: `DELETE FROM events WHERE created_at < now() - make_interval(days => RETAIN_DAYS)` (cascades deliveries). Runs EVERY tick BEFORE the kill-switch early-return (§5.6), so a disabled deployment still prunes. `WEBHOOK_RETENTION_DAYS` default 7. No terminal-state coupling ⇒ unbounded growth structurally impossible even with zero endpoints ever.

## 4. Emit sites (identity)

`packages/identity/src/services/events.ts`: `emitEvent(d: DbLike, { tenantId, type, payload })` — one insert on the caller handle.

**Uniform shape (rev.2 B5/R5 — NO self-wrapping anywhere):** every emitting funnel gains/reuses trailing `db?: DbLike` (setUserRoles precedent); transactions are ALWAYS caller-owned (routeTx / UserManager.transaction). A caller not passing a handle runs write+emit as two autocommit statements on `this.db` (accepted window — same posture as today's bumpAuthState-after-write). No funnel may open its own nested transaction (pool-exhaustion hang, B5).

Attach: UM.create→`user.created` · UM.update→`user.updated` · UM.delete→`user.deleted` · UM.changeStatus→`user.suspended|user.updated` · RM.{create,update,setParent,setRolePermissions,assignToUser,revokeFromUser,delete,setUserRoles}→`role.changed` (payload.op discriminator) · TM.{create,update,delete}→`tenant.*` (delete keeps its revokeTenantAccess side-effects) · ApiKeyManager.revoke→`apikey.revoked` · GM.{create,update,delete,addMember,removeMember,setGroupRoles}→`group.changed` (op lifecycle|member|roles).

**Fixture sweep is an explicit T1 deliverable (B4):** every real-manager test factory reaching an emitting funnel must absorb the events insert + gain `transaction` seams where missing — roster: identity `UserManager/RoleManager/TenantManager/GroupManager/ApiKeyManager/cache-invalidation/authorize/funnel-tx-integration` tests + server route mocks `users/roles/tenants/api-keys/scim/groups/manager-singletons/revocation-stack`. Seams LOUD (PIT-082 posture); **swallowing emit errors is FORBIDDEN** (silently voids the durable-trail rule).

Fail-closed same-tx rule (tx-passing callers only): event insert failure ⇒ mutation rolls back ⇒ 500. Surface (B9): register/invite/SCIM/bootstrap/role-save/tenant-ops degrade during events-table outage; sentinel 0009 makes table absence loud at boot.

## 5. Dispatcher (server, lazy loop)

`apps/server/src/utils/webhook-dispatcher.ts`, retention-sweeper lifecycle (F3), rev.2 hardened:

**Step 0 (every tick, BEFORE kill-switch):** age prune (§3).
**Step 1 fan-out:** INSERT…SELECT delivery rows for events with `fanout_complete_at IS NULL`, JOIN pinned `w.tenant_id = e.tenant_id AND w.active AND e.type <> 'webhook.test'` (R3 — test events never fan out) AND subscription filter (`'*' = ANY(w.subscribed_events) OR e.type = ANY(w.subscribed_events)`) AND tenant-live predicate (B7: join `tenants` ON status='active'; DEFAULT tenant always live — exact shape verified in T2). Then terminalize per the §3 vacuous rule (single UPDATE…NOT EXISTS).
**Step 2 claim (canonical CTE — R1):**
```sql
WITH cte AS (
  SELECT id FROM webhook_deliveries
  WHERE status = 'pending' AND next_attempt_at <= now()
  ORDER BY event_id LIMIT 25
  FOR UPDATE SKIP LOCKED
)
UPDATE webhook_deliveries d
SET attempts = attempts + 1, next_attempt_at = now() + make_interval(secs => 60)
FROM cte WHERE d.id = cte.id
RETURNING d.id, d.event_id, d.endpoint_id, d.attempts;
```
Lease = 60s push; crash ⇒ self-heal re-claim ≤60s later; re-claim increments attempts (a crashed attempt WAS an attempt — off-by-one against the 10-cap documented in tests, B8).
**Step 3 sign+POST:** body `{id, type, createdAt, data}`; headers `Content-Type: application/json`, `User-Agent: AccessBase-Webhooks/1`, `X-AccessBase-Event`, `X-AccessBase-Type`, `X-AccessBase-Signature: sha256=<hex(HMAC-SHA256(rawBody, secret))>`; `AbortSignal.timeout(10_000)`; `redirect:'manual'` — any 3xx = failure. **Secrets decrypted ONCE per endpoint per tick** into a `Map<endpointId, plaintextSecret>` built from the tick's claimed rows (R4 — never per-delivery scrypt).
**Step 4 outcome:** 2xx → `status='delivered', delivered_at, response_status`. Else stamp `last_error/response_status`, `next_attempt_at = now() + make_interval(secs => 30 * (2 ^ LEAST(attempts, 10)))` (PG `^` = exponentiation on doubles; scalar-min is `LEAST` — rev.1's `min()` was invalid SQL); `attempts >= 10 → status='dead'`.
**Step 5 SSRF — dedicated parser, FAIL-CLOSED (B2/R6 — ipInCidr is NOT reused as the guard; its fail-open posture is inverted for this use):** `assertWebhookUrl(url)`:
  - protocol http(s); no userinfo; no fragment; strip `[]` brackets from IPv6 hosts;
  - classify: dotted-quad IPv4 (exactly 4 decimal parts) | IPv6 literal — **v4-mapped expansion** (`::ffff:a.b.c.d` AND `::ffff:HHHH:HHHH`) canonicalized to IPv4 BEFORE deny-matching; ANY unparseable host shape ⇒ REJECT (fail-closed, opposite of cidr.ts warnBad — cite in code comment);
  - deny-set on canonical forms: `127.0.0.0/8`, `0.0.0.0/8`, `::1`, `::`, `169.254.0.0/16`, `fe80::/10`;
  - hostname ⇒ `dns.promises.lookup(all)`, every answer family-normalized + re-checked against the same deny-set (un-classifiable answer ⇒ reject); cached ≤30s; re-checked at dispatch time;
  - RFC1918/unique-local IPv4 ALLOWED per ruling. Residual `ponytail:` comment: TOCTOU rebinding (connect-time pin needs custom undici dispatcher — integration day).
  Registration violation → 400 `WEBHOOK_URL_DENIED`; dispatch-time → delivery fail `last_error='ssrf-denied'` (counts toward the 10-cap; bounded).
**Step 6 kill-switch:** `webhooks_enabled` — env `WEBHOOKS_ENABLED` > option (**added to KNOWN_OPTION_KEYS**, R7) > default true. Off ⇒ steps 1-4 no-op (prune already ran; backlog dispatches on re-enable within retention horizon).
**Step 7 test-env gate (B3 — HARD):** the loop is NOT registered when `process.env.NODE_ENV === 'test'` — keeps every vitest suite (incl. real-PG integration files running >15s on shared DEV PG, and dev-machine outbound fetch) dispatcher-free. Boot delay 60s (sweeper-aligned) + interval 5s (`WEBHOOK_DISPATCH_INTERVAL_MS`); running-boolean guard one tick at a time. Static lock in T2: app.ts registers dispatcher behind the env gate; runtime assertion no tick under NODE_ENV=test.

## 6. Admin surface + codes

Codes **24→26**: `webhooks:read`, `webhooks:write` → seed + TENANT_BINDABLE 12→14 + authorize routePermissions, same commit (convention check-command expectations flip same-commit).

`/api/v1/webhooks` (authenticate + requirePermission):
- `GET /` — NEVER projects secret/secret_encrypted (type-level row exclusion, `OidcClientListRow` precedent); pending/dead counts per endpoint (2 aggregates).
- `POST /` {url, description?, subscribedEvents[]} — `assertWebhookUrl`; dup = PRE-CHECK SELECT (tenant,url) → 409 `WEBHOOK_EXISTS` (F16, no 23505 reliance); entries each `'*'` OR `^[a-z]+\.[a-z_]+$` (rev.1's pattern wrongly rejected the `'*'` literal); plaintext secret returned ONCE.
- `PUT /:id` (url re-guarded) / `DELETE /:id` (deliveries cascade; events untouched) / `POST /:id/rotate-secret` (secret once).
- `POST /:id/ping` → insert `webhook.test` event + **direct delivery row for :id ONLY** (R3 — bypasses fan-out by design, §5.1 excludes the type) → 202 `{deliveryQueued:true}`.
- `GET /:id/deliveries?limit=50` — ledger rows (status/attempts/last_error/response_status).

## 7. C-B email templates

- Ids `verify|reset|magic|invite`; option keys `email_tmpl_verify|email_tmpl_reset|email_tmpl_magic|email_tmpl_invite` + `email_locale_default` + `webhooks_enabled` added to `KNOWN_OPTION_KEYS`. **Value shape: jsonb OBJECT** `{subject:{en?,zh?},html:{en?,zh?}}` — NOT a JSON string (F19); writer + reader pinned to the object shape, T4 ships a real-options-round-trip integration probe (PIT-055 lesson: seams that feed strings mask shape bugs).
- **Dual-write closure (R8):** generic `PUT /api/v1/options` applies the SAME validator (shared exported function) to `email_tmpl_*`: object shape, subject ≤200, html ≤20000, no `<script` and no ` on\w+=` attribute literals; `email_locale_default` ∈ {en,zh}. One validate function, two call sites.
- Renderer `apps/server/src/utils/email-templates.ts` (~40 lines): `renderEmail(id, vars, locale?) → {subject, html}`; DEFAULTS = today's four strings upgraded to a minimal transactional shell, zh arms in code; `{{var}}` → HTML-escape every substitution (attr-correct `&amp;` in URLs is fine — verified by a link-with-query test); unknown var left literal + warn-once; locale: arg → `email_locale_default` → `'en'`, missing arm falls back to en. No per-user locale exists server-side (fact) — senders pass undefined; `ponytail:` users.locale when server-side language preference lands.
- Routes `/api/v1/email-templates`, gated by routePermissions rows onto EXISTING codes: `GET→options:read`; `PUT/:id + POST /:id/preview + POST /:id/test → options:write` (test SENDS MAIL → write tier). `POST /:id/test {to}` renders the STORED template, sends via `getSmtpMailer` fire-and-forget → 202; no mailer → 502 `SMTP_UNAVAILABLE` (new code → catalog same-commit, §9).
- Migrate F8's four senders onto `renderEmail` (`{{link}}`, `{{code}}`, `{{name}}`, `{{invitee}}`/`{{inviter}}` per lane).
- Settings: "Email Templates" tab on the Options page surface (F14): list 4, edit modal (subject+html × en/zh), preview (sample vars), test-send.

## 8. Security/release invariants

1. Secret never leaves create/rotate responses (list/get/log/e2e carry none).
2. SSRF suite: `http://localhost`, `http://127.0.0.2`, `http://[::1]`, `http://[::ffff:127.0.0.1]`, `http://[::ffff:7f00:1]`, `http://169.254.169.254`, `http://0.1.2.3`, fe80 form → all DENIED; RFC1918 + public hostname (fake DNS) ALLOWED; dispatch-time re-check + redirect-never-followed tests.
3. Emit participates in caller tx: rollback proof (real-PG: failing events insert ⇒ no user row) — extends funnel-tx-integration family.
4. CTE claim: two parallel claimers never double-claim the surrogate id (real-PG); crash-lease self-heal test (≤60s, B8 off-by-one documented).
5. Template escaping: `<script>` name renders inert; stored-template `<script`/`on*=` rejected on BOTH write paths.
6. Dispatcher dials NOTHING in unit/e2e (fetch seam) + loop absent under NODE_ENV=test (B3) + buildApp keeps zero startup dials (F3 premise).
7. Tenants live predicate: suspended tenant's endpoints receive nothing (B7) while its events still terminalize (vacuous rule).
8. Zero-endpoint growth regression: emit N events, no endpoints, one tick ⇒ all `fanout_complete_at` stamped; prune by age regardless of switch state (§8.10 unit + integration).
9. `GET /api/v1/webhooks` + deliveries ledger tenant-pinned via endpoint ownership (findById tenant predicate).

## 9. Tasks (rev.2)

- **T1 identity:** events service + chain 0009 (generate; F17 text[] probe; sentinel `0009|SELECT id FROM events LIMIT 1`; ops flips EXPLICIT — title, `toBe(20→23)` :166, tracking `9→10` sites (title, :222, :238) + :189 comment, dev db:push) + §4 db?-widening + emit wiring + FULL fixture sweep (§4 roster) + identity units (per-leg emit asserts).
- **T2 server:** dispatcher §5.0-7 + SSRF module — unit battery (injected fetch; prune-decoupling; vacuous terminalization; decrypt-map; CTE claim) + real-PG claim-concurrency + growth regression + test-gate static/runtime locks.
- **T3 server:** /api/v1/webhooks routes + codes 24→26 triple-registration + route tests (ping targets ONLY :id; '*' accepted).
- **T4 server:** /email-templates + renderer + DEFAULTS bilingual + 4-sender migration + options validator-map extension (shared fn) + jsonb round-trip integration probe + route tests.
- **T5 admin-ui:** Webhooks page (reveal-once, active toggle, subscribed-events editor, deliveries drawer, ping) + Email Templates tab + menu/i18n (webhooks:read gate; tab rides options gate).
- **T6 e2e:** webhooks-crud + email-templates specs; ops live-fire fresh(23)/idempotent/legacy-sentinel w/ 0009; full gates (vitest/4×tsc/eslint/e2e); close-out.

**Close-out doc gates (B6/R9 — same commits):** `docs/modules/error-codes-reality.md` += WEBHOOK_URL_DENIED / WEBHOOK_EXISTS / SMTP_UNAVAILABLE (+ SCIM-side group codes if missed in Q4b close-out — check); ui.md/api.md/database.md implementation-status header touch-ups where scope claims shift; conventions Phase Q4c section (dispatcher test-gate, fail-closed SSRF posture, dual-write validator rule, jsonb-shape pinning, events-funnel roster); status.md line; CHANGELOG; AGENTS count parity (24→26, baselines).

## 10. Deferred (triggers)

Per-tenant concurrency cap + backoff jitter (fleet scale) · Redis pub/sub tick-wake (p95 latency need) · `GET /events` history UI + `auth.login.*` events (first customer ask) · users.locale per-recipient language (server-side preference feature) · undici connect-time IP pinning (integration day if hostile-adjacent deployment).
