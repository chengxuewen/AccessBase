# Batch N SDD ledger — 2026-09-21-batch-n-oidc-persistence
- Dual-Momus: FLOWS bg_db711af9 (R1-R5, APPROVE-WITH-FIXES) + BLOCKERS bg_551c6f2b (B1-B8, APPROVE-WITH-FIXES, 2 gating B1/B2 both in ALREADY-WRITTEN code).
- All absorbed: kind-scoped revoke, SENTINELS array, consume-mark parity + never-log-id; $i/$j fiction retracted; v9.12.2 facts pinned (relative ttl, Interaction always numeric ttl, grantable set).
- Migration: hand-written 0005 trio (partial index beyond drizzle-kit 0.20 generate vocabulary — PIT-072; snapshot carries WHEREs to survive future generate).
- Gates: vitest 931/0 · double tsc · eslint clean on new files · e2e 137+3 (server-only delta noted) · live-fire oidc-flow real-PG + persistence integration 6 + dist prod smoke.
- BATCH N COMPLETE at 23ec26b + memory commit.
