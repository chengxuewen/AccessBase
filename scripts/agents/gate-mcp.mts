/**
 * gate-mcp — MCP governance gate (plan Batch 4; RCH gate-mcp shape. 2026-11-18
 * serena plan D: pixi-kind servers supported — the Batch-4 "npm-only" pruning
 * is reversed by an explicit ruling, recorded in D127).
 *
 * Checks:
 *   1. Pin check — every ENABLED npm server: installed version == pin. Missing
 *      package or version drift = RED. DISABLED servers: state REPORTED only,
 *      never red (a disabled server not being installed is fine). Missing
 *      credentials = yellow-skip, not red (VE review #19 CI-false-red lesson —
 *      this repo's enabled servers need no tokens, the rule stays for future
 *      remote servers).
 *   2. Shape check — root .mcp.json: `command` must be a STRING (arrays crash
 *      the CodeBuddy panel), `args` an array of strings, no plaintext secrets
 *      (env values must use ${VAR} interpolation form).
 *   3. Latch-pair rule lock (RCH D23) — `local-codegraph` declared in the
 *      single source ⇔ `rules/common/tool-routing.md` exists. Removing either
 *      requires removing both in the same change.
 *
 * Red/green duty: each check carries a one-line self-test note in its header;
 * the batch execution log records the planted-violation demos.
 */

import { readFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { createRequire } from "node:module";
import * as path from "node:path";
import { ROOT, EXIT_CLEAN, EXIT_FINDINGS } from "./agent-common.mts";
import { readBrowserRecord, pinChromiumExecutable } from "./mcp-cli.mts";

const MCP_SOURCE = path.join(ROOT, ".agents", "mcp.json");
const PIN_REGISTRY = path.join(ROOT, "scripts", "agents", "mcp-servers.json");
const ROOT_MCP = path.join(ROOT, ".mcp.json");
const TOOL_ROUTING = path.join(ROOT, ".agents", "rules", "common", "tool-routing.md");

function installedVersion(pkg: string): string | null {
  try {
    const req = createRequire(path.join(ROOT, "package.json"));
    return req(`${pkg}/package.json`).version as string;
  } catch {
    return null;
  }
}

export function run(_mode: "check" | "sync"): { code: number; summary: string } {
  const findings: string[] = [];
  const notes: string[] = [];
  const src = JSON.parse(readFileSync(MCP_SOURCE, "utf8"));
  const servers = src.servers as Record<string, { enabled: boolean; kind: string }>;
  const pins = (JSON.parse(readFileSync(PIN_REGISTRY, "utf8")).servers ?? {}) as Record<
    string,
    { package: string; pin: string | null; kind?: string; pixiEnv?: string; probe?: string[] }
  >;
  let reported = 0;

  /** Pixi-kind version probe: run .pixi/envs/<env>/bin/<probe[0]> --version.
   *  (2026-11-18 serena plan D; RCH SKIP-ENV semantics live in the caller.) */
  function pixiInstalledVersion(env: string, probe: string[]): string | null {
    const bin = path.join(ROOT, ".pixi", "envs", env, "bin", probe[0]);
    if (!existsSync(bin)) return null;
    try {
      const raw = execSync(`"${bin}" ${probe.slice(1).join(" ")}`.trim(), {
        cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
      }).trim();
      return raw.match(/\d+\.\d+\.\d+/)?.[0] ?? raw; // "Serena 2.1.0-<sha>" -> "2.1.0"
    } catch {
      return null;
    }
  }

  // 1. pin check (npm via node-require; pixi via env-bin probe — serena plan D)
  for (const [name, s] of Object.entries(servers)) {
    const pin = pins[name];
    if (!pin || !pin.pin) continue; // remote / unpinned: nothing to check locally
    const ver = pin.kind === "pixi" && pin.pixiEnv && pin.probe
      ? pixiInstalledVersion(pin.pixiEnv, pin.probe)
      : installedVersion(pin.package);
    // pixi probes print upstream build-suffixed versions ("2.1.0-a2f21a6f-dirty");
    // the PIN names the release, so pixi kinds compare by prefix, npm kinds exactly.
    const matches = (v: string) => (pin.kind === "pixi" ? v.startsWith(pin.pin) : v === pin.pin);
    if (s.enabled) {
      if (ver === null) findings.push(`pin: ${name} (${pin.package}) ENABLED but NOT ${pin.kind === "pixi" ? "INSTALLED (env missing)" : "INSTALLED"} — run: ${pin.kind === "pixi" ? `pixi install -e ${pin.pixiEnv}` : "bash accessbase.sh mcp setup (or: pixi run mcp-setup)"}`);
      else if (!matches(ver)) findings.push(`pin: ${name} (${pin.package}) DRIFT: installed ${ver} != pin ${pin.pin} — fix: align the pin or reinstall`);
    } else if (ver === null) {
      reported++; // disabled + absent: fine
    }
  }

  // 2. shape check on the CodeBuddy face
  if (existsSync(ROOT_MCP)) {
    const mcp = JSON.parse(readFileSync(ROOT_MCP, "utf8"));
    for (const [name, raw] of Object.entries((mcp.mcpServers ?? {}) as Record<string, { command?: unknown; args?: unknown; env?: Record<string, string> }>)) {
      if (typeof raw.command !== "string") findings.push(`shape: .mcp.json ${name}.command must be a STRING (arrays crash the CodeBuddy panel)`);
      if (raw.args !== undefined && (!Array.isArray(raw.args) || raw.args.some((a) => typeof a !== "string"))) findings.push(`shape: .mcp.json ${name}.args must be a string array`);
      for (const [k, v] of Object.entries(raw.env ?? {})) {
        if (!/^\$\{[A-Z_]+\}$/.test(v)) findings.push(`shape: .mcp.json ${name}.env.${k} must use the \${VAR} form, not a literal (plaintext secrets banned)`);
      }
    }
  }

  // 3. latch-pair: codegraph declared <=> tool-routing.md exists
  const declaresCodegraph = "local-codegraph" in servers;
  const routingExists = existsSync(TOOL_ROUTING);
  if (declaresCodegraph !== routingExists) {
    findings.push(
      declaresCodegraph
        ? "latch-pair: local-codegraph is declared but rules/common/tool-routing.md is MISSING — declare the routing matrix or drop the server, in the SAME change (RCH D23)"
        : "latch-pair: rules/common/tool-routing.md exists but local-codegraph is not declared — same-change pairing required (RCH D23)",
    );
  }

  // 4. dependency-drift lock (PIT-090): watch the MCP ecosystem's transitive
  //    keys in pnpm-lock.yaml. A self-healing install fired by a host-launched
  //    server re-resolves these silently. RED unless explicitly acknowledged:
  //    AB_ALLOW_MCP_DEP_DRIFT=1 is the one-shot, informed-basis override (state
  //    the reason in the commit message and re-verify `bash accessbase.sh ci`).
  //    (Design note: pairing with single-source-dirty checks does not work in
  //    a real working tree — the watched-key diff is the only unambiguous
  //    signal; the env override is the auditable exit.)
  try {
    const lockDiff = execSync("git diff HEAD -- pnpm-lock.yaml || git diff -- pnpm-lock.yaml", {
      cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
    });
    const WATCHED = ["@modelcontextprotocol/sdk"];
    const acknowledged = process.env.AB_ALLOW_MCP_DEP_DRIFT === "1";
    for (const key of WATCHED) {
      const esc = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (new RegExp(`^[+-].*${esc}@\\d`, "m").test(lockDiff)) {
        if (acknowledged) {
          console.log(`  dep-drift: ${key} lock lines changed — ACKNOWLEDGED via AB_ALLOW_MCP_DEP_DRIFT=1 (state the reason in the commit; re-verify ci)`);
        } else {
          findings.push(
            `dep-drift: ${key} version lines changed in pnpm-lock.yaml — a self-healing install may have fired (PIT-090). Fix: roll back, or set AB_ALLOW_MCP_DEP_DRIFT=1 for an informed one-shot pass + state the reason in the commit and re-verify \`bash accessbase.sh ci\``,
          );
        }
      }
    }
  } catch {
    // git unavailable or not a repo context (e.g. exported tree): skip, not red
  }

  // tool-routing.md must not contain a priority ladder (matrix, not priority)
  if (routingExists) {
    const routing = readFileSync(TOOL_ROUTING, "utf8");
    if (/prefer codegraph|always use codegraph|codegraph first/i.test(routing)) {
      findings.push("routing: tool-routing.md reads like a priority rule — host built-ins outrank us; keep it a DIVISION matrix (RCH D23)");
    }
  }

  // 4. Browser resolution leg (2026-11-25, D136) — READ-ONLY: reads the record
  //    and stats the pin's managed build path. NEVER downloads or launches a
  //    browser (that is `mcp setup`'s job; a probe here would false-red CI).
  {
    const rec = readBrowserRecord();
    const lp = rec?.resolutions["local-playwright"];
    const pkg = pins["local-playwright"]?.package;
    const pkgDir = (() => {
      try {
        return path.dirname(createRequire(path.join(ROOT, "package.json")).resolve(`${pkg}/package.json`));
      } catch {
        return null;
      }
    })();
    const managed = pkgDir ? pinChromiumExecutable(pkgDir) : null;
    const managedPresent = Boolean(managed && existsSync(managed));
    if (!lp) {
      // yellow-skip semantics (same convention as missing credentials):
      // a record-less but INSTALLABLE host is reported, not alarmed.
      if (managedPresent) {
        notes.push("browser: managed build present, no record — run: bash accessbase.sh mcp setup");
      } else {
        findings.push("browser: local-playwright UNRESOLVED (no record, no managed build) — run: bash accessbase.sh mcp setup");
      }
    } else if (lp.mode === "playwright") {
      if (!managedPresent) {
        findings.push("browser: record says playwright but the managed build is MISSING — run: bash accessbase.sh mcp setup");
      }
    } else if (lp.mode === "system") {
      if (!lp.executable || !path.isAbsolute(lp.executable) || !existsSync(lp.executable)) {
        findings.push("browser: system record points at a missing binary — rerun: bash accessbase.sh mcp setup");
      }
    } else {
      findings.push(`browser: local-playwright mode '${lp.mode}' is UNRESOLVED — run: bash accessbase.sh mcp setup`);
    }
  }

  if (findings.length) {
    console.log(`gate-mcp: ${findings.length} finding(s):`);
    for (const f of findings) console.log(`  ${f}`);
    console.log("  fix: the cause, not the gate (CONSTRAINTS.md)");
    return { code: EXIT_FINDINGS, summary: `gate-mcp: ${findings.length} finding(s)` };
  }
  for (const n of notes) console.log(`  note: ${n}`);
  const pinCount = Object.values(pins).filter((p) => p.pin && p.pin !== "latest-known").length;
  console.log(`gate-mcp: green (${pinCount} pins ok${reported ? `, ${reported} disabled server(s) reported-not-red` : ""}; latch-pair intact)`);
  return { code: EXIT_CLEAN, summary: "gate-mcp: green" };
}

if (import.meta.main) {
  const arg = process.argv[2] ?? "check";
  if (arg !== "check") { console.error("usage: gate-mcp.mts [check]"); process.exit(2); }
  process.exit(run("check").code);
}
