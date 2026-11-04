#!/usr/bin/env node
/**
 * mcp-cli — MCP lifecycle CLI (plan Batch 4): setup | status | index | sync.
 * Pixi task `mcp` is a passthrough family (`pixi run mcp-setup` etc., VE D42).
 *
 *   setup — install every pinned package at its exact version (the init-*.mjs
 *           wrappers remain the self-healing launchers; this is the explicit,
 *           reproducible path).
 *   status— read-only three-state report: ok / missing / DRIFT per server
 *           (disabled servers reported, never alarming). Always exit 0.
 *   index — first-time codegraph index build (init -y + full index).
 *   sync  — codegraph incremental sync (fast path; .codegraph is a per-machine
 *           gitignored index, never built in CI).
 */

import { execSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import * as path from "node:path";
import { ROOT } from "./agent-common.mts";

const MCP_SOURCE = path.join(ROOT, ".agents", "mcp.json");
const PIN_REGISTRY = path.join(ROOT, "scripts", "agents", "mcp-servers.json");

function registry(): Array<{ name: string; pkg: string; pin: string | null; enabled: boolean }> {
  const servers = (JSON.parse(readFileSync(MCP_SOURCE, "utf8")).servers ?? {}) as Record<string, { enabled: boolean }>;
  const pins = (JSON.parse(readFileSync(PIN_REGISTRY, "utf8")).servers ?? {}) as Record<string, { package: string; pin: string | null }>;
  return Object.entries(servers)
    .map(([name, s]) => ({ name, pkg: pins[name]?.package ?? "", pin: pins[name]?.pin ?? null, enabled: s.enabled }))
    .filter((e) => e.pkg);
}

function installedVersion(pkg: string): string | null {
  try {
    const req = createRequire(path.join(ROOT, "package.json"));
    return req(`${pkg}/package.json`).version as string;
  } catch {
    return null;
  }
}

function sh(cmd: string): void {
  console.log(`  $ ${cmd}`);
  execSync(cmd, { cwd: ROOT, stdio: "inherit" });
}

function main(): number {
  const cmd = process.argv[2] ?? "status";
  const entries = registry();

  if (cmd === "status") {
    for (const e of entries) {
      const ver = installedVersion(e.pkg);
      const state = ver === null ? "missing" : e.pin && e.pin !== "latest-known" && ver !== e.pin ? `DRIFT (installed ${ver}, pin ${e.pin})` : `ok (${ver ?? "unpinned"})`;
      console.log(`  ${e.name.padEnd(18)} ${e.enabled ? "on " : "off"}  ${state}`);
    }
    console.log("  (.codegraph index: " + (existsSync(path.join(ROOT, ".codegraph")) ? "present" : "absent — run: bash accessbase.sh mcp index (or: pixi run mcp-index)") + ")");
    return 0;
  }
  if (cmd === "setup") {
    for (const e of entries) {
      if (!e.pin || e.pin === "latest-known") { console.log(`  ${e.name}: no pin (${e.pin ?? "remote"}), skip`); continue; }
      sh(`pnpm add -wD ${e.pkg}@${e.pin}`);
    }
    return 0;
  }
  if (cmd === "index" || cmd === "sync") {
    if (cmd === "index") {
      sh("pnpm exec codegraph init -y || true");
      sh("pnpm exec codegraph index");
    } else {
      sh("pnpm exec codegraph sync");
    }
    return 0;
  }
  console.error("usage: mcp-cli.mts <setup | status | index | sync>");
  return 2;
}

process.exit(main());
