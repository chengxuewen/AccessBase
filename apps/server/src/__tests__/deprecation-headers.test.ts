/**
 * S5-B (2026-11-09): the deprecation contract must be exercised by injected entries, not
 * by the production list - the list is empty by measured fact today, and a test that only
 * asserts "nothing is deprecated" would silently rot the moment someone adds an entry.
 * No buildApp() here on purpose: the header behaviour is transport plumbing and must be
 * verifiable without PG/Redis (the teardown-race family, PIT-088/E18, stays out of it).
 */
import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import {
  registerDeprecationHeaders,
  deprecationHeaders,
  validateEntry,
  DEPRECATED_ROUTES,
  DEPRECATION_EXPOSED_HEADERS,
  MIN_WINDOW_DAYS,
  type DeprecationEntry,
} from '../utils/deprecation.js';

const FUTURE_SUNSET = 'Tue, 09 Feb 2027 00:00:00 GMT';

function entry(over: Partial<DeprecationEntry> = {}): DeprecationEntry {
  return {
    method: 'GET',
    path: '/api/v1/demo/:id',
    sunset: FUTURE_SUNSET,
    link: 'https://docs.example.invalid/deprecations#demo',
    announced: '2026-11-09',
    note: 'test entry - never shipped',
    ...over,
  };
}

async function appWith(entries: DeprecationEntry[]) {
  const app = Fastify();
  app.get('/api/v1/demo/:id', async () => ({ ok: true }));
  app.get('/api/v1/keep', async () => ({ ok: true }));
  app.post('/api/v1/demo/:id', async () => ({ ok: true }));
  registerDeprecationHeaders(app, entries);
  await app.ready();
  return app;
}

describe('deprecation headers (S5-B)', () => {
  it('emits the triple on a matched route template, whatever the concrete id is', async () => {
    const app = await appWith([entry()]);
    const res = await app.inject({ method: 'GET', url: '/api/v1/demo/42' });
    expect(res.statusCode).toBe(200);
    expect(res.headers.deprecation).toBe('true');
    expect(res.headers.sunset).toBe(FUTURE_SUNSET);
    expect(res.headers.link).toBe(
      '<https://docs.example.invalid/deprecations#demo>; rel="deprecation"',
    );
    // the payload survives the onSend hook untouched
    expect(res.json()).toEqual({ ok: true });
    await app.close();
  });

  it('leaves routes that are not on the list completely clean', async () => {
    const app = await appWith([entry()]);
    const res = await app.inject({ method: 'GET', url: '/api/v1/keep' });
    expect(res.headers.deprecation).toBeUndefined();
    expect(res.headers.sunset).toBeUndefined();
    await app.close();
  });

  it('keys on method as well as path: a listed GET does not mark the POST sibling', async () => {
    const app = await appWith([entry({ method: 'GET' })]);
    const res = await app.inject({ method: 'POST', url: '/api/v1/demo/7' });
    expect(res.headers.deprecation).toBeUndefined();
    await app.close();
  });

  it('an empty list registers nothing and changes no response', async () => {
    const app = await appWith([]);
    const res = await app.inject({ method: 'GET', url: '/api/v1/demo/1' });
    expect(res.statusCode).toBe(200);
    expect(res.headers.deprecation).toBeUndefined();
    await app.close();
  });

  it('a 404 (unmatched route template) never grows a deprecation header', async () => {
    const app = await appWith([entry()]);
    const res = await app.inject({ method: 'GET', url: '/api/v1/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.headers.deprecation).toBeUndefined();
    await app.close();
  });

  it('header shape is exactly Deprecation/Sunset/Link, nothing else', () => {
    expect(Object.keys(deprecationHeaders(entry()))).toEqual(['Deprecation', 'Sunset', 'Link']);
  });
});

describe('deprecation policy validation (S5-B)', () => {
  it(`rejects a window shorter than ${MIN_WINDOW_DAYS} days`, () => {
    const problems = validateEntry(
      entry({ announced: '2026-11-09', sunset: 'Mon, 01 Feb 2027 00:00:00 GMT' }),
    );
    expect(problems.join(' ')).toContain('policy floor');
  });

  it('accepts a window at or above the floor', () => {
    expect(validateEntry(entry())).toEqual([]);
  });

  it('rejects an unparseable sunset date', () => {
    expect(validateEntry(entry({ sunset: 'next tuesday-ish' })).join(' ')).toContain('HTTP-date');
  });

  it('rejects a sunset that has already passed (removal needs a decision record, not a list entry)', () => {
    const problems = validateEntry(
      entry({ announced: '2020-01-01', sunset: 'Fri, 01 Jan 2021 00:00:00 GMT' }),
      new Date('2026-01-01'),
    );
    expect(problems.join(' ')).toContain('already passed');
  });

  it('rejects a non-absolute link and a template not starting with /', () => {
    expect(validateEntry(entry({ link: 'deprecations.md' })).join(' ')).toContain('absolute URL');
    expect(validateEntry(entry({ path: 'api/v1/demo' })).join(' ')).toContain('route template');
  });

  it('registration fails fast rather than shipping a short window', () => {
    const bad = entry({ announced: '2026-11-09', sunset: 'Mon, 01 Feb 2027 00:00:00 GMT' });
    expect(() => registerDeprecationHeaders(Fastify(), [bad])).toThrow(/policy floor|violates/);
  });

  it('the shipped list is policy-valid as it stands (empty today by measured fact)', () => {
    expect(DEPRECATED_ROUTES.flatMap((e) => validateEntry(e))).toEqual([]);
  });
});

/**
 * The half of B that a bare-Fastify test cannot see: emitting a header nobody may read is
 * not a contract. This drives the REAL @fastify/cors plugin, and asserts over the header
 * names the emitter actually produces rather than over a copied list - so adding a fourth
 * deprecation header without exposing it turns this red.
 */
describe('browser readability (S5-B CORS half)', () => {
  it('every emitted deprecation header is CORS-exposed', async () => {
    const app = Fastify();
    await app.register(cors, { origin: true, exposedHeaders: DEPRECATION_EXPOSED_HEADERS });
    registerDeprecationHeaders(app, [entry()]);
    app.get('/api/v1/demo/:id', async () => ({ ok: true }));
    await app.ready();

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/demo/1',
      headers: { origin: 'http://localhost:5173' },
    });
    const exposed = String(res.headers['access-control-expose-headers'] ?? '').toLowerCase();
    for (const name of Object.keys(deprecationHeaders(entry()))) {
      expect(exposed).toContain(name.toLowerCase());
    }
    // and the response really carries them on a matched route
    expect(res.headers.deprecation).toBe('true');
    await app.close();
  });
});
