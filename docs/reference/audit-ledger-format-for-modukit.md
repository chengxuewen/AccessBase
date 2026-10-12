# Audit Ledger Format Specification (for ModuKit alignment)

**Version:** 1.0 · **Date:** 2026-10-12 · **Author:** AccessBase project
**Status:** Proposed for ModuKit D19 observation-loop event-schema alignment
**Authority:** This is an extraction, not a new design. Every field, enum, and
number below is read from the running AccessBase implementation; authoritative
sources are `docs/modules/audit-sdd.md`, `docs/modules/security.md`, and the
code cited inline. Where ModuKit's D19 four-element model (who/what/when/
evidence) is referenced, §3 maps AccessBase fields onto each element.

---

## 1. Scope and intent

ModuKit D37 (2026-10-12) adopted AccessBase's ledger discipline for the D19
observation loop: audit events formatted as who/what/when/evidence. This
document specifies the concrete field set, vocabularies, and retention posture
AccessBase runs in production, so ModuKit's event schema can align without
reverse-engineering. Adopting the tamper-evidence chain (§7) is optional — it
is offered as an upgrade path, not a dependency.

Three principles AccessBase found load-bearing:

1. **Ledger ≠ logs.** The ledger is the security record of choice: complete
   (success AND failure events), attributed, redacted, tamper-evident.
   Application logs are operational fire-and-forget and must never serve as
   the security record. D19's `evidence` element should point at the ledger.
2. **Attribution has a defined fallback chain.** Every event names an actor
   even when identity is partial (system jobs, failed logins, API keys).
   "Unknown actor" is a named state, not a gap.
3. **Redaction happens at write time, by field name.** Secrets never enter
   the ledger at all — downstream consumers (observation loops included) can
   index and display it without a second sanitization pass.

---

## 2. Record format (flat row)

16 fields. Types are PostgreSQL-flavored; a JSON-Schema equivalent is in §10.
Nullable unless marked NOT NULL. Source: `packages/identity/src/db/schema.ts`
(`audit_logs`, lines 190-213).

| # | Field | Type | Notes |
|---|-------|------|-------|
| 1 | `id` | uuid, server-generated, PK | event handle — see §2a |
| 2 | `tenant_id` | varchar(64) | scope boundary; `'system'` = platform-fired |
| 3 | `user_id` | varchar(64) | actor id with fallback chain (§4) |
| 4 | `action` | varchar(128), NOT NULL | dotted lowercase vocabulary (§5) |
| 5 | `resource_type` | varchar(64) | e.g. `user`, `role`, `tenant` |
| 6 | `resource_id` | varchar(64) | subject row id |
| 7 | `request_body` | jsonb | evidence body, redacted at write time (§6) |
| 8 | `response_status` | integer | HTTP status; failure rows are first-class |
| 9 | `request_id` | varchar(64) | correlation handle (§6.2) |
| 10 | `ip` | varchar(45) | v4 or v6 |
| 11 | `user_agent` | text | raw header value |
| 12 | `created_at` | timestamptz, NOT NULL | server clock at write (when) |
| 13 | `row_hash` | text | per-row tamper chain link (§7) |
| 14 | `anchor_id` | bigint | day-anchor pointer, FK-free (§7) |
| 15 | `erased_at` | timestamptz | RTBF tombstone, both-or-none with #16 (§8.2) |
| 16 | `erasure_id` | uuid | link to erasure ledger row (§8.2) |

### 2a. Field semantics that matter to a consumer

- **`id`** — server-generated at write time. Use it as the event handle;
  never timestamps (clocks drift), never client-supplied ids (injection
  surface into the observation loop).
- **`tenant_id`** — the literal string `'system'` marks platform-fired events
  (anchoring, retention sweep, telemetry). NULL is a schema violation.
- **`response_status`** — captured at response time for both success and
  failure. A `LOGIN_FAILED` row with status 403 is a complete, queryable
  security event — do not drop or separately summarize failures.
- **`erased_at` / `erasure_id`** — both-or-none pair set during sanctioned
  RTBF erasure (§8). A row carrying this pair was scrubbed on purpose; its
  chain fields remain intact and verifiable.

---

## 3. Mapping to ModuKit D19's four elements

| D19 element | AccessBase fields | Rationale |
|---|---|---|
| **who** | `user_id` (fallback chain §4) + `ip` + `user_agent` + `tenant_id` (scope) | actor identity, network origin, and authority boundary are separate concerns; keep all three |
| **what** | `action` + `resource_type` + `resource_id` + `response_status` | verb + target + outcome; `response_status` is part of "what happened", not metadata |
| **when** | `created_at` (timestamptz) + `request_id` (ordering aid) | wall clock for humans, correlation id for machines |
| **evidence** | `request_body` (redacted) + `request_id` + `id` + chain fields (`row_hash`/`anchor_id`, optional §7) + `erasure_id` (RTBF proof §8) | payload + verifiable integrity; evidence must survive a tamper accusation |

---

## 4. Actor attribution (the `who` fallback chain)

Source: `packages/audit/src/middleware.ts` (D1 decision, batch D).

Resolution order for `user_id`:

1. Authenticated user id (`user.id`)
2. JWT/API-key subject (`user.sub`) — token payloads may carry only `sub`
3. `'anonymous'` — unauthenticated request that still produced a ledger row
   (failed login, public endpoint)
4. `'system'` — platform-fired events with no request context at all

The chain is closed: every row has a non-empty actor value. When ModuKit's
bridge plugin fires events, attribute them to the plugin's deployment
identity (their `runtime.toml` `identity` field maps naturally onto step 2 —
a machine principal), never to a human user.

---

## 5. Action vocabulary (the `what`)

Two layers, both closed sets:

**HTTP-derived coarse actions** (`packages/audit/src/types.ts`):
`CREATE` | `UPDATE` | `DELETE` | `LOGIN` | `LOGOUT` | `LOGIN_FAILED` —
mapped from request method (POST→CREATE, PUT/PATCH→UPDATE, DELETE→DELETE);
auth endpoints carry the semantic LOGIN/LOGOUT/LOGIN_FAILED. GET is not
audited (read events would drown the ledger; reads are covered by access
controls + the events outbox when needed).

**Domain events** (`packages/identity/src/services/events.ts`) — dotted
lowercase, emitted at manager funnels on the caller's transaction handle:
`user.created` `user.updated` `user.deleted` `user.suspended`
`role.changed` `group.changed` `tenant.created` `tenant.updated`
`tenant.suspended` `tenant.deleted` `apikey.revoked` `webhook.test`
`audit.erased` `auth.login.success` `auth.login.failure` `auth.logout`

Vocabulary rules for ModuKit: `<domain>.<verb>` lowercase dotted; past tense;
new verbs extend the set — never redefine an existing one (consumers key on
exact strings). Failure is a distinct verb (`auth.login.failure`), not a
flag on the success event — failures must be independently enumerable.

---

## 6. Evidence discipline

### 6.1 Redaction at write time

Source: `packages/audit/src/types.ts` (redaction config, lines 151-153) +
`packages/audit/src/logger.ts` (`redactFields`, recursive).

Redact-list (field names, lowercased compare, recursive into nested objects):
`password` `token` `secret` `api_key` `credit_card` `plaintext`
`accesstoken` `refreshtoken` `oldpassword` `newpassword` `flowtoken`
`idplogouturl` — plus `code` always redacted by the logger. Replacement is
the literal `[REDACTED]`; the field's presence is preserved (shape survives,
value does not).

Rule for ModuKit: every credential-bearing field a bridge plugin might write
must be on the list BEFORE the first event fires, not after a leak. Absence
from the list is a silent leak, so the list is code-reviewed like a security
boundary — because it is one.

### 6.2 Correlation

`request_id` is the join key across ledger ↔ logs ↔ traces. Observation-loop
correlation rules:

- Correlate by `request_id`, not timestamp windows (multi-node clock drift
  makes time-window joins lossy — AccessBase learned this running two nodes
  against one store).
- If the caller supplied a correlation id (e.g. W3C `traceparent`), record
  both ids. AccessBase currently records only its local id; the dual-id form
  is the recommended shape for cross-system bridges.

---

## 7. Tamper-evidence chain (optional upgrade path)

AccessBase seals rows so any later mutation is detectable. ModuKit does not
need this for D19 alignment, but the observation loop's `evidence` element
becomes independently verifiable if adopted.

### 7.1 Row hash

`row_hash` = hash over the canonical row serialization, computed by the
storage layer at INSERT (`packages/audit/src/hashing.ts`). The application
logger never supplies it — the write path is the single sealing point.

### 7.2 Daily anchors

A background worker (`apps/server/src/utils/audit-anchor.ts`) anchors each
day: `audit_chain_anchors(day, seq, first_id, last_id, row_count, root,
prev_root)` — a Merkle-style root per day-chunk, `prev_root` chaining days.
Retention pruning marks anchors `pruned_at` in the same transaction as the
DELETE (mark-first, crash-safe).

### 7.3 Verification

`GET /api/v1/audit-logs/verify` returns a bounded report
(`apps/server/src/utils/audit-verify.ts`):

```
VerifyReport {
  from, to,                       // verified window
  rowsChecked, rowsErased,        // scrubbed rows re-verify against original pre-scrub hash receipts
  anchorsChecked, prunedAnchors,
  unanchoredRows, legacyPreChain,
  chainOk: boolean,
  firstFailure: { day, seq, kind, rowId } | null,
  partial: boolean,               // hit the 100k row budget
  durationMs
}
```

Failure kinds: `row-mismatch` | `anchor-mismatch` | `orphan-erasure` |
`unanchored`. Bounded by design (100k rows + partial flag) so verification
itself is denial-resistant.

---

## 8. Retention and sanctioned erasure (the hard pair)

Ledger systems fail at the seam between "keep everything" and "GDPR says
delete". AccessBase's resolution, in three rules:

### 8.1 Retention

Default **365 days** for audit rows (env-overridable; `0` disables sweeping),
swept at boot+60s then every 24h (`apps/server/src/utils/retention-sweeper.ts`).
Expired session rows get an extra **30-day forensic grace** after expiry.
Anchors are prune-marked, not silently deleted — the verify report reports
`prunedAnchors` so a pruned window is distinguishable from a tampered one.

Suggested tiering for ModuKit (AccessBase runs a single tier today): security
events 365d, ordinary config writes 90d, high-volume telemetry 30d.

### 8.2 Sanctioned erasure (RTBF) — erase, never unmount

Right-to-be-forgotten is satisfied by **scrubbing PII inside rows while the
rows stay in the chain** (`packages/identity/src/managers/UserManager.ts`
erasure funnel, R-audit spec):

- Trigger: user delete with `{eraseAudit: true, legalBasis}` — the stated
  legal basis is REQUIRED (400 without it) and lives ONLY in a dedicated
  erasure-ledger row, never in logs or events.
- Guard: tenant-wide (`all`) data scope required; advisory try-lock shared
  with the anchor worker (`ERASE_LOCK_BUSY` 409 on contention) so erasure
  and anchoring never interleave.
- Subject selection: actor rows UNION mention rows (request body containing
  the subject's email or id) — erasure by actor-id alone leaves
  admin-created subjects unscrubbed (live-fire defect D-ERASE-1, fixed).
- Scrub: whitelisted fields only — body→`{}`, user id→`'[ERASED]'`,
  ip/user-agent→NULL, `erased_at`/`erasure_id` set. Chain fields
  (`row_hash`, `anchor_id`), `action`, and timestamps are NEVER touched.
- Proof: a receipt hash over the ORIGINAL (pre-scrub) row hashes is stored
  in the erasure ledger; the verify endpoint re-derives scrubbed rows against
  their original hashes (`rowsErased` counter). Erasure is thus an auditable,
  verifiable event — not a hole in the record.

### 8.3 The one sanctioned swallow

Telemetry (`auth.login.*`, `auth.logout`) is emitted fire-and-forget: a
failed telemetry insert must never fail or delay the settled HTTP response.
Everything else writes synchronously inside the caller's transaction. If
ModuKit's bridge plugin emits into the observation loop async, it needs the
same documented exception — otherwise the loop silently undercounts.

---

## 9. Read-side isolation (multi-tenant)

Ledger reads are tenant-scoped (`apps/server/src/routes/audit.ts` `buildWhere`):
default-tenant callers see `[tenant, 'system']` rows; every other tenant sees
strictly its own. An observation loop that forwards ledger events must carry
the tenant boundary through — aggregating across tenants at the collector is
a policy decision, not an accident of the pipe.

---

## 10. JSON-Schema sketch (for ModuKit .proto alignment)

```json
{
  "type": "object",
  "required": ["id", "action", "createdAt", "actor"],
  "properties": {
    "id":             { "type": "string", "format": "uuid" },
    "tenantId":       { "type": ["string", "null"] },
    "actor": {
      "type": "object",
      "required": ["userId"],
      "properties": {
        "userId":    { "type": "string" },
        "ip":        { "type": ["string", "null"] },
        "userAgent": { "type": ["string", "null"] }
      }
    },
    "action":         { "type": "string" },
    "resourceType":   { "type": ["string", "null"] },
    "resourceId":     { "type": ["string", "null"] },
    "requestBody":    { "type": ["object", "null"] },
    "responseStatus": { "type": ["integer", "null"] },
    "requestId":      { "type": ["string", "null"] },
    "createdAt":      { "type": "string", "format": "date-time" },
    "chain": {
      "type": ["object", "null"],
      "properties": {
        "rowHash":   { "type": "string" },
        "anchorId":  { "type": "integer" },
        "erasedAt":  { "type": ["string", "null"], "format": "date-time" },
        "erasureId": { "type": ["string", "null"], "format": "uuid" }
      }
    }
  }
}
```

`actor.userId` is never empty: it is an id, a `sub`, or the literal
`'anonymous'`/`'system'` (§4).

---

## 11. Source-of-truth pointers

| Topic | AccessBase authority |
|---|---|
| Table + chain columns | `packages/identity/src/db/schema.ts` (`audit_logs`) |
| Actor fallback chain | `packages/audit/src/middleware.ts` (D1) |
| Redaction list + recursion | `packages/audit/src/types.ts`, `logger.ts` |
| Domain event vocabulary | `packages/identity/src/services/events.ts` |
| Row hashing / sealing | `packages/audit/src/hashing.ts` |
| Anchor worker | `apps/server/src/utils/audit-anchor.ts` |
| Verify endpoint + report | `apps/server/src/utils/audit-verify.ts`, `routes/audit.ts` |
| Retention sweeper | `apps/server/src/utils/retention-sweeper.ts` |
| RTBF erasure funnel | `packages/identity/src/managers/UserManager.ts`, `apps/server/src/routes/users.ts` |
| Read isolation | `apps/server/src/routes/audit.ts` (`buildWhere`) |
| Design narrative | `docs/modules/audit-sdd.md`, `docs/modules/security.md` |

Questions on any field or rule: route through the AccessBase maintainers —
if this document and the code disagree, the code wins and this document gets
corrected.
