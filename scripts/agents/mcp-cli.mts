#!/usr/bin/env node
/**
 * mcp-cli — MCP lifecycle CLI (plan Batch 4): setup | status | index | sync.
 * Pixi task `mcp` is a passthrough family (`pixi run mcp-setup` etc., VE D42).
 *
 *   setup — install every pinned package at its exact version; for
 *           local-playwright also download the bundled chromium browser
 *           (`playwright install chromium` — the wrapper launches with
 *           `--browser chromium`, never a system Chrome channel). CONTRACT
 *           (RA-1818-3): the init-*.mjs wrappers are NO LONGER unconditional
 *           self-healers — under MCP_NO_INSTALL=1 (exported by
 *           scripts/agents/mcp-launch.sh on the GUI face) they exit fatally
 *           instead of installing. THIS CLI is the sanctioned install path;
 *           the opencode face remains exempt (its own deferred card).
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

function registry(): Array<{ name: string; pkg: string; pin: string | null; enabled: boolean; kind?: string; pixiEnv?: string; probe?: string[] }> {
  const servers = (JSON.parse(readFileSync(MCP_SOURCE, "utf8")).servers ?? {}) as Record<string, { enabled: boolean }>;
  const pins = (JSON.parse(readFileSync(PIN_REGISTRY, "utf8")).servers ?? {}) as Record<string, { package: string; pin: string | null; kind?: string; pixiEnv?: string; probe?: string[] }>;
  return Object.entries(servers)
    .map(([name, s]) => ({ name, pkg: pins[name]?.package ?? "", pin: pins[name]?.pin ?? null, enabled: s.enabled, kind: pins[name]?.kind, pixiEnv: pins[name]?.pixiEnv, probe: pins[name]?.probe }))
    .filter((e) => e.pkg);
}

/** Pixi-kind version probe (serena plan D). */
function pixiVersion(env: string, probe: string[]): string | null {
  const bin = path.join(ROOT, ".pixi", "envs", env, "bin", probe[0]);
  if (!existsSync(bin)) return null;
  try {
    const raw = execSync(`"${bin}" ${probe.slice(1).join(" ")}`.trim(), { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    return raw.match(/\d+\.\d+\.\d+/)?.[0] ?? raw; // normalize "Serena 2.1.0-<sha>" -> "2.1.0"
  } catch {
    return null;
  }
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
      const ver = e.kind === "pixi" && e.pixiEnv && e.probe
        ? pixiVersion(e.pixiEnv, e.probe)
        : installedVersion(e.pkg);
      const state = ver === null
        ? (e.kind === "pixi" ? "missing-env" : "missing")
        : e.pin && e.pin !== "latest-known" && !(e.kind === "pixi" ? ver.startsWith(e.pin) : ver === e.pin) ? `DRIFT (installed ${ver}, pin ${e.pin})` : `ok (${ver ?? "unpinned"})`;
      console.log(`  ${e.name.padEnd(18)} ${e.enabled ? "on " : "off"}  ${state}`);
    }
    console.log("  (.codegraph index: " + (existsSync(path.join(ROOT, ".codegraph")) ? "present" : "absent — run: bash accessbase.sh mcp index (or: pixi run mcp-index)") + ")");
    return 0;
  }
  if (cmd === "setup") {
    for (const e of entries) {
      if (e.kind === "pixi" && e.pixiEnv) { sh(`pixi install -e ${e.pixiEnv}`); continue; }
      if (!e.pin || e.pin === "latest-known") { console.log(`  ${e.name}: no pin (${e.pin ?? "remote"}), skip`); continue; }
      sh(`pnpm add -wD ${e.pkg}@${e.pin}`);
      // local-playwright launches with --browser chromium + --executable-path
      // pointing at the REPO's bundled chromium (init-mcp-playwright.mjs): the
      // MCP never depends on a system Chrome install. The REPO's playwright is
      // the right installer here on purpose — @playwright/mcp's OWN playwright
      // (0.0.80 → 1.63-alpha) ships no ubuntu20.04 chromium build ("Playwright
      // does not support chromium on ubuntu20.04-x64"); the launcher therefore
      // binds the MCP to @playwright/test's chromium (protocol-compatible,
      // proven by scripts/agents/mcp-browser-probe.mjs).
      if (e.name === "local-playwright") sh("pnpm exec playwright install chromium");
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
    // serena project index (serena plan D): env absent -> report skip, NOT a failure
    const serenaBin = path.join(ROOT, ".pixi", "envs", "serena", "bin", "serena");
    if (existsSync(serenaBin)) {
      try { execSync(`"${serenaBin}" project index "${ROOT}"`, { cwd: ROOT, stdio: "inherit", timeout: 900_000 }); }
      catch (err) { console.error(`  serena index FAILED: ${(err as Error).message}`); return 1; }
    } else {
      console.log("  serena: env absent — skip indexing (pixi install -e serena to enable)");
    }
    return 0;
  }
  console.error("usage: mcp-cli.mts <setup | status | index | sync>");
  return 2;
}

process.exit(main());
