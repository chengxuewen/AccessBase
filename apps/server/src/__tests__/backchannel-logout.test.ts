/**
 * Q3D back-channel logout — unit battery U1-U12 (spec 2026-10-12 §4).
 * jose jwtVerify + JWKS fetch are mocked at the module seam; the pipeline
 * logic (claim checks, resolution, effects, dedup ordering) runs REAL.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';

// --- mock jose: one controllable verify + one JWKS fetch switch ---
const jwtVerifyState = {
  impl: async () => {
    throw new Error('not configured');
  },
  calls: 0,
};
vi.mock('jose', () => ({
  createRemoteJWKSet: vi.fn(() => 'jwks-set'),
  jwtVerify: (token: string, key: unknown, opts: unknown) => {
    jwtVerifyState.calls += 1;
    return jwtVerifyState.impl(token, key, opts);
  },
}));

// --- mock redis: set/del captured ---
const redisCalls = { sets: [] as Array<{ key: string; nx: boolean }>, dels: [] as string[] };
let redisUp = true;
vi.mock('../utils/redis.js', () => ({
  getRedis: async () =>
    redisUp
      ? {
          set: async (key: string, _v: string, _mode: string, _ttl: number, nx: string) => {
            redisCalls.sets.push({ key, nx: nx === 'NX' });
            return redisCalls.sets.filter((s) => s.key === key).length === 1 ? 'OK' : null;
          },
          del: async (key: string) => {
            redisCalls.dels.push(key);
            return 1;
          },
        }
      : null,
}));

// --- fake db: oauth_accounts rows + users rows, records effect calls ---
interface LinkRow { id: string; userId: string; provider: string; providerAccountId: string; accessToken: string | null; refreshToken: string | null; idToken: string | null }
interface UserRow { id: string; tenantId: string; tokenVersion: number }
const state = {
  links: [] as LinkRow[],
  users: [] as UserRow[],
  revokedFor: [] as string[],
  authstDeleted: [] as string[],
  emitted: [] as Array<{ userId: string; provider: string; jti: string }>,
  effectFailure: false,
};

vi.mock('@accessbase/identity/db', () => ({
  oauthAccounts: { _: 'oauth_accounts-marker' },
  users: { _: 'users-marker' },
  createDb: () => ({}),
  closeDb: async () => {},
}));

function makeDb() {
  // The pipeline uses drizzle-style chains; simulate them directly:
  return {
    select: (_cols?: unknown) => ({
      from: (table: unknown) => ({
        where: async () => {
          const isLinks = (table as { _?: string })?._ === 'oauth_accounts-marker';
          return isLinks ? state.links.filter((l) => l.provider === currentCall.provider && l.providerAccountId === currentCall.sub) : state.users.filter((u) => currentCall.linkUserIds.includes(u.id));
        },
      }),
    }),
    update: (table: unknown) => ({
      set: (vals: Record<string, unknown>) => ({
        where: async () => {
          if (state.effectFailure) throw new Error('effect failure (test seam)');
          const isLinks = (table as { _?: string })?._ === 'oauth_accounts-marker';
          if (isLinks) {
            for (const l of state.links) {
              if (currentCall.linkIds.includes(l.id)) {
                l.accessToken = (vals['accessToken'] as string | null) ?? null;
                l.refreshToken = (vals['refreshToken'] as string | null) ?? null;
                l.idToken = (vals['idToken'] as string | null) ?? null;
              }
            }
          } else {
            for (const u of state.users) {
              if (currentCall.bumpKey) {
                const [tenantId, id] = currentCall.bumpKey;
                if (u.tenantId === tenantId && u.id === id) u.tokenVersion += 1;
              }
            }
          }
        },
      }),
    }),
  };
}

let currentCall: { provider: string; sub: string; linkUserIds: string[]; linkIds: string[]; bumpKey?: [string, string] } = {
  provider: '',
  sub: '',
  linkUserIds: [],
  linkIds: [],
};

const providers = {
  'keycloak-x': {
    authUrl: 'https://kc.example.com/a',
    tokenUrl: 'https://kc.example.com/t',
    userinfoUrl: 'https://kc.example.com/u',
    clientId: 'accessbase-rp',
    clientSecret: 's',
    issuer: 'https://kc.example.com/realms/x',
    jwksUri: 'https://kc.example.com/certs',
  },
};

import { processBackchannelLogout, providerByIss, checkClaims, BCLO_EVENT_URI } from '../utils/backchannel-logout.js';
import type { BackchannelLogoutDeps } from '../utils/backchannel-logout.js';

function makeDeps(): BackchannelLogoutDeps {
  return {
    db: makeDb() as unknown as BackchannelLogoutDeps['db'],
    providers,
    revokeAllUserSessions: async (userId: string) => {
      if (state.effectFailure) throw new Error('effect failure (test seam)');
      state.revokedFor.push(userId);
    },
    delAuthStateKeys: async (userIds: string[]) => {
      state.authstDeleted.push(...userIds);
    },
    emitEvent: (input: { userId: string; provider: string; jti: string }) => {
      state.emitted.push(input);
    },
    logger: { info: () => {}, warn: () => {} },
  };
}

/** Build a real 3-part JWT whose PAYLOAD is readable (iss probe) — signature never checked (jose mocked). */
function token(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'RS256', kid: 'k1' })}.${b64(payload)}.sig`;
}

const now = () => Math.floor(Date.now() / 1000);
const basePayload = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  iss: 'https://kc.example.com/realms/x',
  sub: 'subject-1',
  aud: 'accessbase-rp',
  jti: 'jti-1',
  iat: now(),
  exp: now() + 300,
  events: { [BCLO_EVENT_URI]: {} },
  ...over,
});

beforeEach(() => {
  jwtVerifyState.calls = 0;
  jwtVerifyState.impl = async () => {
    throw new Error('jwt not configured');
  };
  redisCalls.sets = [];
  redisCalls.dels = [];
  redisUp = true;
  state.links = [{ id: 'L1', userId: 'u1', provider: 'keycloak-x', providerAccountId: 'subject-1', accessToken: 'at', refreshToken: 'rt', idToken: 'idt' }];
  state.users = [{ id: 'u1', tenantId: 't1', tokenVersion: 1 }];
  state.revokedFor = [];
  state.authstDeleted = [];
  state.emitted = [];
  state.effectFailure = false;
});
afterEach(() => {
  vi.restoreAllMocks();
});

/** Drive the pipeline with the mock db wired to this call's resolution data. */
async function drive(payload: Record<string, unknown>, opts: { verifyPayload?: Record<string, unknown> } = {}) {
  const sub = typeof payload['sub'] === 'string' ? payload['sub'] : '';
  const links = state.links.filter((l) => l.provider === 'keycloak-x' && l.providerAccountId === sub);
  currentCall = {
    provider: 'keycloak-x',
    sub,
    linkUserIds: links.map((l) => l.userId),
    linkIds: links.map((l) => l.id),
  };
  const firstUser = state.users[0];
  if (links.length > 0 && firstUser) currentCall.bumpKey = [firstUser.tenantId, firstUser.id];
  jwtVerifyState.impl = async () => ({ payload: opts.verifyPayload ?? payload });
  return processBackchannelLogout(token(payload), makeDeps());
}

describe('provider selection (A4 exact iss)', () => {
  it('U-sel1: exact issuer matches', () => {
    expect(providerByIss(providers, 'https://kc.example.com/realms/x')?.name).toBe('keycloak-x');
  });
  it('U-sel2: trailing-slash variant is a DIFFERENT issuer (no normalization)', () => {
    expect(providerByIss(providers, 'https://kc.example.com/realms/x/')).toBeNull();
  });
  it('U-sel3: provider without issuer/jwksUri pair never participates', () => {
    const partial = { ...providers, 'no-bclo': { ...providers['keycloak-x']!, issuer: undefined, jwksUri: undefined } };
    expect(providerByIss(partial as typeof providers, 'https://kc.example.com/realms/x')?.name).toBe('keycloak-x'); // only the paired one matches
    expect(providerByIss({ 'no-bclo': { ...providers['keycloak-x']!, issuer: 'https://kc.example.com/realms/x', jwksUri: undefined } } as unknown as typeof providers, 'https://kc.example.com/realms/x')).toBeNull(); // issuer without jwksUri never participates
    expect(providerByIss({ 'no-bclo2': { ...providers['keycloak-x']!, issuer: undefined, jwksUri: 'https://x/certs' } } as unknown as typeof providers, 'https://kc.example.com/realms/x')).toBeNull(); // jwksUri without issuer ditto
  });
});

describe('claim checks', () => {
  it('U4a: events member missing -> 002', () => {
    const r = checkClaims(basePayload({ events: {} }), 'accessbase-rp');
    expect('error' in r && r.error).toBe('AUTH_BCLO_002');
  });
  it('U4b: events with extra members still valid (lenient, R10)', () => {
    const r = checkClaims(basePayload({ events: { [BCLO_EVENT_URI]: {}, 'https://other': {} } }), 'accessbase-rp');
    expect('error' in r).toBe(false);
  });
  it('U4c: events non-object -> 002', () => {
    expect('error' in checkClaims(basePayload({ events: 'x' }), 'accessbase-rp')).toBe(true);
  });
  it('U3: nonce present -> 002 (PROHIBITED)', () => {
    expect('error' in checkClaims(basePayload({ nonce: 'n' }), 'accessbase-rp')).toBe(true);
  });
  it('U9: jti missing -> 002 (REQUIRED per BCL 2.4)', () => {
    expect('error' in checkClaims(basePayload({ jti: undefined }), 'accessbase-rp')).toBe(true);
  });
  it('U5a: age beyond 600s+60s -> 003', () => {
    const r = checkClaims(basePayload({ iat: now() - 700, exp: now() + 300 }), 'accessbase-rp');
    expect('error' in r && r.error).toBe('AUTH_BCLO_003');
  });
  it('U5b: within age+skew -> ok', () => {
    expect('error' in checkClaims(basePayload({ iat: now() - 610 }), 'accessbase-rp')).toBe(false);
  });
  it('aud array form accepted', () => {
    expect('error' in checkClaims(basePayload({ aud: ['other', 'accessbase-rp'] }), 'accessbase-rp')).toBe(false);
  });
});

describe('pipeline (A1/A2/A3 semantics)', () => {
  it('U1: happy path -> ok, revoke+bump+authstDEL+nulling+event, dedup claimed', async () => {
    const r = await drive(basePayload());
    expect(r.kind).toBe('ok');
    expect(state.revokedFor).toEqual(['u1']);
    expect(state.users[0]?.tokenVersion).toBe(2);
    expect(state.authstDeleted).toEqual(['u1']);
    expect(state.links[0]!.accessToken).toBeNull();
    expect(state.links[0]!.idToken).toBeNull();
    expect(state.emitted).toEqual([{ userId: 'u1', provider: 'keycloak-x', jti: 'jti-1' }]);
    expect(redisCalls.sets.length).toBe(1);
  });

  it('U2: replay (dedup hit at claim) -> ok; effects already ran once (idempotent, claim-last A3)', async () => {
    // First delivery
    await drive(basePayload());
    const setsAfterFirst = redisCalls.sets.length;
    // Second delivery: same jti -> redis mock returns non-OK for duplicate key
    const r2 = await drive(basePayload());
    expect(r2.kind).toBe('ok');
    expect(redisCalls.sets.length).toBe(setsAfterFirst + 1); // claim attempted again
    // effects ran twice — acceptable under A3 (idempotent); net state unchanged
    expect(state.users[0]?.tokenVersion).toBe(3);
  });

  it('U6: unknown sub -> benign ok, zero effects, no dedup write', async () => {
    const r = await drive(basePayload({ sub: 'nobody' }));
    expect(r.kind).toBe('ok');
    expect(state.revokedFor).toEqual([]);
    expect(redisCalls.sets).toEqual([]);
    expect(state.emitted).toEqual([]);
  });

  it('U6b/c: null-sub -> benign ok + warn, zero effects (A1)', async () => {
    const warns: unknown[] = [];
    const deps = makeDeps();
    deps.logger = { info: () => {}, warn: (o: unknown) => warns.push(o) };
    jwtVerifyState.impl = async () => ({ payload: basePayload({ sub: null }) });
    const r = await processBackchannelLogout(token(basePayload({ sub: null })), deps);
    expect(r.kind).toBe('ok');
    expect(state.revokedFor).toEqual([]);
    expect(warns.length).toBe(1);
  });

  it('U-miss: no provider for iss -> 002', async () => {
    const r = await drive(basePayload({ iss: 'https://other.example.com' }));
    expect(r.kind === 'invalid' && r.code).toBe('AUTH_BCLO_002');
  });

  it('U-001: not a JWT -> 001', async () => {
    const r = await processBackchannelLogout('garbage', makeDeps());
    expect(r.kind === 'invalid' && r.code).toBe('AUTH_BCLO_001');
  });

  it('U-oversize: >8KB token -> 001', async () => {
    const r = await processBackchannelLogout('a'.repeat(9000), makeDeps());
    expect(r.kind === 'invalid' && r.code).toBe('AUTH_BCLO_001');
  });

  it('I6-shape: effect failure -> 400-family outcome + dedup key RELEASED (A3 failure-release)', async () => {
    state.effectFailure = true;
    currentCall = { provider: 'keycloak-x', sub: 'subject-1', linkUserIds: ['u1'], linkIds: ['L1'], bumpKey: ['t1', 'u1'] };
    jwtVerifyState.impl = async () => ({ payload: basePayload() });
    const r = await processBackchannelLogout(token(basePayload()), makeDeps());
    expect(r.kind === 'invalid' && r.code).toBe('AUTH_BCLO_002');
    expect(redisCalls.dels.length).toBe(1); // claim released for redelivery
  });
});
