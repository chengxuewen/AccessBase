# 4A Optimization Roadmap — Adjudication Record

**Date:** 2026-11-23
**Method:** adjudication-walkthrough (one adjudication per message, seven-part template, plain text)
**Status:** RATIFIED — eight rulings, all option B, user-adjudicated one by one. **NO code landed.** These are design-phase rulings; each batch proceeds via the live pipeline (spec → dual-Momus → TDD → live-fire).
**Decision ledger:** D130 (`.agents/memorys/decisions.md`)

## Context

A 4A (Account / Authentication / Authorization / Audit) gap analysis was run against the current surface. Finding: ~80% of the standard checklist is already covered, several areas exceed the baseline:

- Authentication: OIDC IdP (device flow, rotating JWKS, private_key_jwt, back-channel logout sender) + generic RP (end_session, back-channel receiver Q3D); SAML SP (SSO + SLO both directions, signed-redirect enforcement); LDAP bind; passkey / magic link / SMS OTP; enforced MFA + captcha + CIDR admission.
- Account: SCIM 2.0 Users + Groups full CRUD/PATCH/filter + discovery trio; JIT provisioning; DELETE soft-disable + session revoke; external identity keyed on (provider, providerAccountId), not email.
- Authorization: RBAC1 + tenant partition + data-scope (self/dept/all); 30s permission cache + cross-node pub/sub invalidation + tokenVersion ≤30s revocation; roles NOT in JWT.
- Audit: hash chain + anchor worker + verify endpoint + sanctioned erasure + retention sweeper + redaction.
- Machine: client_credentials + scope, private_key_jwt, API keys + scopes.

The real gaps are cross-domain / outbound: CAEP session revocation, audit export channels, an external AuthZEN PDP, SCIM ETag, per-key CIDR, the SAML IdP direction, legacy header-injection, and a disciplined defer list.

## Summary of Rulings

| # | Topic | Ruling | One-line key note |
|---|-------|--------|-------------------|
| 1 | CAEP session-revoked push | B | Standard SET push + static per-client endpoint, reuse dispatcher; CAEP+RISC vocabulary, iss_sub subject; full SSF management API deferred |
| 2 | Audit export + schemaVersion + Decision | B | Add schemaVersion + Decision field; real-time HTTP export of audit rows reusing dispatcher; syslog/OTLP deferred |
| 3 | AuthZEN evaluation API | B | Minimal PDP (discovery + evaluation + evaluations, no search); dedicated-scope API key auth fixed day one; tenant-confined, fail-closed, audited |
| 4 | SCIM ETag | B | Strong ETag (updatedAt) + If-Match on six write handlers, 412 on stale; discovery flips true; no 304 caching |
| 5 | API key per-key CIDR | B | Optional CIDR column (null = unrestricted), reuse cidr.ts in authenticate apikey branch; validate at write; dynamic-IP caveat documented |
| 6 | SAML IdP direction | B | Sales-gated build (samlify pre-selected; metadata/SSO/IdP-side SLO); federation bridge documented as interim |
| 7 | Legacy header-injection | B | Add groups OIDC claim/scope from GroupManager + oauth2-proxy reference config + hardening checklist |
| 8 | Defer list | B | Defer ReBAC/Kerberos/CAS/mTLS + full OCSF; align export payload naming to OCSF at design time (aligned ≠ certified) |

## Ruling Details

### 1. CAEP / RISC session-revoked push (transmitter)

- **Boundary:** transmitter only (AccessBase as IdP pushing to downstream RPs). Receiver side out of scope.
- **Decision:** On suspend / delete / SCIM DELETE, emit a signed RFC 8417 SET to a statically registered per-client endpoint (clients table column, backchannel_logout_uri precedent). Vocabulary split: CAEP `session-revoked` for sessions, RISC `account-disabled` / `account-purged` for account state. Subject format `iss_sub` (RFC 9493). Transport reuses the webhook dispatcher (backoff / SSRF guard / drain / metrics). Full SSF stream-management API deferred to an upgrade path (wire format unchanged).
- **Why B:** Keycloak (KEYCLOAK-managed static streams) and Okta (SET delivery rides the existing Event Hook infra) both validate "reuse durable outbox + static pre-provision". Internal ≤30s revocation already exists; this is the cross-domain last hop.
- **Key constraint:** must ride OUR dispatcher, not oidc-provider's undici dispatcher (the latter refuses special-use IPs — intranet RPs fail by design; verification-day finding).
- **Sources:** `UserManager.ts:480-485`, `services/events.ts:26-33`, `utils/webhook-dispatcher.ts`, `db/schema.ts:352-353`; keycloak.org/securing-apps/ssf-support; help.okta.com configure-shared-signal-transmitter; RFC 8417 / 8935 / 9493, OpenID CAEP 1.0 / SSF 1.0 / RISC 1.0.

### 2. Audit export + schemaVersion + Decision field

- **Boundary:** field completion is the floor (all options); the contest is the real-time export channel.
- **Decision:** Add `schemaVersion` to webhook payload (currently `{id,type,createdAt,data}`, no version) and a Decision field to audit_logs (requirePermission currently only pino-warns denials; the matched permission code is not recorded). Real-time HTTP export of audit rows reusing the dispatcher (GitLab- Ultimate HTTP-streaming parity). Queue shape — audit.* event family vs cursor-exporter over the append-only audit table — TBD at spec. rowHash travels with each export so receivers can verify the chain.
- **Why B:** the audit table is itself a durable append-only queue; reusing the dispatcher gives delivery visibility (dead-letter + metrics) that a log-mirror cannot. syslog/CEF/OTLP direct sinks deferred to first customer demand.
- **Open spec detail:** events-table age-prune must not drop undelivered audit events (exemption or cursor shape); write amplification needs a load check (audit must not be sampled).
- **Sources:** `db/schema.ts:194-220`, `utils/permission.ts:63-74`, `utils/webhook-dispatcher.ts:256-262`; docs.gitlab.com audit_event_streaming; gitlab.cn 等保三级 guide (off-site retention); Keycloak forum / skycloak (log/SPI route).

### 3. Minimal AuthZEN PDP

- **Boundary:** expose authorization as a standard PDP; single + batch evaluation, no search.
- **Decision:** `POST /access/v1/evaluation` (+ `/evaluations`, + discovery). resource.type + action.name → `resource:action` code; resource.id on the users surface → existing data-scope row check. Caller auth = dedicated-scope API key (NOT forwarded user token), fixed day one. Tenant-confined, unknown subject/code → decision:false (fail-closed), every evaluation audited (synergy with ruling 2 Decision). Capability boundary documented honestly: code-level + users-row-level, NOT per-resource-instance policies.
- **Why B:** AuthZEN Authorization API 1.0 became an OpenID Final Specification (2026-01); Keycloak 26.7+ wraps its existing engine the same way (experimental). Search is optional and Keycloak skipped it.
- **Design lessons copied:** Keycloak 26.7→26.8 broke PEPs by changing "any valid token" → "confidential client token only" — pin the caller auth model from day one; X-Request-ID echoed on all responses.
- **Sources:** `PermissionManager.ts:189-215`, `utils/data-scope.ts:28-66`, `utils/permission.ts:30-76`; keycloak.org/securing-apps/authzen-authorization; keycloak.org/2026/05/authzen-as-experimental-feature; startwithidentity.com/glossary/authzen; spec authority openid.github.io/authzen.

### 4. SCIM ETag concurrency control

- **Decision:** Strong ETag from `updatedAt` fingerprint + If-Match gate on Users/Groups PUT/PATCH/DELETE (six handlers); mismatch → 412. ServiceProviderConfig `etag.supported` flips false→true. No If-Match = today's behavior (zero change for Okta/Entra, which do not send If-Match). No If-None-Match/304 (pseudo-need for provisioning traffic).
- **Why B:** cheap (one fingerprint + six gates), zero downside for non-If-Match clients, closes the only `false` in discovery. RFC 7644 ETag is MAY; honest false was compliant but a visible procurement gap.
- **Open spec detail:** groups fingerprint source (updatedAt column vs content hash).
- **Sources:** `routes/scim.ts:276,582-997`, `db/schema.ts:49`; RFC 7644 §3.14/§5; learn.microsoft.com Entra provisioning requirements (no ETag requirement); Fleet SCIM blog (Entra non-compliant default, aadOptscim062020).

### 5. API key per-key CIDR allowlist

- **Decision:** Optional CIDR list column on api_keys (null = unrestricted, zero behavior change for existing keys); check request.ip in the authenticate apikey branch reusing `utils/cidr.ts`; validate CIDR at CRUD write; denials audited. Hardens the weakest machine lane (article ranks API key + IP allowlist as fallback; stronger client_credentials + private_key_jwt already exist).
- **Why B:** matcher is in the same utils dir; Cloudflare API tokens make IP filtering a first-class token property.
- **Caveat documented:** dynamic egress IPs (GitHub-hosted runners) self-lock with an allowlist (Cloudflare runbook 9109 incident); TRUST_PROXY misconfig distorts request.ip (same seam as login admission, W1-5 wired).
- **Sources:** `db/schema.ts:477-495`, `utils/cidr.ts` + `routes/auth/login.ts` (AUTH_IP_002); developers.cloudflare.com/api/tokens; github.blog IP allow lists; Cloudflare API Token Runbook.

### 6. SAML IdP direction (sales-gated)

- **Direction clarified:** inbound (customer ADFS = IdP, us = SP) already works — the article's "stuck on ADFS" scenario is covered. The gap is outbound (AccessBase = central IdP for SAML-only downstream apps); `SamlProvider.ts` is SP-only and node-saml does not do IdP.
- **Decision:** Commit to build, gated on the first SAML-only downstream customer. Library pre-selected: samlify (IdP+SP). Surface: metadata + SSO assertion issuance + IdP-side SLO. Until triggered, document a federation bridge (mature SAML IdP satellite federating to AccessBase via OIDC) as the interim answer. Same sales-gate discipline as branding/portal.
- **Why B:** SAML IdP is a commercial must-have for an integrated platform (Ory's permanent OIDC-only stance fails procurement checklists), but XML-DSig/assertion signing is security-critical and must not be built speculatively without a customer to validate against.
- **Sources:** `providers/SamlProvider.ts:1-11`; samlify.js.org; kb.ekarisky.com IdP comparison (Zitadel/Keycloak/Authentik SAML IdP; Ory Hydra OIDC-only); logout-coherence batch / PIT-084 (SP-side SLO experience).

### 7. Legacy header-injection (groups claim + oauth2-proxy)

- **Verified gap:** OIDC provider claims mapping is profile/email only (`provider.ts:193-196`, `adapter.ts:187-192`) — no `groups` claim/scope. oauth2-proxy `--allowed-group` reads the groups claim and generic OIDC implicitly requests groups scope; an undeclared scope is rejected by our provider. Pure-docs would leave group-based legacy-app gating non-functional.
- **Decision:** Add `groups` scope + claim projected from GroupManager (tenant-confined, emitted only when groups scope requested). Ship oauth2-proxy reference config (with `--allowed-group`) + hardening checklist. The groups claim benefits every OIDC RP, echoing SCIM Groups.
- **Hardening pillars (article pitfall #4, precise form):** (1) keep skip_auth_strip_headers AND explicitly clear every identity header at the edge (it only strips headers the proxy is configured to set); (2) `--reverse-proxy` MUST pair with narrow `--trusted-proxy-ip` (else defaults to trusting 0.0.0.0/0); (3) `--trusted-ip` is auth bypass — forbid direct connection to the proxy.
- **Sources:** `oidc/provider.ts:193-196`, `oidc/adapter.ts:187-192`, GroupManager (Q4b); oauth2-proxy.github.io/configuration/overview (7.15.x).

### 8. Defer list + OCSF design-time alignment

- **Decision:** Defer ReBAC/OpenFGA (Q4d item 8 roadmap gate; ruling 3's AuthZEN PDP is the future hook), Kerberos/CAS (declining ecosystems, no demand), mTLS/SPIFFE/Vault (ecosystem-dependent; private_key_jwt already covers strong cross-domain machine identity), and full OCSF schema (8+ classes / 17 objects / profiles). BUT align the ruling-2 export payload field naming to OCSF core objects (actor.user / src_endpoint.ip / activity / result) at design time — required fields first, raw audit row retained. Document "OCSF-aligned, NOT OCSF-certified".
- **Why B:** design-time naming alignment is nearly free on a freshly designed payload and is the article's explicit recommendation for new projects; retrofit is expensive. Full compliance stays deferred.
- **Sources:** status.md Q4d item 8; logout-coherence T-PKJ; infinite-zh.com/posts/application-security/ocsf (OCSF joined Linux Foundation 2024-11); renrendaima.com/article/37816 (lightweight four-step adoption); repo grep (Kerberos/CAS/mTLS/OCSF zero hits).

## Registered Deferrals / Open Items (explicit, not silently swallowed)

| Item | Trigger to revisit |
|------|--------------------|
| Full SSF stream-management API (ruling 1 C) | First real SSF receiver requiring dynamic subscribe/verification |
| CAEP/RISC receiver side (AccessBase as RP) | Upstream IdP emitting shared signals |
| syslog/CEF + OTLP direct audit sinks (ruling 2 D) | First customer naming a traditional SIEM / observability backend |
| Audit export queue shape | RESOLVED D-1=B (cursor-exporter over audit table); see spec rev.2 §0.1 |
| AuthZEN search APIs (ruling 3 C) | First integrator needing list-filter / UI-button search |
| SCIM groups fingerprint source | Ruling 4 spec phase |
| SAML IdP build (ruling 6) | First SAML-only downstream customer (sales-gated) |
| ReBAC / OpenFGA | Q4d item 8 roadmap decision |
| mTLS / SPIFFE / Vault dynamic credentials | Infrastructure ecosystem readiness |
| Kerberos / CAS | Concrete customer demand (none today) |
| Full OCSF schema compliance | OCSF ecosystem / procurement demand |

## Cross-Ruling Synergies

- Ruling 1 + 2 reuse the same webhook dispatcher (durable outbox, backoff, dead-letter, SSRF guard, metrics).
- Ruling 3 evaluations feed ruling 2's Decision field (authorization provenance in the audit trail).
- Ruling 7 groups claim echoes the existing SCIM Groups surface (Q4b).
- Ruling 8 OCSF naming rides ruling 2's freshly designed export payload + schemaVersion.

## Execution Discipline

Design-phase project: NO code implemented by this record. Each ruling becomes a batch only on explicit user direction, through spec → dual-Momus review → TDD → live-fire. Rulings 1/2/3/5/7 are mutually independent and reuse existing infrastructure — candidates for a single compliance-line batch. Ruling 6 is sales-gated. Ruling 8 is a design-time constraint on ruling 2, not a separate batch.

## Spec-Phase Design Questions (resolved 2026-11-23)

The compliance-batch spec draft (`docs/superpowers/specs/2026-11-23-4a-compliance-batch-design.md`, rev.2) surfaced six design questions, user-adjudicated one by one: **D-1=B** (CAEP rides user.* events + SET adapter; audit cursor-exporter over the audit table), **D-2=A** (decision joins D1 hash via the `responseStatus ?? undefined` convention), **D-3=A** (reuse JWT/OIDC RS256 key + same JWKS), **D-4=B** (AuthZEN under `/api/v1/authzen`; route-specific `authzen:evaluate` scope), **D-5=A** (flat group-name array, all kinds), **D-6=A** (one consolidated migration 0014). Recorded in spec §0.1/§5. NO code landed.

## Expert Panel Review + Re-rulings (2026-11-23)

A 4-role expert panel (correctness / evidence / security / migration; Deep gate; parallel isolated subagents) reviewed spec rev.2 — report `docs/superpowers/reports/2026-11-23-4a-compliance-panel-review.md`. **Verdict: BLOCK as approved.** Cryptographic/schema anchors verified true, but the transport premise was falsified: F-01 (webhook_deliveries is FK-bound to webhook_endpoints + spec-locked claim CTE → cannot carry CAEP SETs), F-02 (default insert drops the seal; production hashing is the anchor backfill → D-2 ripple was incomplete), F-03 (audit_logs.id is a random UUID → cursor-exporter had no orderable key).

Two conflict items re-ruled by user one by one:
- **P-1=C — supersedes D-1=B (transport) + D-6=A (migration scope):** split transport. CAEP → dedicated `caep_deliveries` table (independent of webhook kill-switch/prune); audit → cursor-exporter over a NEW monotonic `audit_logs.seq` column (zero double-write); shared retry/SSRF primitives only, webhook engine untouched; migration reopened to multiple objects.
- **P-2=B — supersedes D-3=A:** dedicated SET private key + distinct kid published in the SAME JWKS (loadJwks multi-key), isolating the event-signing blast radius (security-lens dissent adopted).

D-2=A / D-4=B / D-5=A stand. Panel HIGH/MEDIUM/LOW findings folded into spec rev.3 as binding design requirements. Spec upgraded to rev.3; execution plan written (`docs/superpowers/plans/2026-11-23-4a-compliance-batch.md`). Pending scoped re-review of rev.3 + explicit user go. NO code landed.

## Panel Run 2 + Re-rulings P-3..P-8 (2026-11-23)

A second 5-role panel (correctness/evidence/security/migration/test-coverage) reviewed the execution plan — verdict BLOCK (PC-1 cursor commit-inversion, PC-2 SCIM PATCH enqueue miss, PC-3 cross-tenant export leak; report Run 2 section). Six conflict items user-adjudicated one by one, all resolved: **P-3=B** CAEP enqueue moved to the manager funnel (changeStatus/delete, same-tx DbLike insert, emitEvent precedent — covers both SCIM PATCH arms and all future paths by construction) · **P-4=A** gap-aware export cursor (advance through contiguous seq only; 10-min gap timeout + skippedSeq ledger) · **P-5=A** platform-only export destinations (platform belt + new `audit_export:write` code + apikey deny + full SSRF stack; cross-tenant leak killed by construction) · **P-6=B** staged low-lock seq column (bigint→backfill→sequence→default→validated NOT NULL; no table rewrite) · **P-7=B** trustProxy guard = prod fail-fast boot hook (requireJwtSecret class; dev WARN) · **P-8=B** caep_deliveries.clientId SET NULL + drainer dead-letters orphans (compliance evidence preserved, bounded retention). PH-1..PH-9 + all MEDIUM findings folded into plan rev.2 (execution authority) + spec rev.4. BLOCK lifted; execution gated on explicit user go. NO code landed.