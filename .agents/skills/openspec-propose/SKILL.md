---
name: openspec-propose
description: >-
  Propose a new change for MSRCS with structured artifacts (proposal, design,
  tasks). Use when the user wants to quickly describe what they want to build
  and get a complete proposal ready for implementation.
license: MIT
compatibility: Designed for Claude Code, GitHub Copilot, and similar agents.
disable-model-invocation: false
metadata:
  author: openspec
  version: "1.0"
  category: workflow
  project: MSRCS
---

# OpenSpec Propose — MSRCS

Propose a new change for the MSRCS project. Generate structured artifacts that prepare the work for implementation.

When ready to implement, follow with `/openspec-apply`.

---

**Input**: The user's request should include a change name (kebab-case) OR a description of what they want to build in the MSRCS codebase.

---

## Steps

### 1. Understand what the user wants

If no clear input provided, ask what they want to build:

> "What change do you want to work on? Describe what you want to build or fix in MSRCS."

From their description, derive a kebab-case name (e.g., "add video feed panel" → `add-video-feed-panel`).

**Do NOT proceed without understanding what the user wants to build.**

### 2. Create the proposal directory

Create a structured proposal directory under `.sisyphus/plans/`:

```bash
mkdir -p .sisyphus/plans/<change-name>
```

This directory will hold the proposal artifacts.

### 3. Create proposal artifacts

Create the following artifacts in the proposal directory:

#### a. `proposal.md` — What & Why

Describe:
- **Problem**: What's the current limitation or bug? Reference existing code.
- **Goal**: What should be achieved?
- **Scope**: Which MSRCS packages are affected?
  - e.g., `src/ms_rcs_hmi/`, `src/ms_rcs_control/`, `CMakeLists.txt`
- **Out of scope**: What is deliberately NOT being changed?
- **Success criteria**: How will we know it's done?

#### b. `design.md` — How

Describe the solution architecture:
- **Approach**: High-level design decisions
- **C++/Qt/ROS2 specifics**:
  - New classes/functions needed
  - Qt signal/slot wiring
  - ROS2 topic/service interfaces
  - Thread safety considerations
- **Files to modify**: List specific files with brief notes
- **Dependencies**: Any new pixi/npm/ROS2 dependencies
- **Migration**: If changing existing code, what's the upgrade path?

#### c. `tasks.md` — Implementation steps

Break the work into atomic tasks:

```markdown
## Tasks

- [ ] Task 1: [brief description, file references]
- [ ] Task 2: [brief description, file references]
- [ ] Task 3: [brief description, file references]
```

Each task should be:
- Small enough to implement in one session
- Independently testable (build, lint, or unit test)
- Ordered by dependency (do task 1 before task 2)

### 4. Review and confirm

Show the user what was created:

```
## Proposal: <change-name>

**Artifacts created:**
- `.sisyphus/plans/<change-name>/proposal.md` — What & why
- `.sisyphus/plans/<change-name>/design.md` — How
- `.sisyphus/plans/<change-name>/tasks.md` — Tasks

**Tasks: N/M complete** — Ready for implementation!
```

Confirm with the user:
- Does the proposal capture their intent?
- Any adjustments needed to scope or design?

---

## MSRCS-Specific Guidelines

### Package references
When a change affects specific MSRCS packages, always reference the actual source path:

| Package | Path | Type |
|---------|------|------|
| HMI Window | `src/ms_rcs_hmi/ms_rcs_hmi_window/` | C++ Qt5/ROS2 |
| HMI WebView | `src/ms_rcs_hmi/ms_rcs_hmi_webview/` | C++ Qt5 WebEngine |
| Dashboard | `src/ms_rcs_hmi/ms_rcs_hmi_dashboard/` | C++ Qt5 |
| HMI Common | `src/ms_rcs_hmi/ms_rcs_hmi_common/` | C++ rosidl messages |
| Control Client | `src/ms_rcs_control/ms_rcs_control_client/` | Python ROS2 |
| Config Server | `src/ms_rcs_config/` | C++ + Python + React |
| Media | `src/ms_rcs_media/` | C++ (capture/receiver) |

### Build commands to reference

```bash
# Full build
./make.sh

# HMI-only build
./make.sh --packages ms_rcs_hmi_common ms_rcs_hmi_window ms_rcs_hmi_webview

# Debug build
./make.sh --debug

# Skip packaging (build only)
./make.sh --skip-pack --skip-archive
```

### C++ conventions to reference in design

- C++17 standard, RAII, smart pointers
- Qt5.15 (conda-forge, not system Qt)
- ROS2 Jazzy (rclcpp, ament_cmake)
- Multi-process HMI uses QWindow::fromWinId embedding
- Thread safety: Qt QueuedConnection, ROS2 spin + call_async
- Config via YAML + config_server FastAPI bridge

---

## Guardrails

- Create ALL artifacts needed for implementation
- Always reference actual MSRCS file paths and package names
- If context is critically unclear, ask the user — but prefer making reasonable decisions to keep momentum
- If a proposal with that name already exists, ask if user wants to continue it or create a new one
- Do NOT propose changes to `version.txt` — versioning is user-managed
- Do NOT propose changes to QExt or OpenCTK submodules — those are separate repositories
- Verify each artifact file exists after writing before proceeding
