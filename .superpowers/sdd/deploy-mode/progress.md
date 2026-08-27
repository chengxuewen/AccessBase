# SDD ledger — plan: docs/superpowers/plans/2026-08-27-deploy-mode.md

**BASE:** 922379f
**Started:** 2026-08-27

## Pre-flight scan

| Tasks | Shared file | Task A produces | Task B consumes | Finding |
|-------|------------|-----------------|-----------------|---------|
| T1→T3 | config.ts | `staticDir`, `adminEmail` | `start.sh` uses `STATIC_DIR` env | Clean — env var, not import |
| T1→T2 | app.ts | `@fastify/static` registration | `build.sh` builds server | Clean — independent |
| T2→T3 | out/ | `out/server/index.js` | `start.sh` runs it | Clean — T2 before T3 |
| T3→T4 | start.sh | `data/.pids` | `stop.sh` reads it | Clean — same pattern as native |
| T4→T5 | scripts/deploy/ | stop/reset scripts | `accessbase.sh` calls them | Clean |
| T5→T6 | accessbase.sh | deploy commands | `.env.example` documents them | Clean |
| T1 | app.ts | SPA fallback + CORS fix | — | Self-consistent |
| T2 | build.sh | copies dist/ only | — | Correct (review fix) |
| T3 | start.sh | admin auto-create via curl | — | Correct (review fix) |

## Rulings

None — pre-flight scan clean.

## Task progress

- Task 1: pending
- Task 2: pending
- Task 3: pending
- Task 4: pending
- Task 5: pending
- Task 6: pending
- Task 7: pending
