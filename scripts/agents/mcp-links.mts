/**
 * mcp-links — MCP generation layer (plan Batch 4).
 *
 * Single source: .agents/mcp.json (+ optional gitignored .agents/mcp.local.json
 * overlay, local wins, ${VAR} injection only). Two consumer faces:
 *
 *   1. `.opencode/opencode.json` — the `mcp{}` region is a FULL REWRITE
 *      (ADJ-3c/ADJ-4c; RCH D20: additive merge cannot reclaim removed servers
 *      and its own validator inherits the blindness — orphans stay green
 *      forever). Register first, then rewrite. All other keys (instructions,
 *      model, plugins) stay handwritten — only `mcp` is generated.
 *      Disabled servers stay registered (enabled:false) so they are never
 *      orphaned.
 *   2. root `.mcp.json` — CodeBuddy consumer (ADJ-4c ruling A: full dual-host),
 *      mcpServers shape, ONLY enabled servers, `command` is a STRING (arrays
 *      crash the CodeBuddy panel JS), args wrap scripts/agents/mcp-launch.sh
 *      (PATH/cwd guard for GUI hosts, RCH PIT-86).
 *
 * check: structural comparison (parse + deep-compare the mcp face) — byte
 * comparison would false-red on host-side reformatting (VE D50 R1 lesson).
 * sync: write both faces (idempotent).
 */

import { readFileSync, existsSync } from "node:fs";
import * as path from "node:path";
import { ROOT, EXIT_CLEAN, EXIT_FINDINGS, writeIfChanged, relRoot } from "./agent-common.mts";

const MCP_SOURCE = path.join(ROOT, ".agents", "mcp.json");
const MCP_LOCAL = path.join(ROOT, ".agents", "mcp.local.json");
const OPENCODE = path.join(ROOT, ".opencode", "opencode.json");
const ROOT_MCP = path.join(ROOT, ".mcp.json");

interface ServerDef {
  enabled: boolean;
  kind: "npm" | "remote";
  launcher?: string;
  command?: string[];
  env?: Record<string, string>;
  note?: string;
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));
  function sortKeys(x: unknown): unknown {
    if (Array.isArray(x)) return x.map(sortKeys);
    if (x && typeof x === "object") {
      return Object.fromEntries(
        Object.entries(x as Record<string, unknown>).sort(([k1], [k2]) => k1.localeCompare(k2)).map(([k, v]) => [k, sortKeys(v)]),
      );
    }
    return x;
  }
}

function loadSource(): Record<string, ServerDef> {
  const src = JSON.parse(readFileSync(MCP_SOURCE, "utf8"));
  const servers = (src.servers ?? {}) as Record<string, ServerDef>;
  if (existsSync(MCP_LOCAL)) {
    const overlay = JSON.parse(readFileSync(MCP_LOCAL, "utf8")) as Record<string, Partial<ServerDef>>;
    for (const [name, patch] of Object.entries(overlay)) {
      servers[name] = { ...(servers[name] ?? { enabled: false, kind: "npm" }), ...patch } as ServerDef;
    }
  }
  return servers;
}

/** opencode face: named shape, array command, disabled servers stay registered. */
function wantOpencode(servers: Record<string, ServerDef>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, s] of Object.entries(servers)) {
    if (s.kind === "remote") {
      out[name] = { type: "remote", enabled: s.enabled, command: s.command, env: s.env };
    } else {
      out[name] = {
        type: "local",
        enabled: s.enabled,
        command: ["pixi", "run", "node", s.launcher],
      };
    }
  }
  return out;
}

/** CodeBuddy face: mcpServers shape, enabled only, string command via launcher. */
function wantRootMcp(servers: Record<string, ServerDef>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, s] of Object.entries(servers)) {
    if (!s.enabled) continue;
    if (s.kind === "remote") {
      out[name] = { command: "npx", args: s.command?.slice(1) ?? [], env: s.env };
    } else {
      out[name] = {
        command: "bash",
        args: ["scripts/agents/mcp-launch.sh", s.launcher],
      };
    }
  }
  return { mcpServers: out };
}

export function run(mode: "check" | "sync"): { code: number; summary: string } {
  const servers = loadSource();
  const findings: string[] = [];

  // face 1: opencode.json mcp{} full rewrite
  const doc = JSON.parse(readFileSync(OPENCODE, "utf8")) as Record<string, unknown>;
  const want1 = wantOpencode(servers);
  if (mode === "sync") {
    doc.mcp = want1;
    writeIfChanged(OPENCODE, JSON.stringify(doc, null, 2) + "\n");
  } else if (!deepEqual(doc.mcp, want1)) {
    findings.push(`${relRoot(OPENCODE)} mcp{} region drifted (or an unregistered server squats it — RCH D20: register first, then rewrite)`);
  }

  // face 2: root .mcp.json
  const want2 = wantRootMcp(servers);
  const next2 = JSON.stringify(want2, null, 2) + "\n";
  if (mode === "sync") {
    writeIfChanged(ROOT_MCP, next2);
  } else {
    const prev2 = existsSync(ROOT_MCP) ? readFileSync(ROOT_MCP, "utf8") : null;
    if (prev2 !== next2) findings.push(`${relRoot(ROOT_MCP)} ${prev2 === null ? "missing (sync generates it)" : "drifted"}`);
  }

  if (mode === "sync") {
    return { code: EXIT_CLEAN, summary: `mcp-links: 2 faces written (${Object.keys(servers).length} servers registered, ${Object.values(servers).filter((s) => s.enabled).length} enabled)` };
  }
  if (findings.length) {
    console.log(`mcp-links: ${findings.length} finding(s):`);
    for (const f of findings) console.log(`  ${f}`);
    console.log("  fix: node scripts/agents/agent-links.mts sync");
    return { code: EXIT_FINDINGS, summary: `mcp-links: ${findings.length} finding(s)` };
  }
  return { code: EXIT_CLEAN, summary: "mcp-links: clean (2 faces)" };
}
