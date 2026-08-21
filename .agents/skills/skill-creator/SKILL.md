---
name: skill-creator
description: >-
  Generate AccessBase project skills from SDD docs (docs/modules/*-sdd.md),
  TypeScript interfaces (packages/*/src/*.ts), or manifest.yaml schemas.
  Use when the user wants to create a new AI-assisted workflow skill for
  testing, spec execution, API verification, or build validation.
license: MIT
metadata:
  author: AccessBase
  version: "1.0"
  project: AccessBase
---

Create AccessBase project-specific AI skills from project artifacts.

**Input**: One of three input sources:
- `docs/modules/<module>-sdd.md` (SDD spec with interface definitions) -> spec execution skill
- `packages/<package>/src/*.ts` (TypeScript interface/type definitions) -> API contract testing skill
- `packages/<package>/manifest.yaml` (plugin manifest schema) -> manifest validation skill

Also accepts a natural-language description: "generate a testing skill for the RBAC module."

**Steps**

1. **Identify input type**

   Determine the input source:
   - `*-sdd.md` file in `docs/modules/` with interface definitions and lifecycle hooks -> **SDD spec mode**
   - `*.ts` file in `packages/*/src/` containing `export interface` / `export type` / `export function` -> **TypeScript API mode**
   - `manifest.yaml` file in `packages/*/` with plugin metadata fields -> **Manifest validation mode**
   - Natural-language phrase -> ask user which mode, default to **SDD spec mode** if ambiguous

   If no input provided: "What should the skill be based on? (SDD doc / TypeScript interface / manifest.yaml)"

2. **Read the source**

   - **SDD spec mode**: Read the `-sdd.md` file. Extract all interface definitions (type signatures, params, return types), lifecycle hooks (afterAdd/beforeLoad/load/install/afterEnable/afterDisable/preUninstall), error codes, mock constraints, and security considerations. Cross-reference the corresponding `-tdd.md` if it exists.
   - **TypeScript API mode**: Read the `.ts` file. Extract all `export interface`, `export type`, `export function` definitions, JSDoc comments, and Zod schemas. Identify boundary-layer functions (API entry points) vs internal utilities.
   - **Manifest validation mode**: Read the `manifest.yaml`. Extract metadata fields (name/version/display_name/category), runtime config (mode/partition/crash_policy), security config (db_namespace), exports declarations, permissions, models, and lifecycle hooks.

3. **Derive skill name and purpose**

   - SDD spec -> name: `<module>-sdd-exec` (e.g., `rbac-sdd-exec`), purpose: "Implement and verify tests for <module> SDD interface contracts"
   - TypeScript API -> name: `<package>-api-test` (e.g., `plugin-framework-api-test`), purpose: "Generate contract tests for <package> exported interfaces"
   - Manifest validation -> name: `<package>-manifest-verify` (e.g., `plugin-core-manifest-verify`), purpose: "Validate <package> manifest.yaml against D1.5 schema"

4. **Generate skill content**

   Follow this structure:

   ```yaml
   ---
   name: <derived-name>
   description: <one-line purpose>
   license: MIT
   metadata:
     author: AccessBase
     version: "1.0"
     generatedFrom: <source file path>
     category: <workflow | testing | verification>
   ---
   ```

   Body sections:
   - One-line invocation description
   - `**Input**`: what this skill expects
   - `**Steps**`: numbered step-by-step instructions
   - `**Output**`: expected output format
   - `**Guardrails**`: constraints the AI must follow

   **Mode-specific content**:

   **SDD spec mode**:
   - Steps: (1) read the `-sdd.md` file and cross-reference `-tdd.md` if available, (2) parse each interface definition and lifecycle hook signature, (3) for each interface method, generate one `test()` stub: success path + error path + boundary, (4) use AAA pattern (Arrange/Act/Assert) with comments marking sections, (5) apply mock constraints from SDD (async Promise, JSON serialization, 30s timeout, 1-5ms delay for ProcessPluginHost), (6) write test file to `packages/<module>/tests/<module>.test.ts`, (7) run `npx vitest run packages/<module>/tests/`
   - Guardrails: every exported interface method ≥1 test, AAA pattern mandatory, ProcessPluginHost mock must satisfy 5 constraints (D1.2), Zod schema validation at boundaries (D8), test naming: `test('{scenario description}')` descriptive, 80% coverage minimum

   **TypeScript API mode**:
   - Steps: (1) read the `.ts` file and extract all exports, (2) for each exported function, generate contract test: valid input + invalid input + edge case, (3) for Zod schemas, generate parse/safeParse tests with valid/invalid payloads, (4) for exported interfaces, generate type-level tests (if applicable) or runtime validation tests, (5) write to `packages/<package>/tests/<file>.contract.test.ts`, (6) run `npx vitest run packages/<package>/tests/`
   - Guardrails: every exported function ≥1 test, Zod boundary validation tested (D8), no `as any` or `@ts-ignore` (G3), immutability patterns verified (G1), test file naming: `*.contract.test.ts`

   **Manifest validation mode**:
   - Steps: (1) read `manifest.yaml` and parse all fields, (2) validate required fields per D1.5 (name/version/display_name/description/category/entry), (3) validate runtime config (mode: inline|process|container, partition: SYSTEM|oa|erp|mes|isolated), (4) validate exports declarations (api_version per D1.8), (5) validate permissions and record_rules per D10 (domain filter syntax), (6) validate lifecycle hooks per D1.4 (7 hooks), (7) check dependencies exist in package registry, (8) write validation report
   - Guardrails: all D1.5 required fields present, runtime.mode and runtime.partition valid enum values, exports.api_version follows SemVer, record_rules use valid Poland notation operators (&|!=><=<=in not in like ilike)

5. **Write the SKILL.md file**

   Write to `.agents/skills/<derived-name>/SKILL.md`. Directory name must match `name` field.
   If skill already exists, ask: overwrite or create variant.

**Output**

After generating:
- Skill name and path
- Source used (file + type)
- Count of interfaces / functions / manifest fields covered
- "Skill ready. Invoke with `skill(name=\"<derived-name>\")` or ask me to use it."

**Examples**

### Example 1: SDD spec -> execution skill

```
User: "Create a testing skill from docs/modules/rbac-sdd.md"
-> Reads rbac-sdd.md, finds PermissionChecker interface: check(userId, resource, action) -> boolean
-> Cross-references rbac-tdd.md for existing test plan
-> Creates .agents/skills/rbac-sdd-exec/SKILL.md
-> Skill generates vitest test stubs with AAA pattern for each interface method
-> Mock constraints: tenant_id injection (D10), Zod validation (D8)
```

### Example 2: TypeScript API -> contract testing skill

```
User: "Generate a contract testing skill for packages/plugin-framework/src/plugin-manager.ts"
-> Reads plugin-manager.ts, finds: PluginManager class with load/unload/enable/disable methods
-> Extracts exported interfaces: PluginHost, PluginContext, PluginMeta
-> Creates .agents/skills/plugin-framework-api-test/SKILL.md
-> Skill guides: generate contract tests per method -> run vitest -> verify 80% coverage
```

### Example 3: Manifest -> validation skill

```
User: "Create a manifest verification skill for plugins/plugin-core"
-> Reads plugins/plugin-core/manifest.yaml
-> Extracts: name, version, dependencies, runtime.mode, runtime.partition, exports
-> Creates .agents/skills/plugin-core-manifest-verify/SKILL.md
-> Skill validates: D1.5 required fields, runtime enums, exports.api_version SemVer, D10 record_rules syntax
```

**Guardrails**
- NEVER generate a skill without first reading the source file
- NEVER contradict existing SDD/TDD docs in docs/modules/
- YAML frontmatter must include: `name`, `description`, `metadata.author`, `metadata.version`
- Skill directory name must match `name` field exactly
- If skill with same name exists, ask before overwriting
- Use AccessBase conventions only: `@audebase/` scope, AAA test pattern, Vitest + Testing Library, Zod for boundary validation
- Keep skills under 200 lines - short skills are easier to maintain
- No external CLI dependencies beyond project toolchain (vitest, turborepo, drizzle-kit)
- Respect Phase awareness: Phase 1a = inline mode only, Phase 2 = process mode, Phase 4 = container mode

// ponytail: 3 input modes cover all AccessBase artifact types - no need for more
