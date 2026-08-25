import { describe, test, expect } from 'vitest';
import { createLogger } from '../index.js';
import type { LoggerConfig, LogLevel } from '../index.js';
import pino from 'pino';
import { Writable } from 'node:stream';

/**
 * Helper: writable stream that collects parsed JSON log lines.
 */
function createCaptureStream(): { stream: Writable; lines: Record<string, unknown>[] } {
  const lines: Record<string, unknown>[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      try {
        lines.push(JSON.parse(chunk.toString()));
      } catch {
        // ignore non-JSON
      }
      callback();
    },
  });
  return { stream, lines };
}

// ── createLogger ────────────────────────────────────────────────────────────

describe('createLogger', () => {
  test('returns a pino logger with expected methods', () => {
    // Arrange
    const config: LoggerConfig = { level: 'info' };

    // Act
    const logger = createLogger(config);

    // Assert
    expect(logger).toBeDefined();
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.error).toBe('function');
    expect(typeof logger.warn).toBe('function');
    expect(typeof logger.debug).toBe('function');
    expect(typeof logger.fatal).toBe('function');
    expect(typeof logger.trace).toBe('function');
  });

  test('logger.level reflects the configured level', () => {
    // Arrange & Act
    const logger = createLogger({ level: 'warn' });

    // Assert
    expect(logger.level).toBe('warn');
  });
});

// ── Log levels ──────────────────────────────────────────────────────────────

describe('log levels', () => {
  const levels: LogLevel[] = ['fatal', 'error', 'warn', 'info', 'debug', 'trace'];

  test.each(levels)('creates logger with level "%s" without throwing', (level) => {
    // Arrange & Act
    const logger = createLogger({ level });

    // Assert
    expect(logger.level).toBe(level);
  });

  test('messages below configured level are suppressed', () => {
    // Arrange
    const { stream, lines } = createCaptureStream();
    const logger = pino({ level: 'warn' }, stream);

    // Act
    logger.info('should be suppressed');
    logger.debug('also suppressed');
    logger.warn('should appear');

    // Assert
    expect(lines).toHaveLength(1);
    expect(lines[0]['msg']).toBe('should appear');
  });

  test('messages at or above configured level are emitted', () => {
    // Arrange
    const { stream, lines } = createCaptureStream();
    const logger = pino({ level: 'warn' }, stream);

    // Act
    logger.warn('warn msg');
    logger.error('error msg');
    logger.fatal('fatal msg');

    // Assert
    expect(lines).toHaveLength(3);
    expect(lines.map((l) => l['msg'])).toEqual(['warn msg', 'error msg', 'fatal msg']);
  });

  test('pino level numbers are correct', () => {
    // Arrange
    const { stream, lines } = createCaptureStream();
    const logger = pino({ level: 'trace' }, stream);

    // Act
    logger.trace('t');
    logger.debug('d');
    logger.info('i');
    logger.warn('w');
    logger.error('e');
    logger.fatal('f');

    // Assert
    expect(lines.map((l) => l['level'])).toEqual([10, 20, 30, 40, 50, 60]);
  });
});

// ── Redaction ───────────────────────────────────────────────────────────────

describe('redaction', () => {
  test('redacts default sensitive fields (password, token, secret, authorization)', () => {
    // Arrange
    const { stream, lines } = createCaptureStream();
    const logger = pino(
      { level: 'info', redact: ['password', 'token', 'secret', 'authorization'] },
      stream,
    );

    // Act
    logger.info(
      { password: 's3cret', token: 'jwt-abc', secret: 'top', authorization: 'Bearer xyz' },
      'sensitive data',
    );

    // Assert
    expect(lines).toHaveLength(1);
    expect(lines[0]['password']).toBe('[Redacted]');
    expect(lines[0]['token']).toBe('[Redacted]');
    expect(lines[0]['secret']).toBe('[Redacted]');
    expect(lines[0]['authorization']).toBe('[Redacted]');
    expect(lines[0]['msg']).toBe('sensitive data');
  });

  test('respects custom redact list', () => {
    // Arrange
    const { stream, lines } = createCaptureStream();
    const logger = pino({ level: 'info', redact: ['apiKey'] }, stream);

    // Act
    logger.info({ apiKey: 'sk-123', password: 'visible' }, 'custom redact');

    // Assert
    expect(lines).toHaveLength(1);
    expect(lines[0]['apiKey']).toBe('[Redacted]');
    expect(lines[0]['password']).toBe('visible');
  });

  test('does not redact non-sensitive fields', () => {
    // Arrange
    const { stream, lines } = createCaptureStream();
    const logger = pino({ level: 'info' }, stream);

    // Act
    logger.info({ userId: 'u-1', action: 'login', email: 'a@b.com' }, 'normal data');

    // Assert
    expect(lines).toHaveLength(1);
    expect(lines[0]['userId']).toBe('u-1');
    expect(lines[0]['action']).toBe('login');
    expect(lines[0]['email']).toBe('a@b.com');
  });

  test('redacts nested sensitive fields', () => {
    // Arrange
    const { stream, lines } = createCaptureStream();
    const logger = pino(
      { level: 'info', redact: ['req.headers.authorization', 'body.token'] },
      stream,
    );

    // Act
    logger.info(
      { req: { headers: { authorization: 'Bearer secret' } }, body: { token: 'jwt' } },
      'nested redact',
    );

    // Assert
    expect(lines).toHaveLength(1);
    const req = lines[0]['req'] as Record<string, unknown>;
    const headers = req['headers'] as Record<string, unknown>;
    expect(headers['authorization']).toBe('[Redacted]');
    const body = lines[0]['body'] as Record<string, unknown>;
    expect(body['token']).toBe('[Redacted]');
  });
});
