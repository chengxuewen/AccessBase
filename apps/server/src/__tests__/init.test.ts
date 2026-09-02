/**
 * Admin Initialization Module tests (Task 2 — setup wizard unification)
 *
 * init.ts is now a state synchronizer: DB is the single source of truth (D113).
 *   - admin exists          → no-op
 *   - no admin + env dual-var (ADMIN_EMAIL && ADMIN_PASSWORD) → create admin,
 *     password NEVER logged
 *   - no admin + env incomplete → log "Setup Wizard will run on first access"
 *   - any error → swallowed (setup wizard takes over; startup must not crash)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { logger } from '@accessbase/logging';

// Module-level mutable config: tests mutate fields, then resetModules + re-import.
vi.mock('../config.js', () => ({
  config: { adminEmail: '', adminPassword: '' },
}));

const mockFindByEmail = vi.fn();
const mockCreateUser = vi.fn();
const mockCreateRole = vi.fn();
const mockAssignToUser = vi.fn();

vi.mock('@accessbase/identity', () => ({
  UserManager: vi.fn().mockImplementation(() => ({
    findByEmail: mockFindByEmail,
    create: mockCreateUser,
  })),
  RoleManager: vi.fn().mockImplementation(() => ({
    create: mockCreateRole,
    assignToUser: mockAssignToUser,
  })),
}));

vi.mock('@accessbase/logging', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Dynamic import helper: re-imports init.js with fresh module registry so the
// mutated config object is re-evaluated per test.
async function importInit() {
  await vi.resetModules();
  return await import('../init.js');
}

import { logger as mockLogger } from '@accessbase/logging';

beforeEach(() => {
  mockFindByEmail.mockReset();
  mockCreateUser.mockReset();
  mockCreateRole.mockReset();
  mockAssignToUser.mockReset();
  vi.mocked(mockLogger.info).mockClear();
  vi.mocked(mockLogger.warn).mockClear();
  vi.mocked(mockLogger.error).mockClear();
  vi.mocked(mockLogger.debug).mockClear();
});
describe('initializeAdmin (state sync + env bypass)', () => {
  it('case 1: admin exists → no-op (create never called)', async () => {
    mockFindByEmail.mockResolvedValue({ id: 'u1', email: 'admin@accessbase.local' });
    const { initializeAdmin } = await importInit();

    await initializeAdmin({} as never);

    expect(mockCreateUser).not.toHaveBeenCalled();
    expect(mockCreateRole).not.toHaveBeenCalled();
  });

  it('case 2: no admin + env dual-var → creates admin, password never logged', async () => {
    mockFindByEmail.mockResolvedValue(null);
    mockCreateRole.mockResolvedValue({ id: 'role-1' });
    mockCreateUser.mockResolvedValue({ id: 'u1', email: 'x@y.z' });

    const { config } = await import('../config.js');
    config.adminEmail = 'x@y.z';
    config.adminPassword = 'Xxx12345678';

    const { initializeAdmin } = await importInit();

    await initializeAdmin({} as never);

    expect(mockCreateUser).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'x@y.z',
        password: 'Xxx12345678',
      }),
      expect.anything(),
    );

    expect(mockAssignToUser).toHaveBeenCalledWith(
      'u1',
      'role-1',
      expect.anything(),
    );

    // Password must never appear in any log call — as field value or string.
    const allLogCalls = [
      ...vi.mocked(mockLogger.info).mock.calls,
      ...vi.mocked(mockLogger.warn).mock.calls,
      ...vi.mocked(mockLogger.error).mock.calls,
    ];
    for (const call of allLogCalls) {
      expect(JSON.stringify(call)).not.toContain('Xxx12345678');
    }
  });

  it('case 3: no admin + env single-sided (no password) → skip creation, wizard message', async () =>
  {
    mockFindByEmail.mockResolvedValue(null);
    const { config } = await import('../config.js');
    config.adminEmail = 'x@y.z';
    config.adminPassword = '';

    const { initializeAdmin } = await importInit();

    await initializeAdmin({} as never);

    expect(mockCreateUser).not.toHaveBeenCalled();
    expect(vi.mocked(mockLogger.info).mock.calls.some((c) =>
      typeof c[0] === 'string' && c[0].includes('Setup Wizard will run on first access'),
    )).toBe(true);
  });

  it('case 4: DB failure → swallowed, resolves undefined (startup must not crash)', async () => {
    mockFindByEmail.mockRejectedValue(new Error('db down'));
    const { initializeAdmin } = await importInit();

    await expect(initializeAdmin({} as never)).resolves.toBeUndefined();
    expect(vi.mocked(mockLogger.error).mock.calls.length).toBeGreaterThan(0);
  });
});
