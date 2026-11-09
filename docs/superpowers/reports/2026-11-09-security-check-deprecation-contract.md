# Security check — S5-B deprecation contract surface (2026-11-09)

Scope as sanctioned: the CORS `exposedHeaders` addition, the `deprecation.ts` header emitter,
and their interaction with `credentials: true` / `resolveCorsOrigin()`. Method: the
security-hardening skill's phases, but run against THIS repo's real paths — the skill's own
commands point at directories that do not exist here (see §C, which is the more important half
of this report).

## A. The shipped change — verdicts

| Check | Command run here | Result |
|---|---|---|
| Dangerous patterns in the new/changed files | `grep -n "as any\|@ts-ignore\|@ts-expect-error\|eval(\|console\." apps/server/src/utils/deprecation.ts apps/server/src/__tests__/deprecation-headers.test.ts e2e/deprecation-headers.spec.ts` | NONE |
| Hardcoded secrets in the same set | same grep set with `secret\s*=\|password\s*=` | NONE |
| Is a header value attacker-controlled? | read `validateEntry` / `deprecationHeaders` / hook | No. Every emitted value comes from a developer-authored list constant; the only request-derived input is the route TEMPLATE used as a lookup key, and a miss emits nothing. Not an injection sink. |
| Can `exposedHeaders` leak? | values are `Deprecation`/`Sunset`/`Link` — static contract metadata | No new data crosses the CORS boundary; the paths it describes are already published in `docs/openapi.json`. |
| `origin: true` + `credentials: true` (the thing I suspected) | `apps/server/src/config.ts:103-108` `requireCorsOrigins()` | **Falsified — production cannot fail open**: unset `CORS_ORIGINS` in production throws at config time. Origin reflection is therefore a dev/test-only mode. No change needed. |
| Does the empty list cost anything per request? | `registerDeprecationHeaders` early-returns before `addHook` when the index is empty | Zero hook registered today; with entries it is one Map lookup per response. |

**Fixed as a result of this check (medium → done in the same cut):** the validator accepted CR/LF
inside `link`. Since the value is a constant this is not header injection, but a stray escape or a
copy-paste from a wrapped diff would fail at REQUEST time inside `reply.header()` as
`ERR_INVALID_CHAR` — a config typo turning into production 500s on that route. Startup already
refuses every other malformation, so control bytes are now refused there too, by codepoint scan.

Demonstrated rather than asserted: suite GREEN 15/15 → neutralise the new check → **RED**
(`expected '' to contain 'control characters'`) → restore → GREEN 15/15.

| Severity | Count |
|---|---|
| CRITICAL | 0 |
| HIGH | 0 |
| MEDIUM | 1 — found and fixed in this cut |
| LOW | 0 |

## B. What the check did NOT cover

- The live-backend half (`e2e/deprecation-headers.spec.ts`) is SKIPPED without a running server —
  the same discipline as `health.spec.ts`. It was therefore not exercised in this session; the
  CORS behaviour is verified instead by a unit test that drives the real `@fastify/cors` plugin.
  CI runs it only where a backend exists, so `exposedHeaders` correctness rests on the unit path,
  and the e2e path stays a NOT VERIFIED carryover until a backend day (S7).
- No new dependency was added, so dependency audit was out of scope for this change.

## C. The finding that matters more than my change

The `security-hardening` skill as committed **cannot fail**. Its Phase 1-5 commands grep
`packages/auth/`, `packages/core/`, `packages/admin-ui/` and a container named
`audebase-postgres`, and check variables named `AUDE_*`:

```
packages/auth      MISSING     packages/core     MISSING
packages/admin-ui  MISSING     audebase-postgres MISSING
```

This repo's actual layout is `apps/server` + `apps/admin-ui` + 8 `packages/*` (identity, audit,
logging, types, admin, health, i18n, migration). Every grep in the skill therefore returns empty,
every table row reads "✅ 通过", and the report the skill mandates would state a clean security
posture produced by inspecting nothing. That is the same defect class T13 removed from the
doc-audit skill (fabricated targets ⇒ confident false output), in a surface where the cost of a
false green is highest.

Stale claims beyond the paths, each measured against the code today:

| Skill states | Repo reality (measured 2026-11-09) |
|---|---|
| OWASP A02: "JWT HS256" | `app.ts:196` registers `sign: { algorithm: 'RS256', expiresIn: '15m' }`; `config.ts:83` documents the HMAC fallback condition (F12). The symmetric claim is wrong for the shipped default. |
| "登录限速 5 次/分钟 ✅" | There is no login-specific limit. Global `max: 100 / 1 minute` (`app.ts:176-184`) with `skipOnError: true` (Redis outage ⇒ local counting, deliberate fail-soft). Route-level limits exist only on SAML (60/30/10) and for the route-less OIDC hijack space (`oidcIpRatePerMin: 120`), because `config.ts:158-160` records that **route-less (404) region escapes @fastify/rate-limit entirely**. |
| "bcrypt cost 12 ✅" | Numerically right but implementation-wrong: `UserManager.ts:43` imports `bcryptjs` (pure JS), hashed with cost 12 (`:70`, `:546`). |
| "Access token ≤15min ✅" | Holds (`expiresIn: '15m'`). |
| 10 residual identifiers from the dead plugin platform (`aude`, `AUDE_*`, `audebase-postgres`) | none of them exist here |

Disposition: handed to the S2 execution wave (skill-body governance, ADJ-7 family) as the first
work item, ahead of the graphify split — a security skill that always reports green is a worse
defect than a long skill. Registered in the ledger as E20.
