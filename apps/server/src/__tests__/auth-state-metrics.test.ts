/**
 * T2 (gap-remediation batch, G1): the Q3A revocation reader fails OPEN on
 * DB errors by ruling — this battery makes that state OBSERVABLE:
 * counter increments per failure, series present on /metrics, warn capped
 * at 1/min (counter carries volume, log carries the wake-up).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

process.env['NODE_ENV'] = 'test';
process.env['JWT_SECRET'] = 'test-secret';
process.env['DATABASE_URL'] = 'postgresql://test:test@localhost:5432/test';

// DB that always throws → the reader's fail-open catch.
vi.mock('@accessbase/identity/db', () => ({
  users: { _: 'users-marker' },
  createDb: () => ({}),
  closeDb: async () => {},
}));

vi.mock('./../utils/managers.js', () => ({
  authDb: () => {
    throw new Error('db down (test seam)');
  },
}));

vi.mock('./../utils/redis.js', () => ({
  // Redis present but empty (get miss) → reader proceeds to readDb, which
  // throws via the authDb seam. (null redis would SHORT-CIRCUIT before readDb.)
  getRedis: async () => ({
    get: async () => null,
    set: async () => undefined,
  }),
}));

import { getAuthState } from '../utils/auth-state.js';
import { authStateReadErrorsTotal } from '../utils/auth-state-metrics.js';

beforeEach(() => {
  authStateReadErrorsTotal.reset?.();
  vi.clearAllMocks();
});

describe('auth-state reader observability (G1/T2)', () => {
  it('U1: fail-open posture preserved — DB throw resolves null (never throws)', async () => {
    await expect(getAuthState('sub-1')).resolves.toBeNull();
  });

  it('U2: counter increments per DB failure', async () => {
    await getAuthState('sub-1');
    await getAuthState('sub-2');
    const val = (await authStateReadErrorsTotal.get()).values[0]?.value ?? 0;
    expect(Number(val)).toBeGreaterThanOrEqual(2);
  });

  it('U3: series string-matches on the prom-client default registry output', async () => {
    await getAuthState('sub-1');
    const register = (await import('prom-client')).register;
    const body = await register.metrics();
    expect(body).toContain('accessbase_authstate_read_errors_total');
  });
});
