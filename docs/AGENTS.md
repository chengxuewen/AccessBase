# docs/ — Design Documentation

## OVERVIEW

AccessBase architecture design documentation. 42 chapters covering IAM system design, split into 31 modular files.

## STRUCTURE

```
docs/
├── architecture.md      # Stub index (links to modules/)
└── modules/             # 31 modular design documents
    ├── overview.md      # §1-§7 概述/需求/定义/架构 (217 lines)
    ├── tech-stack.md    # §9 技术栈选型
    ├── core-packages.md # §10 核心包详细设计 (382 lines)
    ├── distributed.md   # §11 分布式架构
    ├── auth-provider.md # §12 认证提供商架构
    ├── monitoring.md    # §13 监控与告警
    ├── ui.md            # §14+§37 UI设计 (2678 lines, largest)
    ├── security.md      # §19+§25+§29+§36 安全全量 (1035 lines)
    ├── database.md      # §22 Schema设计
    ├── api.md           # §23 API规范
    ├── testing.md       # §30 测试策略
    └── ...              # 20 more modules
```

## WHERE TO LOOK

| Task           | File               | Key Content                                 |
| -------------- | ------------------ | ------------------------------------------- |
| Start here     | `overview.md`      | System overview, requirements, architecture |
| Tech choices   | `tech-stack.md`    | Fastify, Drizzle, React, AntD decisions     |
| Package design | `core-packages.md` | 8 L0 packages (@accessbase/*)               |
| Auth flow      | `auth-provider.md` | OAuth, WebAuthn, LDAP, MFA                  |
| DB schema      | `database.md`      | Core tables, indexes, migrations            |
| API contracts  | `api.md`           | RESTful conventions, endpoints              |
| UI components  | `ui.md`            | Layout, navigation, pages, forms            |
| Security       | `security.md`      | OWASP, encryption, CSRF, XSS                |
| Deployment     | `cicd.md`          | Docker, K8s, CI/CD pipeline                 |

## CONVENTIONS

- Each module has header: `> 本文档从 architecture.md 拆分而来`
- Each module has back-link to `../architecture.md` stub
- P0-P3 supplements merged into parent topics (UI, security, ops)
- Design decisions referenced as D1-D80 in `.agents/memorys/decisions.md`

## NOTES

- `ui.md` is largest module (2678 lines) — may need further splitting
- `security.md` merges 4 sections (§19+§25+§29+§36)
- `changelog.md` contains §8 变更记录
- Module numbering follows original architecture.md section numbers
