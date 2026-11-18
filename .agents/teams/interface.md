# Interface team (orchestration intent)

> For designing or changing cross-plane contracts (API boundaries, schema
> shapes, host faces). Lead = main session; members are existing roles.

## Members (constant core)
- api-server
- evidence-critic

## Scenario mounts
- web-frontend (contract consumer)
- db-migrations (schema producer)
- identity-security (auth/token contracts)

## Product
A contract document with explicit request/response shapes, error semantics,
and a consumer list — every consumer named and confirmed.

## Flow
1. Propose the contract shape (lead drafts).
2. Consumer review: each named consumer-plane member confirms feasibility.
3. Evidence-critic checks the contract against actual call sites (file:line).
4. Adjudicate: contract lands with the consumer confirmations attached.

## Discipline
- Contracts are written down BEFORE implementations diverge.
- Breaking changes require a migration path (evolution-protocol retirement
  four-step).
