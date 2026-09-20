# Task 5 report — roles config-surface tails (L′) — controller-audited salvage

Commits 15272ca + c53e040 (attempt-3 session, no report). Audit:
- roles.ts PUT: body parentId nullable-uuid; 'parentId' in body → setParent BEFORE
  update (all parent/cycle validation ahead of any field write — rev.3 ordering fix);
  ROLE_PROTECTED/LAST_ADMIN via sendConflictError; cycle → ROLE_INHERITANCE_CYCLE
  409 (c53e040 adds the manager's untagged 'Inheritance cycle detected' → 409 map);
  not-found family → 404 envelope.
- Roles.tsx: parent Select in modal (options from existing list state minus self,
  isFieldTouched-gated payload — untouched edit sends no parentId, touched+cleared
  sends null); permissions count column record.permissions?.length ?? 0.
- roles.test.ts: setParent spy with ordered callLog + 4 cases (before-update order,
  explicit-null clear, absent-key no-op, ROLE_PROTECTED 409) — 16/16 green.
- roles e2e: +2 cases (parentId in PUT payload; count column).

Deviation logged: cycle-409 code is a NEW identifier ROLE_INHERITANCE_CYCLE not in
the spec D2 error table — acceptable addition (frontend passthrough, no consumer
pin), recorded for the memory closeout. No fixes required.
