# Q4a Helpdesk Trio — Design Spec

**Driver**: gap-audit market H (admin holding plaintext passwords) · **Baseline**: `78cdbad` · **Facts**: `resetPassword(userId,newPassword)` UM:313; `revokeAllUserSessions` SM:240; force-logout route precedent users.ts:366-390; ResetPassword page + `/auth/reset-password` endpoint consume purpose 'password_reset' {token,newPassword}.

## Items
1. **Column** `users.must_change_password boolean notNull default false` — chain 0007 (drizzle generate) + SENTINELS entry (`0007|SELECT must_change_password FROM users LIMIT 1`) + dev db:push + ops counts 7→8.
2. **Admin reset**: `POST /v1/users/:id/reset-password` (users:write, tenant-scoped findById first): policy(user_create profile) → routeTx{ UM.resetPassword + set mustChangePassword=true } → revokeAllUserSessions → 200. Plaintext never logged/returned (redactor already covers oldpassword/newpassword families — body field `newPassword` rides the existing rule).
3. **Force change on next login**: /auth/login — AFTER active/suspended gates, BEFORE enroll/TOTP arms: `if (user.mustChangePassword) → flowTokens.issue('password_reset',{userId},1800) → 200 {passwordChangeRequired:true, flowToken}` (NO session). `/auth/reset-password` gains: after successful set → clear must_change_password (same update in resetPassword manager: passwordHash+mustChangePassword:false). Invited users have flag=false → same endpoint is plain set-password. Frontend: store login branch (passwordChangeRequired→ navigate `/reset-password?token=ft`) mirroring enroll handoff; Login.tsx guard like mfa card.
4. **Invite email**: `POST /v1/users/:id/invite` (users:write): user exists + no password set OR mustChange true → issue 'password_reset' 72h + Mailer lane (best-effort, subject "Set your password", link `${origin}/reset-password?token=`; origin via resolvePublicOrigin; 202 constant-shape when SMTP missing mirrors forgot). UI: UserDetail action button (Popconfirm not needed — informational send) + create-user "send invite" checkbox posts invite after create when password left blank. Users.ts detail button row.
5. **Reality catalog**: no new wire codes (shapes reuse). New login RESPONSE field only.
6. **E2E**: admin-reset modal happy; force-change round trip (login mock returns passwordChangeRequired → URL /reset-password → submit → pair issued via existing mock); invite POST payload.
**Order/gates**: RED unit first (login arm + endpoints), vitest/4×tsc/eslint, e2e targeted then full, close-out.

## rev.2 — blockers-Momus absorbed (bg_d9f2e1ec). Fixed in-tree NOW: B3 (null-hash first-password lane in UM.resetPassword), B4 (login handler had 4x duplicated enrollGate arms — Q3E insertion-loop bug, deduped to 1), ops counts 7->8 (+stale titles). Verified: B2 forwarding was actually fine (line 324 threads opts+db).

## Standing directives for the remaining implementation (B1/B5/B6/B7)
- B1: the login 200 response schema (auth.ts ~:239-262) MUST declare `passwordChangeRequired: { type: 'boolean' }` alongside mfaRequired — fast-json-stringify strips undeclared; e2e page.route mocks CANNOT catch it (seam family 3rd instance). Lock with an app.inject wire assertion.
- B5: stores/auth.ts login — check `passwordChangeRequired===true && typeof flowToken==='string'` BEFORE the mfaRequired branch; wipe token/refreshToken/user/isAuthenticated (mirror the mfa wipe); hand token via a store field (mfaFlowToken precedent) — navigation lives in Login.tsx, not the store.
- B6: reset endpoint returns no pair (auth.ts:1517 `{success:true}`): force-change completion = ResetPassword.tsx success state + navigate '/login' (?mode=force from the handoff; forgot lane keeps its link copy). Spec item 6's 'pair issued' expectation deleted.
- B7: admin-reset must ALSO bumpAuthState({tenantId,userIds:[id]}) beside revokeAllUserSessions — else target's bearer lives 15m (precedent UM.changeStatus:265-270); invite lane skips (no sessions possible pre-password).
- Passkey/OAuth/SAML logins for mustChange users: accepted gap (flag is a password-credential gate; K-cited Keycloak parity), one line in security.md rotation section.
