/**
 * gate-mcp — MCP governance gate (plan Batch 4; RCH gate-mcp shape, pruned to
 * this repo: no Gerrit, no pixi-env servers — all servers are npm-launched).
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
  const src = JSON.parse(readFileSync(MCP_SOURCE, "utf8"));
  const servers = src.servers as Record<string, { enabled: boolean; kind: string }>;
  const pins = (JSON.parse(readFileSync(PIN_REGISTRY, "utf8")).servers ?? {}) as Record<
    string,
    { package: string; pin: string | null }
  >;
  let reported = 0;

  // 1. pin check
  for (const [name, s] of Object.entries(servers)) {
    const pin = pins[name];
    if (!pin || !pin.pin) continue; // remote / unpinned: nothing to check locally
    const ver = installedVersion(pin.package);
    if (s.enabled) {
      if (ver === null) findings.push(`pin: ${name} (${pin.package}) ENABLED but NOT INSTALLED — run: bash accessbase.sh mcp setup (or: pixi run mcp-setup)`);
      else if (ver !== pin.pin) findings.push(`pin: ${name} (${pin.package}) DRIFT: installed ${ver} != pin ${pin.pin} — fix: align the pin or reinstall`);
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

  // tool-routing.md must not contain a priority ladder (matrix, not priority)
  if (routingExists) {
    const routing = readFileSync(TOOL_ROUTING, "utf8");
    if (/prefer codegraph|always use codegraph|codegraph first/i.test(routing)) {
      findings.push("routing: tool-routing.md reads like a priority rule — host built-ins outrank us; keep it a DIVISION matrix (RCH D23)");
    }
  }

  if (findings.length) {
    console.log(`gate-mcp: ${findings.length} finding(s):`);
    for (const f of findings) console.log(`  ${f}`);
    console.log("  fix: the cause, not the gate (CONSTRAINTS.md)");
    return { code: EXIT_FINDINGS, summary: `gate-mcp: ${findings.length} finding(s)` };
  }
  const pinCount = Object.values(pins).filter((p) => p.pin && p.pin !== "latest-known").length;
  console.log(`gate-mcp: green (${pinCount} pins ok${reported ? `, ${reported} disabled server(s) reported-not-red` : ""}; latch-pair intact)`);
  return { code: EXIT_CLEAN, summary: "gate-mcp: green" };
}

if (import.meta.main) {
  const arg = process.argv[2] ?? "check";
  if (arg !== "check") { console.error("usage: gate-mcp.mts [check]"); process.exit(2); }
  process.exit(run("check").code);
}
