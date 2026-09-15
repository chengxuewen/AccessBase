import { describe, it, expect, vi } from 'vitest';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { EventEmitter } from 'node:events';
import { createAuditMiddleware, auditAuthEvent, auditConfigChange } from '../middleware.js';
import { AuditLogger } from '../logger.js';
import type { AuditStorage } from '../logger.js';
import { defaultAuditConfig } from '../types.js';
import type { AuditLog } from '../types.js';

// No fastify runtime dep in this package — fake req/reply, invoke the middleware
// directly. The request-context site (:86) fires on reply.raw 'finish'.

function createStorage(): { storage: AuditStorage; written: AuditLog[] } {
  const written: AuditLog[] = [];
  return { storage: { write: async (entries) => void written.push(...entries) }, written };
}

function fakeRequest(overrides: Partial<Record<string, unknown>> = {}): FastifyRequest {
  return {
    method: 'POST',
    url: '/v1/users',
    ip: '127.0.0.1',
    id: 'req-1',
    headers: {},
    body: {},
    params: {},
    log: { error: vi.fn() },
    ...overrides,
  } as unknown as FastifyRequest;
}

function fakeReply(): FastifyReply {
  const raw = new EventEmitter();
  return {
    raw,
    statusCode: 200,
    send: vi.fn(),
  } as unknown as FastifyReply;
}

async function runRequestContext(user: Record<string, unknown> | undefined): Promise<string[]> {
  const auditLogger = { log: vi.fn().mockResolvedValue(undefined) } as unknown as AuditLogger;
  const middleware = createAuditMiddleware(auditLogger);
  const request = fakeRequest({ user });
  const reply = fakeReply();

  await middleware(request, reply);
  rawEmitFinish(reply);
  // 'finish' handler is async — yield so auditLogger.log is observed
  await new Promise((resolve) => setImmediate(resolve));

  return capturedUserId(auditLogger);
}

function rawEmitFinish(reply: FastifyReply): void {
  (reply.raw as unknown as EventEmitter).emit('finish');
}

function capturedUserId(auditLogger: AuditLogger): string[] {
  const mock = (auditLogger as unknown as { log: ReturnType<typeof vi.fn> }).log;
  return mock.mock.calls.map((call) => (call[0] as AuditLog).userId);
}

describe('audit middleware actor attribution (D1)', () => {
  it('JWT-shaped payload {sub} yields userId from sub', async () => {
    const userIds = await runRequestContext({ sub: 'u-9' });
    expect(userIds).toEqual(['u-9']);
  });

  it('payload with both id and sub prefers id (back-compat)', async () => {
    const userIds = await runRequestContext({ id: 'x', sub: 'y' });
    expect(userIds).toEqual(['x']);
  });

  it('empty payload yields anonymous', async () => {
    const userIds = await runRequestContext({});
    expect(userIds).toEqual(['anonymous']);
  });

  it('apikey-shaped payload {sub} yields userId from sub', async () => {
    const userIds = await runRequestContext({ sub: 'key-1' });
    expect(userIds).toEqual(['key-1']);
  });
});

describe('auditAuthEvent actor attribution (D1)', () => {
  it('user {sub} without id falls back to sub', async () => {

    const { storage, written } = createStorage();
    const auditLogger = new AuditLogger(
      { ...defaultAuditConfig, level: 'all', async: { ...defaultAuditConfig.async, enabled: false } },
      { storage },
    );
    const request = fakeRequest({ body: { email: 'a@b.c' } });

    auditAuthEvent(auditLogger, request, 'LOGIN', {
      sub: 'u-9',
      username: 'alice',
      tenantId: 't1',
    } as unknown as { id: string; username: string; tenantId: string });

    // Fire-and-forget write — capture synchronously before microtasks
      await new Promise<void>((resolve) => setImmediate(resolve));
  
        expect(written[0]?.userId).toBe('u-9');
  });

  it('no user yields anonymous', async () => {

    const { storage, written } = createStorage();
    const auditLogger = new AuditLogger(
      { ...defaultAuditConfig, level: 'all', async: { ...defaultAuditConfig.async, enabled: false } },
      { storage },
    );
    const request = fakeRequest({ body: { email: 'a@b.c' } });

    auditAuthEvent(auditLogger, request, 'LOGIN_FAILED');

      await new Promise<void>((resolve) => setImmediate(resolve));
  
        expect(written[0]?.userId).toBe('anonymous');
  });

  it('resourceId falls back to unknown (not anonymous) when only sub present', async () => {

    const { storage, written } = createStorage();
    const auditLogger = new AuditLogger(
      { ...defaultAuditConfig, level: 'all', async: { ...defaultAuditConfig.async, enabled: false } },
      { storage },
    );
    const request = fakeRequest({ body: { email: 'a@b.c' } });

    auditAuthEvent(auditLogger, request, 'LOGIN_FAILED'); // no user → resourceId 'unknown'

      await new Promise<void>((resolve) => setImmediate(resolve));
  
        expect(written[0]?.resourceId).toBe('unknown');
  });
});

describe('auditConfigChange actor attribution (D1)', () => {
  it('system context without user keeps literal system fallback', async () => {

    const { storage, written } = createStorage();
    const auditLogger = new AuditLogger(
      { ...defaultAuditConfig, level: 'all', async: { ...defaultAuditConfig.async, enabled: false } },
      { storage },
    );
    const request = fakeRequest();

    auditConfigChange(auditLogger, request, 'site.name', 'a', 'b');

      await new Promise<void>((resolve) => setImmediate(resolve));
  
        expect(written[0]?.userId).toBe('system');
  });

  it('user {sub} without id reads sub before system fallback', async () => {

    const { storage, written } = createStorage();
    const auditLogger = new AuditLogger(
      { ...defaultAuditConfig, level: 'all', async: { ...defaultAuditConfig.async, enabled: false } },
      { storage },
    );
    const request = fakeRequest({ user: { sub: 'u-7' } });

    auditConfigChange(auditLogger, request, 'site.name', 'a', 'b');

      await new Promise<void>((resolve) => setImmediate(resolve));
  
        expect(written[0]?.userId).toBe('u-7');
  });
});
