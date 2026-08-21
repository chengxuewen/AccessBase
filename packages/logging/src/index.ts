import pino from 'pino';

/**
 * Log levels
 */
export type LogLevel = 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace';

/**
 * Logger config
 */
export interface LoggerConfig {
  level: LogLevel;
  pretty?: boolean;
  redact?: string[];
}

/**
 * Create a logger instance
 */
export function createLogger(config: LoggerConfig): pino.Logger {
  return pino({
    level: config.level,
    transport: config.pretty
      ? {
          target: 'pino-pretty',
          options: {
            colorize: true,
          },
        }
      : undefined,
    redact: config.redact || ['password', 'token', 'secret', 'authorization'],
  });
}

/**
 * Default logger
 */
export const logger = createLogger({
  level: (process.env['LOG_LEVEL'] as LogLevel) || 'info',
  pretty: process.env['NODE_ENV'] === 'development',
});
