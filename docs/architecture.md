# AccessBase 架构设计文档

> 本文档已拆分为独立模块，便于维护和阅读。

## 模块索引

| 模块 | 描述 |
|------|------|
| [overview.md](modules/overview.md) | §1-§7 概述/需求/参考/定义/功能/架构/迁移映射 |
| [tech-stack.md](modules/tech-stack.md) | §9 技术栈选型 |
| [core-packages.md](modules/core-packages.md) | §10 核心包详细设计 |
| [distributed.md](modules/distributed.md) | §11 分布式架构设计 |
| [auth-provider.md](modules/auth-provider.md) | §12 认证提供商架构 |
| [monitoring.md](modules/monitoring.md) | §13 监控与告警系统 |
| [ui.md](modules/ui.md) | §14 UI 设计 + §37 前端补充 P2 |
| [integration.md](modules/integration.md) | §15 集成架构 |
| [branding.md](modules/branding.md) | §16 品牌定制机制 |
| [infrastructure.md](modules/infrastructure.md) | §17 架构基础设施 |
| [concurrency.md](modules/concurrency.md) | §18 并发处理 |
| [security.md](modules/security.md) | §19 网络信息安全 + §25/§29/§36 安全加固 |
| [licensing.md](modules/licensing.md) | §20 授权许可证 |
| [error-handling.md](modules/error-handling.md) | §21 错误处理策略 |
| [database.md](modules/database.md) | §22 数据库 Schema 设计 |
| [api.md](modules/api.md) | §23 API 设计规范 |
| [frontend.md](modules/frontend.md) | §24 前端架构补充 |
| [cicd.md](modules/cicd.md) | §26 CI/CD 与部署 |
| [backup.md](modules/backup.md) | §27 备份与灾难恢复 |
| [secret-mgmt.md](modules/secret-mgmt.md) | §28 Secret 管理 |
| [testing.md](modules/testing.md) | §30 测试策略 |
| [ops.md](modules/ops.md) | §31 运维补充 P1 + §38 运维补充 P2 |
| [self-service.md](modules/self-service.md) | §32 用户自助服务 |
| [webhook.md](modules/webhook.md) | §33 Webhook 系统 |
| [notification.md](modules/notification.md) | §34 通知中心 |
| [i18n.md](modules/i18n.md) | §35 i18n 前端集成 |
| [compliance.md](modules/compliance.md) | §39 合规与数据隐私（GDPR） |
| [messaging.md](modules/messaging.md) | §40 邮件/短信服务 |
| [file-storage.md](modules/file-storage.md) | §41 文件存储管理 |
| [p3-supplement.md](modules/p3-supplement.md) | §42 P3 补充 |
| [changelog.md](modules/changelog.md) | §8 变更记录 |

## 设计决策汇总

共 80 个设计决策（D1-D80），详见各模块文档。
