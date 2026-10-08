# Key Rotation Runbook (envelope versioning, R-B)

Applies to the two encrypted-at-rest families:

| Family | Key env | Old-key env (rotation window only) | Where stored |
| --- | --- | --- | --- |
| OIDC client secrets + webhook endpoint secrets | `JWT_SECRET` | `JWT_SECRET_OLD` | `oidc_clients.secret_encrypted`, `webhook_endpoints.secret_encrypted` |
| MFA TOTP secrets | `MFA_ENCRYPTION_KEY` | `MFA_ENCRYPTION_KEY_OLD` | `users.totp_secret` |

Envelope formats (see `packages/identity/src/services/crypto.ts` and
`packages/identity/src/managers/OidcClientManager.ts`):

- `v1` (legacy, read-only): pre-versioning format. MFA family: bare
  `base64(iv|tag|ct)` with the raw key; OIDC family: `v1:b64salt:b64iv:b64tag:b64ct`
  with the raw scrypt key.
- `v2` (current, all new writes): `v2:salt-hex:iv-hex:tag-hex:ct-hex`, key =
  KDF(current-key, per-record salt, version info). The v2 derivation is
  domain-separated from v1 (HKDF info `accessbase:envelope:v2` /
  `accessbase:oidc-secret:v2`), so v1 and v2 keys never collide.

Decryption always tries the current key first, then the `*_OLD` env var.
Absent `*_OLD` = single-key mode; nothing else changes.

## Rotation procedure

1. **Add the OLD env var** with the value the key had *before* rotation:
   `JWT_SECRET_OLD=<old JWT_SECRET>` and/or `MFA_ENCRYPTION_KEY_OLD=<old key>`.
   Do not remove the current-key var.
2. **Restart** every node (rolling restart is fine — nodes that already have
   the new pair decrypt everything; nodes still on the old pair keep working
   because both values are present).
3. **Verify decryption**: create a new OIDC client (its secret round-trips on
   use), trigger a webhook delivery, and log in with MFA on a test account.
   All three exercise the v2 + OLD-fallback read paths.
4. **Re-encrypt legacy rows** — **DEFERRED TOOL, REGISTERED DEBT**: no
   re-encrypt utility exists yet. Until it lands, legacy v1 rows stay v1 and
   keep decrypting via the OLD env var. (Debt ticket: re-encrypt tool that
   reads with current+OLD keys and rewrites via encrypt()/encryptSecret().)
5. **Retire the OLD var ONLY after step 4 has converted every row** (or a full
   DB audit proves zero remaining `v1:`-family rows, knowing the MFA family's
   legacy rows have no prefix — the audit for that family is a full-table
   decrypt probe, not a prefix count).

## NEVER remove the OLD key before re-encryption

Dropping `*_OLD` while legacy rows remain makes them permanently undecryptable:
MFA logins break for affected users, OIDC clients fail token exchanges, webhook
dispatch fails closed on decrypt. GCM auth failure is loud, not silent — you
will see errors, but the data is not recoverable without the old key.
