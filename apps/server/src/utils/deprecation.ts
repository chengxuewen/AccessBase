/**
 * API deprecation surface — ruling S5-B (2026-11-09).
 *
 * Policy text: docs/modules/api.md §23.2.1. This module is the SINGLE WRITER of the
 * "this operation is deprecated" promise: no scattered route comments, no per-endpoint
 * flag. A deprecation is a list entry, and the list is validated at startup so a window
 * shorter than the policy can never ship silently.
 *
 * Emitted headers (RFC-style triple, chosen for tool readability):
 *   Deprecation: true
 *   Sunset: <HTTP-date>
 *   Link: <doc-url>; rel="deprecation"
 * `Deprecation: true` (rather than the structured field form of the newest draft) is the
 * spelling existing tooling understands; the date and the pointer travel in their own
 * headers, so no parsing cooperation is required from the reader.
 *
 * Matching uses `request.routeOptions.url` — the registered ROUTE TEMPLATE, exactly like
 * routes/metrics.ts:94, which carries the same warning: never the concrete url, both for
 * cardinality and because a client-supplied path must not decide whether a contract header
 * appears.
 */
import type { FastifyInstance } from 'fastify';

export interface DeprecationEntry {
  /** HTTP method as registered, uppercase-normalised at match time. */
  method: string;
  /** Route template, e.g. `/api/v1/users/:id` — NOT a concrete path. */
  path: string;
  /** RFC 1123 HTTP-date, e.g. `Tue, 09 Feb 2027 00:00:00 GMT`. */
  sunset: string;
  /** Documentation URL for the replacement; emitted inside the Link header. */
  link: string;
  /** ISO day the deprecation was announced (CHANGELOG entry date). */
  announced: string;
  /** Internal rationale. NEVER emitted. */
  note: string;
}

/** Policy floor, mirrored from api.md §23.2.1 — change both or neither. */
export const MIN_WINDOW_DAYS = 90;

/**
 * The three header names @fastify/cors must expose (note the option spelling:
 * `exposedHeaders`, not the Express-style `exposeHeaders`). Exported as a single source so
 * the app wiring and the tests cannot drift: without this list in the CORS config the whole
 * contract exists but is unreadable from any browser, and no unit test over a bare Fastify
 * instance would ever notice.
 */
export const DEPRECATION_EXPOSED_HEADERS: string[] = ['Deprecation', 'Sunset', 'Link'];

const DAY_MS = 86_400_000;

/**
 * Measured fact 2026-11-09: the HTTP surface has no deprecation candidate yet. Checked by
 * path inventory over docs/openapi.json (105 paths / 134 operations) for old/new pairs of
 * the same verb — the repeated trailing segments (`status`, `verify`, `login`, …) are
 * distinct resources, not successor versions. The six identity-sdd drift items are
 * package-level TypeScript API, handled by ruling S5-C, and are deliberately NOT listed
 * here: this list is the wire contract, not the library surface.
 */
export const DEPRECATED_ROUTES: DeprecationEntry[] = [];

/** Returns policy violations for one entry; empty array means the entry is legal. */
export function validateEntry(entry: DeprecationEntry, now = new Date()): string[] {
  const problems: string[] = [];
  const sunset = new Date(entry.sunset);
  const announced = new Date(entry.announced);

  if (Number.isNaN(sunset.getTime()))
    problems.push(`sunset is not a parseable HTTP-date: ${entry.sunset}`);
  if (Number.isNaN(announced.getTime()))
    problems.push(`announced is not a parseable date: ${entry.announced}`);
  if (problems.length) return problems;

  if (!entry.link.startsWith('http')) problems.push(`link must be an absolute URL: ${entry.link}`);
  // Security-check finding (2026-11-09, review of S5-B): no check here rejected control bytes.
  // These values are list constants, never user input, so this is NOT an injection sink - but a
  // CR/LF slipping into an entry (a copy-paste from a wrapped diff, a stray escape) would fail at
  // REQUEST time inside reply.header() as ERR_INVALID_CHAR: a typo in a config file turning into
  // production 500s on that route. Startup is where every other malformation is already refused,
  // so the refusal belongs there too. Written as a codepoint scan because a regex escape here
  // got mangled into a literal character class by the edit tooling - an array scan is louder.
  const hasControlByte = Array.from(entry.link).some((ch) => {
    const code = ch.codePointAt(0) ?? 0;
    return code < 0x20 || code === 0x7f;
  });
  if (hasControlByte)
    problems.push(
      'link contains CR/LF or other control characters - it would crash the response at runtime',
    );
  if (!entry.path.startsWith('/'))
    problems.push(`path must be a route template starting with /: ${entry.path}`);
  if (entry.path.includes(':') === false && entry.path.endsWith('/'))
    problems.push('path must not end with a slash');

  const windowDays = (sunset.getTime() - announced.getTime()) / DAY_MS;
  if (windowDays < MIN_WINDOW_DAYS) {
    problems.push(
      `window is ${Math.floor(windowDays)} d, policy floor is ${MIN_WINDOW_DAYS} d (announced ${entry.announced}, sunset ${entry.sunset})`,
    );
  }
  if (sunset.getTime() <= now.getTime())
    problems.push(
      `sunset already passed (${entry.sunset}) — removal needs a D-entry, not a list entry`,
    );

  return problems;
}

/** Headers for one entry, kept in one place so the shape cannot drift. */
export function deprecationHeaders(entry: DeprecationEntry): Record<string, string> {
  return {
    Deprecation: 'true',
    Sunset: entry.sunset,
    Link: `<${entry.link}>; rel="deprecation"`,
  };
}

/**
 * Registers the wire behaviour. Throws on any policy-invalid entry (fail fast: a short
 * window discovered in review is cheaper than one discovered by a customer).
 */
export function registerDeprecationHeaders(
  app: FastifyInstance,
  entries: DeprecationEntry[] = DEPRECATED_ROUTES,
): void {
  const violations = entries.flatMap((e) =>
    validateEntry(e).map((p) => `${e.method} ${e.path}: ${p}`),
  );
  if (violations.length > 0) {
    throw new Error(`deprecation list violates api.md §23.2.1 — ${violations.join('; ')}`);
  }

  const index = new Map(entries.map((e) => [`${e.method.toUpperCase()} ${e.path}`, e]));
  if (index.size === 0) return; // empty list is the measured today; registration stays cheap

  app.addHook('onSend', async (request, reply, payload) => {
    const template = request.routeOptions.url ?? '';
    const hit = index.get(`${request.method.toUpperCase()} ${template}`);
    if (hit) {
      for (const [name, value] of Object.entries(deprecationHeaders(hit)))
        reply.header(name, value);
    }
    return payload;
  });
}
