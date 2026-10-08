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
4. **Re-encrypt legacy rows** with the `scripts/re-encrypt.ts` tool. It scans
   every envelope ciphertext column, decrypts each value with the current key +
   the `*_OLD` fallback (the same read paths live traffic uses), and rewrites any
   row whose stored value is not already `v2:`-prefixed via `encrypt()`/
   `encryptSecret()`. Never re-implement the envelope formats — the tool reuses
   the identity exports (`crypto.encrypt/decrypt`, `encryptSecret/decryptSecret`)
   so it can never drift from the readers.

   Columns scanned: `users.totp_secret` (MFA family), `oidc_clients.secret_encrypted`
   and `webhook_endpoints.secret_encrypted` (OIDC family).

   ```bash
   # Run from apps/server so tsx + the @accessbase/identity ESM graph resolve.
   # Current keys + DB come from env; the *_OLD vars must stay set for this step.
   cd apps/server
   DATABASE_URL=... JWT_SECRET=... MFA_ENCRYPTION_KEY=... \
     node_modules/.bin/tsx ../../scripts/re-encrypt.ts            # DRY-RUN plan (no writes)
   DATABASE_URL=... JWT_SECRET=... MFA_ENCRYPTION_KEY=... \
     node_modules/.bin/tsx ../../scripts/re-encrypt.ts --commit   # apply
   ```

   The default is **dry-run**: it prints the plan table (`v1->v2` / `v2-skip`, one
   row per stored value) and issues zero UPDATEs. `--commit` applies each rewrite
   under its own try/catch, so a single undecryptable row is reported in a FAILURES
   block (non-zero exit) while every other row still converts.

   **Verify before dropping the OLD var:** re-run the DRY-RUN afterward — it must
   report zero `v1->v2` rows across all three columns. This is also the full-table
   audit the MFA family needs (its legacy rows carry no `v1:` prefix, so a prefix
   count alone is not enough; the scan enumerates every non-`v2:` row).
5. **Retire the OLD var, then rotate next.** Only once step 4's dry-run proves
   every row is `v2:`-current, unset `JWT_SECRET_OLD` / `MFA_ENCRYPTION_KEY_OLD`,
   restart the nodes, and the window is closed — you are now free to roll the
   current key to its next value (repeat from step 1).

## NEVER remove the OLD key before re-encryption

Dropping `*_OLD` while legacy rows remain makes them permanently undecryptable:
MFA logins break for affected users, OIDC clients fail token exchanges, webhook
dispatch fails closed on decrypt. GCM auth failure is loud, not silent — you
will see errors, but the data is not recoverable without the old key.
