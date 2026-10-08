# Multi-Node Deployment Runbook

Operational guide for running AccessBase as **N stateless server instances** behind a
load balancer against **shared PostgreSQL + Redis**. Written after the multi-node
correctness batch (options coherence + envelope key versioning + dispatcher drain).

## 1. Hard prerequisites

| Item | Requirement |
| --- | --- |
| JWT signing | Identical `JWT_PRIVATE_KEY_PATH`/`JWT_PUBLIC_KEY_PATH` (RS256) on every node. All nodes share one `JWT_SECRET`; OIDC interaction cookies derive from it, so divergent keys break cross-node interactions. Key rotation: `key-rotation.md`. |
| `REDIS_URL` | Effectively mandatory (see §2 degradation table). |
| `NODE_ENV=production` | Arms the fail-fast key checks (JWT/CORS/METRICS warn lines). |
| `TRUST_PROXY` | Must be set only when a real L7 proxy is in front; drives client-IP correctness for rate limits and the `/oidc` per-IP guard. |
| `FRONTEND_ORIGIN` / `SITE_URL` | Identical on all nodes (CSP `form-action`, magic-link origin arms). |
| `METRICS_TOKEN` | One shared token; Prometheus scrapes aggregate per-node counters. |

## 2. What Redis coordinates (behavior WITHOUT it)

| Subsystem | Posture when Redis is absent |
| --- | --- |
| Rate limiting | `skipOnError` fail-open → per-process buckets only (limits effectively ×N). |
| Flow tokens (MFA step-up, magic link, SMS OTP, password reset) | Falls back to per-process memory — a chain started on node A cannot be consumed on node B. **Broken cross-node.** |
| Auth-state revocation memo (`authst`) | Reader fails-open: force-logout/role-bump latency degrades to token TTL. |
| Captcha (`CAPTCHA_ENABLED`) | Fail-open (no challenge) on infra loss. |
| Session list cache | Per-process; idle sweeps still correct (DB is truth). |
| Permission cache invalidation (`ab:perm:invalidate`) | Silent single-node; 30s TTL still bounds staleness. |
| Options cache invalidation (`ab:options:invalidate`) | Silent single-node; options cache is cache-until-write, so a node can serve **stale options indefinitely** until it sees a local write. |
| SAML InResponseTo cache (`ab:saml:req:*`) | Falls back to node-saml's per-instance in-memory cache + one warn — since providers are constructed per request, cross-hop (login->acs, logout->response) validation **breaks cross-node AND single-node** without Redis. Treat Redis as mandatory for SAML. |
| SAML SLO replay dedup (`ab:saml:sreq:*`) | Falls back to an in-process Map: replays are only caught on the node that saw the original request (documented ceiling). |

## 3. Per-node background workers (all safe to run everywhere)

- **Webhook dispatcher**: claim CTE uses `FOR UPDATE SKIP LOCKED` with a 60s lease —
  N instances partition deliveries. `stop()` drains the in-flight tick before closing
  the pool (shutdown is at-least-once, never half-sent). Knobs: `WEBHOOKS_ENABLED`,
  `WEBHOOK_DISPATCH_INTERVAL_MS`, `WEBHOOK_RETENTION_DAYS`.
- **Audit anchor worker**: every tick takes `pg_try_advisory_xact_lock(727242)` —
  non-winners no-op. The RTBF erasure funnel takes the same key, so anchoring and
  PII scrubbing serialize against each other.
- **Retention sweeper**: bounded, idempotent — duplicate runs are harmless.
- **migrate.sh** (entrypoint): holds `pg_advisory_lock(727241)` for the whole chain —
  concurrent boot from several nodes queues instead of racing.

## 4. Coherence channels

`ab:perm:invalidate` (permission cache) and `ab:options:invalidate` (options cache):
writers announce on the channel, every node's subscriber drops its local copy
(self-messages re-drop a just-invalidated cache — harmless, no republish loop).
Both setups are silent no-ops when Redis is absent or the identity lane is mocked.

## 5. Graceful shutdown order (LB removal)

1. Stop sending traffic (drain endpoint answers 503).
2. `SIGTERM` → `onClose`: cache-coherence teardowns → sweeper/dispatcher/anchor stops
   (dispatcher finishes the in-flight tick) → singleton pools close.
3. No sticky-session requirement for the JWT API itself; in-flight OIDC interactions
   and flow-token chains survive as long as Redis + the shared key material do.

## 6. Scaling checklist (smoke)

- [ ] `GET /health/ready` green on every node (single shared pool per process — watch `accessbase_pg_pool_*`).
- [ ] Write an option on node A → node B's `/api/v1/options` reflects it immediately (else Redis/coherence is down).
- [ ] Login on A → force-logout on B → A's REFRESH chain dies immediately; the
      bearer survives to its ≤15m TTL (force-logout does NOT bump auth-state — only
      suspend/role-changes emit the ≤30s AUTH_005 path; verification-day live, 2026-10-08).
      Want a hard bearer kill? Suspend the user instead (bumps tokenVersion).
- [ ] Start a MFA step-up / magic-link chain behind the LB — the chain must survive node hops (proves Redis flow tokens).
- [ ] Kill one dispatcher mid-delivery → delivery re-appears as `pending` on another node (at-least-once), never `dead`-on-timeout.

## 7. Known residues (honest list)

- ~~`re-encrypt` tool deferred~~ **SHIPPED** (`scripts/re-encrypt.ts`, verification-day):
  dry-run plan + `--commit` per-row; `*_OLD` windows close with it (see `key-rotation.md`).
- Webhook SSRF guard has a documented DNS-rebinding TOCTOU residual.
- Q3D back-channel: dispatch path live-proven (end_session→confirm fires delivery), BUT
  oidc-provider's own undici dispatcher refuses special-use IPs (RFC6890: loopback AND
  private ranges) → intranet RP `backchannel_logout_uri`s fail delivery by design; the
  front-channel SPA path is unaffected. Receiver-side remains unimplemented (Q3D flagged).
- OIDC RP↔IdP browser round now LIVE-FIRED against our own provider (end_session SSO-kill,
  claims release, private_key_jwt 4/4); real-external-IdP (Keycloak) round still owed —
  docker registry unreachable during verification day.
- One-time-token chains (MFA/magic/OTP) cross-node hop: shared-Redis path code-proven,
  live battery owed (SMTP/MFA env absent on the scratch instances).
