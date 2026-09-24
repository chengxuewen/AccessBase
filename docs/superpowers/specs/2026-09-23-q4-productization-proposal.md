# Q4 Productization — Decision Proposal

**Date**: 2026-09-23 · **Source**: gap-audit §B/§C market gaps · **Format**: tick items off; recommended order pre-sequenced below.

## Items

### 1. Helpdesk trio — admin reset / forced change / invite email  [S-M | RECOMMEND: MUST]
- NOW: admin creating a user must know their plaintext password (users.ts create + CSV import); no admin-set-password, no must-change flag, no invite flow. "IAM product where every admin holds every password" is a compliance smell.
- PLAN: `POST /users/:id/reset-password` (admin sets temp password → force-change flag on user row → all sessions revoked via existing funnel); `must_change_password` column + login arm returning `{passwordChangeRequired}` → frontend forced page; invite = reuse Mailer with set-password link (flow token, 72h). ~1 chain file + 3 endpoints + 2 UI affordances.
- RISK: low; everything rides shipped funnels (rotation, revoke, mail lanes).

### 2. User groups + SCIM /ScimGroups  [M | RECOMMEND: YES (next after 1)]
- NOW: roles attach per-user only; upstream IdPs cannot push group membership via our SCIM server (Users-only); org seat management lacks the department/Team lever.
- PLAN: `groups` + `group_users` + `group_roles` (group→role binding = effective-perms union at the existing resolver); Groups CRUD + menu + page; SCIM /ScimGroups list/create/patch-members (RFC 7644 subset); tenant partition codes +groups:read/write/delete (seed 21→24, partition lists +3 — the gate test forces the sync).
- RISK: medium — permission resolver touch (cache keys already per-user; groups widen the union). Mitigated by K-T2 moats staying funnel-side.

### 3. Events outbox + webhooks  [M | RECOMMEND: YES, but AFTER 2]
- NOW: zero fan-out; downstream systems poll audit/SCIM. Audit is HTTP-hook-shaped → non-HTTP writes (bootstrap direct SQL, migrate, selfHeal) are audit-invisible too.
- PLAN: `events` table (outbox) written at the SAME manager funnels that already invalidate caches (users/roles/tenants/keys); dispatcher = signed POST (HMAC-SHA256 + X-Event-Id), retry w/ backoff, per-tenant `webhook_endpoints` rows + admin UI + test-ping; audit-row emission folds in (closes the non-HTTP audit gap). Events: user.created/updated/deleted/suspended, role.changed, tenant.suspended, key.revoked (+auth.login.* optional).
- RISK: dispatcher loops/hangs — bounded retries + dead-letter flag; SSRF on endpoint URLs (block private ranges? decision needed: default allow since this is self-hosted behind the customer's own perimeter, but DENY loopback).

### 4. Email templates + localization  [S-M | RECOMMEND: YES (fold into 3's mail lanes or standalone small)]
- NOW: Mailer.send(to,subject,html) with inline string literals; bilingual product sends English-only transactional mail.
- PLAN: options-backed templates (`email_tmpl_<key>` keys, HTML+subject, en/zh pairs) + tiny renderer ({{var}}) + Settings tab preview reusing generic options CRUD; migrate the 4 senders (reset/magic/invite/verify) onto it. No new table needed at this scale.
- RISK: near zero.

### 5. Branding & self-service portal separation  [M | DEFER unless white-label customer exists]
- login/consent logo+CSS variables from site options; portal = permission-less users get Profile-only chrome. Design-doc heavy, sales-heavy; skip for now is honest.

### 6. LDAP full sync + group mapping  [M-L | DEFER: JIT + SCIM push covers the standard motion; do when a real AD tenant appears]
### 7. Helm chart / K8s  [M | DEFER to docker integration day — same verification environment]
### 8. FGA (resource-level authorization) [L | DECISION NOT FEATURE]: turns AccessBase into the authorization DECISION POINT for downstream apps (check API + tuples + policy engine; Keycloak FGAPv2/Zitadel/Auth0 FGA class). Without it, each app re-implements object-level authz. Only do if the roadmap says "platform, not just admin console+SSO".

## Proposed batches
Q4a = 1 (+4's invite-mail overlap) → Q4b = 2 → Q4c = 3 + 4 → 5/6/7/8 = user's call.
