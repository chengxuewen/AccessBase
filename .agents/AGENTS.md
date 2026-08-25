# .agents/ — AI Agent Configuration

## OVERVIEW

Project-specific AI agent configuration: skills, coding rules, and project memory.

## STRUCTURE

```
.agents/
├── skills/              # 20 project skills (openspec, graphify, test-harness, etc.)
│   ├── openspec-*/      # OpenSpec workflow (propose/apply/verify/archive)
│   ├── graphify/        # Codebase knowledge graph
│   ├── test-harness/    # TDD test generation from SDD
│   ├── design-system/   # UI consistency enforcement
│   ├── security-hardening/  # OWASP + JWT/RBAC checks
│   └── ...              # 15 more skills
├── rules/               # Per-language coding rules
│   ├── common/          # Cross-language rules (security, testing, git, etc.)
│   ├── typescript/      # TS/JS specific rules
│   ├── python/          # Python rules
│   ├── golang/          # Go rules
│   └── ...              # 12 more language dirs
└── memorys/             # Project memory (auto-updated by agents)
    ├── status.md        # Current phase, blockers, recent work
    ├── decisions.md     # D1-D80 design decisions with rationale
    ├── pitfalls.md      # Known issues (currently empty)
    └── conventions.md   # Coding conventions (currently empty)
```

## WHERE TO LOOK

| Task                   | Location                      | Notes                        |
| ---------------------- | ----------------------------- | ---------------------------- |
| Design decision lookup | `memorys/decisions.md`        | D1-D80, searchable by number |
| Project status         | `memorys/status.md`           | Phase, blockers, recent work |
| Coding rules for TS    | `rules/typescript/`           | Extends common/ rules        |
| Security rules         | `rules/common/security.md`    | Mandatory pre-commit checks  |
| Test requirements      | `rules/common/testing.md`     | 80% coverage, E2E triggers   |
| Edit safety            | `rules/common/edit-safety.md` | Brace safety, verification   |
| Skill creation         | `skills/skill-creator/`       | Generate from SDD/interfaces |

## CONVENTIONS

- Rules in `rules/common/` apply to ALL languages
- Rules in `rules/{lang}/` extend common rules for that language
- `memorys/` files are auto-updated by agents during sessions
- Skills follow SKILL.md format with frontmatter + instructions
- Pitfalls use 5-part template: 症状/根因/解法/验证/禁止

## ANTI-PATTERNS

- DO NOT manually edit `memorys/` — agents update these automatically
- DO NOT duplicate rules across language dirs — use `common/` for shared rules
- DO NOT create skills without `skill-creator` or `writing-skills` skill
