---
name: reuse-first
description: "借先于造：开工前证明没有现成的可用——四步证据链（面清点→NOTE 阅读→命令体验证→豁免声明）。Use before building any new helper/script/rule/pattern when a same-purpose thing might already exist, or when the user says 先找现成的/别重复造."
---

# reuse-first — prove nothing usable exists BEFORE building

> Ported from MediaServo's reuse-first (ruling RA-1818-2, 2026-11-18).
> Mechanism-level: the four-step chain is the skill; the donor's scar table
> is its own history, not ours. Charter summary:
> `docs/reference/reuse-first-charter.md`.

## The four-step evidence chain (all four, in order)

1. **Face inventory** — search the surfaces where a same-purpose thing would
   live: `.agents/skills/`, `.agents/rules/`, `scripts/`, `docs/reference/`,
   package scripts (`pixi.toml`, `accessbase.sh`), and the patterns library.
   Name the search commands you ran.
2. **Read the NOTEs** — for every candidate found, read its usage note /
   header comment / SKILL.md. A candidate that exists but is unusable for a
   stated reason is EVIDENCE, not noise.
3. **Command-verify** — run the candidate's check/usage command to prove it
   actually works here (a paper-only candidate is not a reuse). Record the
   command + output. (PIT-097 discipline: verify the verifier on both
   samples — the command must demonstrably hit.)
4. **Waiver statement** — if and only if steps 1-3 produced nothing usable,
   write ONE sentence in the plan/commit stating what was searched and why
   nothing fits. No waiver, no new build.

## Scope

Applies to NEW helpers, scripts, rules, patterns, generator layers, and any
"let me just write a quick…" impulse with an existing-thing-shaped shadow.
Does NOT apply to genuinely novel mechanisms (the evolution protocol's
`innovate` tag already forces naming the new judgment path).

## Relations

`skill:repo-audit` discovers gaps; this skill prevents creating gap-fillers
that duplicate what exists. `skill:code-simplification` cleans the
duplicates that got past this skill.
