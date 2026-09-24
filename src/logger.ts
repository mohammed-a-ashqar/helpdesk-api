import { pino, type Logger } from 'pino';
import type { AppConfig } from './config/env.js';

/** Structured JSON logs in production, human-readable output in development. */
export function createLogger(config: Pick<AppConfig, 'env' | 'logLevel'>): Logger {
  return pino({
    level: config.logLevel,
    redact: ['req.headers.authorization', 'req.headers.cookie'],
    ...(config.env === 'development'
      ? { transport: { target: 'pino-pretty', options: { translateTime: 'SYS:HH:MM:ss' } } }
      : {}),
  });
}
