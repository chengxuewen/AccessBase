# Delivery-review team (orchestration intent, host-neutral)

> A team is an orchestration intent, not a host file format. The main session
> is the lead; there is no separate lead role. Members below must be existing
> roles. Discipline follows `skill:expert-panel-review`.

## Members (constant core)
- code-reviewer
- evidence-critic

## Scenario mounts (1-2, from existing domain roles per the changed surface)
Pick mounts matching the delivery surface; they are lenses, not new roles:
api-server (routes/OIDC), web-frontend (frontend contract), db-migrations
(schema), identity-security (auth/session), build-ci (gates not weakened),
deploy-ops (rollback / single-instance), test-strategist (test layering).

## Product
A severity-tagged adjudication report (ready / not-ready) with reproducible
evidence.

## Flow
1. Scope: the lead announces the lineup and the change under review.
2. Independent review: each member gives an independent verdict; no member
   sees another's conclusion first.
3. Challenge: evidence-critic demands file:line + a reproducible command for
   every finding; unproven claims are labelled speculation.
4. Adjudicate: the lead merges into a severity-tagged report; disagreements
   preserved, not voted away; CRITICAL blocks the merge.

## Discipline
- Read-only throughout: this team reviews, it does not implement.
- No re-delegation: a member does not spawn sub-agents.
