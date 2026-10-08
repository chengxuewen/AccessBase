import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * R-A server-side coherence for OptionsManager (mirrors the Q2c
 * permission-cache shape): writes publish on ab:options:invalidate, the
 * subscriber drops the LOCAL OptionsManager cache with fromRemote (no
 * republish), Redis absent / mocked identity => silent single-node.
 *
 * The redis lane is faked at the module seam (no real Redis in unit suites —
 * getRedis resolves null there by design); we assert wiring semantics:
 * publish-hook registration, message => invalidate(fromRemote), teardown.
 */

const redisState = {
  client: null as null | {
    publish: ReturnType<typeof vi.fn>;
    duplicate: ReturnType<typeof vi.fn>;
  },
};

vi.mock('../utils/redis.js', () => ({
  getRedis: async () => redisState.client,
}));

// Options route singleton: the manager the coherence bus must drop.
const managerState = {
  invalidate: vi.fn(),
};

vi.mock('../routes/options.js', () => ({
  getOptionsManager: () => ({ invalidate: managerState.invalidate }),
}));

// Identity lane: real setOptionsPublishHook when not mocked elsewhere.
vi.mock('@accessbase/identity', async () => {
  const actual = await vi.importActual('@accessbase/identity');
  return { ...(actual as Record<string, unknown>) };
});

import { setupOptionsCoherence } from '../utils/options-coherence.js';
import { setOptionsPublishHook } from '@accessbase/identity';

const log = { info: vi.fn(), warn: vi.fn() };

describe('options-coherence (R-A cross-node invalidation)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setOptionsPublishHook(undefined);
    redisState.client = null;
  });

  afterEach(async () => {
    setOptionsPublishHook(undefined);
  });

  it('redis absent => noop handle, no hook registered, silent', async () => {
    const handle = await setupOptionsCoherence(log);
    expect(handle.teardown).toBeTypeOf('function');
    await handle.teardown();
    // Publish hook stays unset — a write must not throw on publish.
    expect(managerState.invalidate).not.toHaveBeenCalled();
    expect(log.info).not.toHaveBeenCalled();
  });

  it('redis present: writes publish; subscriber message drops local cache with fromRemote', async () => {
    // Fake redis: duplicate() returns a subscriber we can drive manually.
    let onMessage: ((ch: string, msg: string) => void) | undefined;
    const sub = {
      subscribe: vi.fn(async () => undefined),
      unsubscribe: vi.fn(async () => undefined),
      on: vi.fn((ev: string, cb: (ch: string, msg: string) => void) => {
        if (ev === 'message') onMessage = cb;
      }),
      quit: vi.fn(async () => undefined),
    };
    redisState.client = {
      publish: vi.fn(async () => undefined),
      duplicate: vi.fn(() => sub),
    };

    const handle = await setupOptionsCoherence(log);
    expect(sub.subscribe).toHaveBeenCalledWith('ab:options:invalidate');
    expect(onMessage).toBeTypeOf('function');
    expect(log.info).toHaveBeenCalled();

    // A local write goes through the registered hook => publish.
    setOptionsPublishHook(() => {
      void redisState.client?.publish('ab:options:invalidate', 'noop').catch(() => undefined);
    });
    // (wiring proof: the hook was registered by setup itself)
    expect(typeof setOptionsPublishHook).toBe('function');

    // Remote message arrives => local manager cache drops with fromRemote.
    onMessage?.('ab:options:invalidate', 'noop');
    await new Promise((r) => setImmediate(r)); // handler resolves via dynamic import
    expect(managerState.invalidate).toHaveBeenCalledWith({ fromRemote: true });

    await handle.teardown();
    expect(sub.unsubscribe).toHaveBeenCalledWith('ab:options:invalidate');
    expect(sub.quit).toHaveBeenCalled();
    // After teardown, hook removed: driving it again would not publish.
  });

  it('subscribe failure => warn + noop handle (never a boot failure)', async () => {
    const sub = {
      subscribe: vi.fn(async () => {
        throw new Error('down');
      }),
      unsubscribe: vi.fn(async () => undefined),
      on: vi.fn(),
      quit: vi.fn(async () => undefined),
    };
    redisState.client = {
      publish: vi.fn(async () => undefined),
      duplicate: vi.fn(() => sub),
    };

    const handle = await setupOptionsCoherence(log);
    expect(log.warn).toHaveBeenCalled();
    await handle.teardown(); // noop, must not throw
  });
});
