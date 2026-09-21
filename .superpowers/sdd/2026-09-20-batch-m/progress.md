# Batch M SDD ledger — 2026-09-20-batch-m-ops-remainder
- Spec/plan rev.2 absorbed dual-Momus (7bbe877): 1 BLOCKER (restore identity) + 3 HIGH (dump 600, setup-guard /metrics, metrics-open philosophy→warn+cors:false) + R1/R3 factual corrections.
- Execution: controller direct (PIT-047/065 discipline; git tree clean, no parallel salvage possible).
- Tasks: T4 (entrypoint-dev loud push) → T1 (health memoized singleton + onClose reset) → T2 (metrics full surface) → T3 (backup/restore) → T5 controller (gates + live-fire + memory).

## Task records
- T1 health singleton: bf3a39d + tests 3 (memoized race, onClose reset) — controller direct.
- T2 metrics: 9a1a341 + 43e5768 (fp lift after dist caught encapsulated-only histogram; Origin-404 for missing cors typing; rateLimit route-config for missing skip) — tests 5 + config warn 2.
- T3 backup/restore: 97a2348 — live round-trip verified (drop→restore 16 tables, checksum, typed-name abort).
- T4 entrypoint loud push: 9ce47ae — bash -n; no docker daemon for full e2e of container boot (NOT VERIFIED note).
- T5 close: e2e 5-fail triage → assertion-level fixes (c5e22e0) → 7/7; full 137+3+0; coverage PASS; dist smoke prod-shaped 4/4; PIT-068~070 + D119 + status/conventions written.
- BATCH M COMPLETE.
