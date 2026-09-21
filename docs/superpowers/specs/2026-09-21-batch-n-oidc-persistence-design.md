# Batch N — OIDC Provider State Persistence (Design)

**Date**: 2026-09-21 | **Status**: DRAFT for dual-Momus
**Depends on**: Batch 5 (OIDC provider mount + Drizzle Client adapter), L (ESM/lint gates), M (test discipline)

## Problem

`apps/server/src/oidc/adapter.ts` persists ONLY `Client`; every other kind
(Session, Grant, AccessToken, RefreshToken, AuthorizationCode, Interaction,
ClientCredentials, DeviceCode, Backchannel*, ReplayDetection) lives in a
module-level `Map` catch-all (its own `ponytail:` comment admits it).
Consequences on every deploy/restart:

1. ALL issued refresh tokens die (Grant/RefreshToken gone) → every RP's silent
   re-auth breaks; RPs must re-run full consent flows.
2. In-flight interactions (user mid-consent) evaporate → broken UX.
3. Session rows (sid) vanish → front-channel logout notifications impossible;
   id_token sid dangling.
4. DeviceCode/Backchannel flows non-functional across restarts.

The batch-5 conventions pin the precondition: "persisting later requires
solving provider payload round-trip" — this batch is that solution.

## Goals

- G1: one generic PG table + rewritten adapter: full payload round-trip for
  every non-Client kind, TTL honored, `consume` atomic (single-statement
  DELETE…RETURNING — auth-code double-spend protection).
- G2: restart invariance proven: tokens issued before a server restart still
  refresh after it; consent not re-prompted (Session/Grant/Interaction survive).
- G3: findByUid / findByUserCode / revokeByGrantId via derived indexed columns
  (no full-table scans per provider call).
- G4: garbage does not accumulate: expired rows swept (lazy on-read delete +
  bounded periodic sweep with unref + onClose cleanup).
- G5: existing semantics intact: Client upsert still throws (manager owns it),
  audit table `oidcGrants` stays an audit VIEW written by provider events
  (separate from provider STATE — both exist on purpose).

## Non-goals

- Redis/KV store (PG is the all-in-one truth; deployment has PG, adding Redis
  dependency for this is overkill).
- Encrypting token payloads at rest (DB trust boundary already covers
  passwordHash/oauth tokens; row-level crypto = separate design if ever).
- Device flow / CIBA feature enablement itself (persistence is
  feature-agnostic; those flags stay as-is).
- Sliding-TTL redesign of provider token lifetimes.

## Design

### D1: table `oidc_adapter_state` (drizzle migration 0005 + schema.ts)

```
kind        text        NOT NULL            -- 'Grant' | 'Session' | 'AccessToken' | ...
id          text        NOT NULL
payload     jsonb       NOT NULL
uid         text NULL                        -- derived payload.uid
user_code   text NULL                        -- derived payload.userCode (lower-cased)
grant_id    text NULL                        -- derived payload.grantId
not_after   timestamp(tz) NULL               -- NULL = provider gave no expiry (rare)
created_at / updated_at defaults
PK (kind, id)
```
Indexes: `(kind, user_code)` partial WHERE user_code IS NOT NULL;
`(kind, uid)` partial; `grant_id` plain; `not_after` plain (sweep).
`payload` stores the EXACT object oidc-provider passed (it self-describes with
`$i`/`$j` marker fields when referencing other models — find() must return it
verbatim; provider does the re-hydration). No field re-mapping at all —
the whole round-trip problem reduces to: store JSON, return JSON, honor TTL.

### D2: adapter rewrite (apps/server/src/oidc/adapter.ts)

- upsert(kind,id,payload,expiresInSeconds): derive columns from payload
  (uid/userCode.toLowerCase()/grantId), `INSERT … ON CONFLICT (kind,id) DO
  UPDATE SET payload/excluded…, not_after = now() + make_interval(secs => n)`;
  expiresInSeconds absent/0 ⇒ not_after NULL. n = expiresIn + clockTolerance
  (official storageOptions formula; provider clockTolerance unset ⇒ 0 — if a
  future config sets it, the shim must pass it through).
- find / consume: `SELECT` filter `not_after > now() OR is null`; **consume =
  UPDATE payload SET consumed = epoch RETURNING payload** (v9 memory adapter
  marks `consumed` rather than deleting — verified in
  lib/adapters/memory_adapter.js; the provider's replay logic reads the
  marker, so deletion would CHANGE semantics. UPDATE…RETURNING keeps it
  atomic); find on expired row = delete + undefined.
- findByUid(kind, uid): the official adapter indexes uid ONLY for Session
  (verified: memory_adapter sets sessionUid key only when model==='Session')
  ⇒ uid derived column is populated for Session rows only; lookup
  WHERE kind AND uid (+TTL). findByUserCode: user_code derived generically
  (any payload carrying userCode, lower-cased both sides) WHERE kind AND
  user_code — matches the official userCodeKey index.
- destroy(kind,id): DELETE by kind+id. revokeByGrantId(grantId):
  DELETE WHERE grant_id = $1 across kinds (Grant destroy cascades tokens).
- Non-Client kinds ONLY go to PG; 'Client' find stays the existing manager-
  backed path; Client upsert still throws (byte-identical contract).
- Sweep: every 5 min `DELETE WHERE not_after < now()` — setInterval().unref()
  registered via `app.addHook('onClose', clearInterval)`; table is small,
  indexed by not_after. (G4; replaces the "no TTL sweep yet" admission.)
- The module-level memory Map DELETES ENTIRELY (no dual paths — one truth).

### D3: wiring + lifecycle

`app.ts` already passes `createDb(...)` into buildOidcProvider → adapter ctor
keeps `(db, {getUser})`. No provider config change (adapter interface is the
contract). The memory Map's absence means the OIDC interaction-resume test
seam (flow_token/batch E precedent: FlowTokenService shared-Map test seam) is
UNAFFECTED — interaction *storage* moves to PG, interaction *contract
endpoints* unchanged.

### D4: test matrix (vitest, fake-db chain fidelity per PIT lesson: mocks must
honor both keys kind+id)

1. upsert→find round-trip verbatim payload (incl. `$i`-style refs untouched).
2. TTL: not_after past ⇒ find undefined + row deleted; consume returns-then-
   deletes; consume-after-expiry → undefined.
3. consume atomicity: single statement shape (assert SQL text contains
   'delete' + 'returning' via query-capture mock).
4. findByUserCode case-insensitive (stored lowered, lookup lowered).
5. revokeByGrantId kills Session+AccessToken+RefreshToken rows across kinds,
   leaves Grant row? (provider deletes Grant itself; revokeByGrantId targets
   tokens — mirror official adapter behavior).
6. Client upsert still throws; Client find still manager-path.
7. sweep clears expired (fake timers) + unref + onClose clears interval.
8. restart-simulation: NEW OidcAdapter instance over the SAME fake db store →
   previously upserted Grant/RefreshToken findable (memory Map would fail).
9. integration (live DB, skipIf-PG-down like mfa-integration): auth-code
   exchange → refresh → destroy grant → refresh fails; across TWO adapter
   instances (= restart proxy).

### D5: success criteria

1. G1-G4 unit-verified; live-fire or live-DB test proves cross-instance
   (restart-proxy) refresh success.
2. e2e 137+3 unchanged (provider only live-backed by setup/init specs which
   skip when backend down — unchanged posture); vitest root +N; double tsc;
   eslint 0; coverage gate ≥ floor.
3. Migration: 0005 generated via drizzle-kit (chain discipline — new file in
   packages/migration/drizzle/, never ALTER on legacy push DBs by hand:
   fresh deploys get it via migrate.sh; legacy = db:push, per conventions).
4. Memory: conventions update replaces the batch-5 “memory catch-all” note;
   status row; PIT if discovered; D120 if payload-roundtrip surprises surface.

## Risk ledger (reviewers)

- jsonb key-order loss — provider markers `$i`/`$j` are plain keys; verify
  oidc-provider v7 (installed version — CONFIRM) re-hydration tolerates key
  reordering (jsonb normalizes). If it doesn't: json (text) payload column.
- `consume` must atomically return payload BEFORE deleting: DELETE RETURNING.
- Interaction payloads contain `params` with nested ctx? provider serializes
  its own — verbatim store is still correct.
- Concurrent upsert on (kind,id) — ON CONFLICT handles.
- Sweeper interval vs process defenses (uncaughtException exit1) — unref +
  swallow-in-try/catch (log) mandatory.
- live-DB integration test DATABASE_URL must be a scratch DB, never dev DB.
- `not_after` timezone & make_interval vs pixi PG16 — verify.
- Drizzle 0.29 jsonb round-trip: pass objects, get objects? (PIT-family
  watch: jsonb string-vs-object assumption bit batch B twice) — adapter must
  NOT JSON.parse manually if drizzle parses; integration test pins both seam.
