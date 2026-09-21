# N-T1 table+migration
oidc_adapter_state in schema.ts (PK kind,id; uid/user_code/grant_id derived cols; not_after; 4 indexes).
Chain 0005 hand-written trio (SQL+journal+snapshot) — drizzle-kit 0.20 chokes on the I-batch snapshot's partial-index vocabulary (PIT-072), generate unusable until drizzle-kit ≥0.44; snapshot entries DO carry WHERE clauses (verified) so a future regen won't rebuild indexes wrongly.
Chain verified live: fresh 7/7 (18 tables incl. new one), idempotent 0/7 re-run, legacy double-sentinel message asserted in ops-migrate.
