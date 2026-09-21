# N-T2 adapter rewrite + N-T4 entrypoint note
Memory Map deleted; upsert ON CONFLICT (kind,id); find = no TTL read-filter (B6 lazy-delete deviation documented), consume=UPDATE jsonb_set mark, findByUid/ByUserCode kind-scoped, revokeByGrantId(kind,grantId) [B1], sweepExpired swallowed + 5min unref interval + stopSweeper→app.onClose (metrics hooks registration order kept post-hijack).
never-log-id rule (B3): formats/opaque.js value===jti===row id ⇒ bearer token; pino redact misses top-level id ⇒ code comment + conventions.
clockTolerance shim param threaded (default 0); 0s stores now() not NULL.
provider.ts kindAdapter forwards kind; app.ts stopSweeper onClose hook.
Tests: 12 unit (derived cols/TTL math/jsonb seam/kind-scoped revoke/consume-mark/Client branches/sweep swallow) + 6 real-PG integration incl. restart-proxy + Interaction survival + userCode case-fold. oidc-flow (real PG, full protocol) re-ran green on top of persistence.
