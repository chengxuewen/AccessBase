---
paths:
  - '**/*.kt'
  - '**/*.kts'
  - '**/build.gradle.kts'
---

# Kotlin Hooks

> This file extends [common/hooks.md](../common/hooks.md) with Kotlin-specific content.

## PostToolUse Hooks

Configure in the host agent's settings (per-hook PostToolUse config):

- **ktfmt/ktlint**: Auto-format `.kt` and `.kts` files after edit
- **detekt**: Run static analysis after editing Kotlin files
- **./gradlew build**: Verify compilation after changes
