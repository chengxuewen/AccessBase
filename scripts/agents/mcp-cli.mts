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
import { readFileSync, existsSync, mkdirSync, writeFileSync, renameSync, realpathSync } from "node:fs";
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


// ---- Browser resolution (2026-11-25) -----------------------------------
// Mission: `local-playwright` must launch on this host without any hand-installed
// Chrome. Measured ground truth (D136 record):
//  - the pin's playwright REFUSES its managed browser on ubuntu20.04
//    ("Playwright does not support chromium on ubuntu20.04-x64");
//  - `@playwright/mcp/cli.js install-browser chromium` WITH
//    PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=ubuntu22.04-x64 downloads the SAME
//    pin-exact build (chromium-1243 / 153.0.8010.12) into the standard cache
//    and IT RUNS (full MCP browser_navigate verified);
//  - CLI flags outrank envs (`cliOptions.x ?? env`) — so browser selection
//    lives in the RECORD + launcher envs, never in the spec args.
const RECORD_PATH = path.join(ROOT, "out", "mcp-browser.json");
const RECORD_VERSION = 1;

interface BrowserResolution {
  /** playwright = the pin's own managed build (version-guaranteed);
   *  system = a live on-PATH browser (drifts; NOTE printed);
   *  none   = unresolved (WARN, fatal under MCP_BROWSER_STRICT=1). */
  mode: "playwright" | "system" | "none";
  browser: string;
  version: string | null;
  /** absolute executable (system mode only — playwright mode is env-selected) */
  executable: string | null;
}
interface BrowserRecord {
  record_version: number;
  resolutions: Record<string, BrowserResolution>;
}

export function readBrowserRecord(): BrowserRecord | null {
  try {
    const rec = JSON.parse(readFileSync(RECORD_PATH, "utf8")) as BrowserRecord;
    return rec && rec.record_version === RECORD_VERSION ? rec : null;
  } catch {
    return null;
  }
}

function writeBrowserRecord(server: string, res: BrowserResolution): void {
  const rec: BrowserRecord =
    readBrowserRecord() ?? { record_version: RECORD_VERSION, resolutions: {} };
  rec.resolutions[server] = res;
  mkdirSync(path.dirname(RECORD_PATH), { recursive: true });
  const tmp = `${RECORD_PATH}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(rec, null, 2) + "\n");
  renameSync(tmp, RECORD_PATH); // atomic (never half-written)
}

function mcpPkgDir(pkg: string): string | null {
  try {
    return path.dirname(createRequire(path.join(ROOT, "package.json")).resolve(`${pkg}/package.json`));
  } catch {
    return null;
  }
}

/** The pin's OWN managed chromium build path (read-only; never launches/downloads). */
export function pinChromiumExecutable(pkgDir: string): string | null {
  try {
    const req = createRequire(path.join(pkgDir, "package.json"));
    return req("playwright").chromium.executablePath() as string;
  } catch {
    return null;
  }
}

function pinBrowserVersion(pkgDir: string): string | null {
  try {
    // playwright-core's "exports" map does NOT expose browsers.json to
    // require.resolve — read it from the resolved package DIRECTORY instead.
    const req = createRequire(path.join(pkgDir, "package.json"));
    const coreDir = path.dirname(req.resolve("playwright-core/package.json"));
    const meta = JSON.parse(readFileSync(path.join(coreDir, "browsers.json"), "utf8")) as {
      browsers: Array<{ name: string; browserVersion?: string }>;
    };
    return meta.browsers.find((b) => b.name === "chromium")?.browserVersion ?? null;
  } catch {
    return null;
  }
}

function which(cmd: string): string | null {
  if (cmd.includes(path.sep)) return existsSync(cmd) ? cmd : null;
  const suffixes = process.platform === "win32" ? [".exe", ".cmd", ""] : [""];
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of suffixes) {
      const p = path.join(dir, cmd + ext);
      if (existsSync(p)) return p;
    }
  }
  return null;
}

/** Three-rung ladder. rung1 = pin-exact managed build (platform override for
 *  dropped hosts); rung2 = live system browser proved by --version (realpath
 *  only; drift NOTE printed); rung3 = WARN (MCP_BROWSER_STRICT=1 -> fatal). */
export function resolvePlaywrightBrowser(
  server: string,
  pkg: string,
  family: string,
): BrowserResolution {
  const pkgDir = mcpPkgDir(pkg);
  if (!pkgDir) {
    throw new Error(`${pkg} is not installed — package install must run FIRST (a clean clone has no cli.js)`);
  }
  const cli = path.join(pkgDir, "cli.js");
  const override =
    process.env.MCP_BROWSER_PLATFORM_OVERRIDE ??
    (process.platform === "linux" ? "ubuntu22.04-x64" : undefined);
  // rung 1 — the pin's own installer + CDN (no hand-fetched artifact)
  try {
    console.log(
      `  $ node ${path.relative(ROOT, cli)} install-browser ${family}${override ? ` (platform override: ${override})` : ""}`,
    );
    execSync(`node "${cli}" install-browser ${family}`, {
      cwd: ROOT,
      stdio: "inherit",
      timeout: 900_000,
      env: { ...process.env, ...(override ? { PLAYWRIGHT_HOST_PLATFORM_OVERRIDE: override } : {}) },
    });
    const exe = pinChromiumExecutable(pkgDir);
    if (exe && existsSync(exe)) {
      return { mode: "playwright", browser: family, version: pinBrowserVersion(pkgDir), executable: null };
    }
    console.warn(`  [browser] rung1: installer ran but the managed build is absent (${exe ?? "no path"})`);
  } catch (e) {
    console.warn(`  [browser] rung1 failed: ${String((e as Error).message).split("\n")[0]}`);
  }
  // rung 2 — a live system browser, PROVED by --version
  for (const name of ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"]) {
    const p = which(name);
    if (!p) continue;
    try {
      const raw = execSync(`"${p}" --version`, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
      const version = raw.match(/\d+\.\d+\.\d+[\d.]*/)?.[0] ?? raw;
      const exe = realpathSync(p);
      console.warn(
        `  [browser] rung2: system ${name} ${version} — NOTE: system browsers auto-update; only the pin's own build is version-guaranteed`,
      );
      return { mode: "system", browser: name, version, executable: exe };
    } catch {
      /* candidate answered nothing — next */
    }
  }
  // rung 3 — nothing usable
  const msg = `[browser] rung3: no usable browser for ${server} — run: bash accessbase.sh mcp setup`;
  if (process.env.MCP_BROWSER_STRICT === "1") throw new Error(msg);
  console.warn(`  ${msg} (WARN; MCP_BROWSER_STRICT=1 makes this fatal)`);
  return { mode: "none", browser: family, version: null, executable: null };
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
    const rec = readBrowserRecord();
    const lp = rec?.resolutions["local-playwright"];
    console.log(
      `  ${"browser(local-playwright)".padEnd(26)} ${
        lp
          ? `${lp.mode}${lp.version ? " " + lp.version : ""}${lp.executable ? " " + lp.executable : ""}`
          : "no record — run: bash accessbase.sh mcp setup"
      }`,
    );
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
      if (e.name === "local-playwright") {
        // W2 (2026-11-25): browser resolution AFTER the package install (a clean
        // clone has no cli.js inside the package) and through the PIN'S OWN
        // installer (version-exact; the REPO's `pnpm exec playwright install`
        // installs a different build and cannot satisfy the MCP).
        const res = resolvePlaywrightBrowser(e.name, e.pkg, "chromium");
        writeBrowserRecord(e.name, res);
        console.log(
          `  ${e.name}: browser -> ${res.mode}${res.version ? " " + res.version : ""}${
            res.mode === "none" ? " (UNRESOLVED — recorded; see above)" : ""
          }`,
        );
      }
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

// import.meta.main guard (gate-mcp precedent): importing this module must NOT
// run the CLI — scripts/agents/gate-mcp.mts imports readBrowserRecord().
if (import.meta.main) process.exit(main());
