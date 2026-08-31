import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@accessbase/logging', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../db/index.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../db/index.js')>()),
  createDb: vi.fn(),
}));

vi.mock('bcryptjs', () => ({
  default: {
    hash: vi.fn(async (v: string) => `bc:${v}`), // deterministic pseudo-hash
    compare: vi.fn(async (plain: string, hashed: string) => hashed === `bc:${plain}`),
  },
}));

import { MfaManager } from '../managers/MfaManager.js';
import { users, mfaRecoveryCodes } from '../db/schema.js';
import { decrypt } from '../services/crypto.js';

const KEY = 'ab'.repeat(32); // 32-byte hex test key

/**
 * Chainable drizzle-style mock (same shape as SessionManager.test.ts mockDb):
 * select…from…where…limit → rows; update().set() records patch;
 * insert().values() records rows; delete().where() flags deletion.
 * `table` identity is tracked so users vs mfa_recovery_codes stay separate.
 */
function makeMockDb() {
  const store = {
    users: [{ id: 'u-1', email: 'u@test.local', totpSecret: null, totpEnabled: false }],
    codes: [] as Record<string, unknown>[],
    userPatch: undefined as Record<string, unknown> | undefined,
    insertedCodes: [] as Record<string, unknown>[],
    usedCodeIds: [] as string[],
    codesDeleted: false,
  };

  const db = { select: vi.fn(), insert: vi.fn(), update: vi.fn(), delete: vi.fn() };

  db.select.mockImplementation(() => ({
    from: vi.fn((table: unknown) => {
      const rows = table === users ? store.users : store.codes;
      const chain = { where: vi.fn(), limit: vi.fn() };
      chain.where.mockReturnValue(chain);
      chain.limit.mockResolvedValue(rows.map((r) => ({ ...r })));
      return chain;
    }),
  }));

  db.update.mockImplementation((table: unknown) => ({
    set: vi.fn((patch: Record<string, unknown>) => ({
      where: vi.fn(async () => {
        if (table === users) store.userPatch = patch;
        else store.usedCodeIds.push('marked');
      }),
    })),
  }));

  db.insert.mockImplementation(() => ({
    values: vi.fn(async (rows: Record<string, unknown> | Record<string, unknown>[]) => {
      store.insertedCodes.push(...(Array.isArray(rows) ? rows : [rows]));
      return [];
    }),
  }));

  db.delete.mockImplementation(() => ({
    where: vi.fn(async () => {
      store.codesDeleted = true;
    }),
  }));

  return { db, store };
}

function makeManager() {
  const { db, store } = makeMockDb();
  const manager = new MfaManager(KEY, db as never);
  return { manager, store };
}

describe('MfaManager', () => {
  let manager: MfaManager;
  let store: ReturnType<typeof makeMockDb>['store'];

  beforeEach(() => {
    vi.clearAllMocks();
    const m = makeManager();
    manager = m.manager;
    store = m.store;
  });

  it('setup stores encrypted secret and returns url, qr and 10 plaintext codes', async () => {
    const result = await manager.setup('u-1', 'u@test.local');
    expect(result.otpauthUrl).toMatch(/^otpauth:\/\/totp\//);
    expect(result.qrDataUrl).toMatch(/^data:image\/png;base64,/);
    expect(result.recoveryCodes).toHaveLength(10);
    // Stored secret must be ciphertext, decryptable back to the real TOTP secret
    const stored = store.userPatch?.totpSecret as string;
    expect(stored).toBeTruthy();
    expect(stored).not.toBe(result.secret);
    expect(decrypt(stored, KEY)).toBe(result.secret);
    expect(store.userPatch?.totpEnabled).toBe(false);
    expect(store.insertedCodes).toHaveLength(10);
  });

  it('enable activates MFA with a valid TOTP code', async () => {
    const { generateSync } = await import('otplib');
    const setup = await manager.setup('u-1', 'u@test.local');
    store.users[0]!.totpSecret = store.userPatch?.totpSecret as string;
    const code = generateSync({ secret: setup.secret });
    await manager.enable('u-1', code);
    expect(store.userPatch).toEqual({ totpEnabled: true });
  });

  it('enable rejects a wrong code', async () => {
    await manager.setup('u-1', 'u@test.local');
    store.users[0]!.totpSecret = store.userPatch?.totpSecret as string;
    await expect(manager.enable('u-1', '000000')).rejects.toThrow('Invalid TOTP code');
    expect(store.userPatch).not.toEqual({ totpEnabled: true });
  });

  it('verify returns true for a valid TOTP, false otherwise', async () => {
    const { generateSync } = await import('otplib');
    const setup = await manager.setup('u-1', 'u@test.local');
    store.users[0]!.totpSecret = store.userPatch?.totpSecret as string;
    const good = generateSync({ secret: setup.secret });
    expect((await manager.verify('u-1', good)).success).toBe(true);
    expect((await manager.verify('u-1', '000000')).success).toBe(false);
  });

  it('recovery code is single-use (second attempt fails)', async () => {
    const setup = await manager.setup('u-1', 'u@test.local');
    // bcryptjs mock: stored hash is `bc:<plaintext>`
    store.codes = store.insertedCodes.map((c, i) => ({
      id: `code-${i}`,
      userId: 'u-1',
      codeHash: c.codeHash,
      used: false,
    }));
    const code = setup.recoveryCodes[0] as string;
    expect((await manager.verifyRecoveryCode('u-1', code)).success).toBe(true);
    expect(store.usedCodeIds).toHaveLength(1);
    // second use: code now marked used — simulate by dropping it from candidates
    store.codes = store.codes.filter((c) => c.codeHash !== `bc:${code}`);
    expect((await manager.verifyRecoveryCode('u-1', code)).success).toBe(false);
  });

  it('disable wipes secret, flag and recovery codes', async () => {
    await manager.setup('u-1', 'u@test.local');
    store.userPatch = undefined;
    await manager.disable('u-1');
    expect(store.userPatch).toEqual({ totpSecret: null, totpEnabled: false });
    expect(store.codesDeleted).toBe(true);
  });
});
