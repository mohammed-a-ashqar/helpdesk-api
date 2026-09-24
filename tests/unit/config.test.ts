import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config/env.js';

const REQUIRED = {
  DATABASE_URL: 'postgres://helpdesk:helpdesk@localhost:5432/helpdesk',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
};

describe('loadConfig', () => {
  it('applies defaults', () => {
    const config = loadConfig(REQUIRED);
    expect(config.env).toBe('development');
    expect(config.server).toEqual({ host: '0.0.0.0', port: 3000, trustProxy: false });
    expect(config.http.corsOrigins).toEqual([]);
    expect(config.logLevel).toBe('info');
    expect(config.databaseUrl).toBe(REQUIRED.DATABASE_URL);
    expect(config.auth.accessTokenTtlSeconds).toBe(900);
    expect(config.auth.refreshTokenTtlSeconds).toBe(14 * 24 * 3600);
  });

  it('coerces numeric values', () => {
    expect(loadConfig({ ...REQUIRED, PORT: '8080' }).server.port).toBe(8080);
  });

  it('parses flags and comma-separated lists', () => {
    const config = loadConfig({
      ...REQUIRED,
      TRUST_PROXY: 'true',
      CORS_ORIGINS: 'https://a.example, https://b.example,',
    });
    expect(config.server.trustProxy).toBe(true);
    expect(config.http.corsOrigins).toEqual(['https://a.example', 'https://b.example']);
  });

  it('rejects invalid values with a readable message', () => {
    expect(() => loadConfig({ ...REQUIRED, PORT: 'not-a-port' })).toThrow(/PORT/);
  });

  it('requires a strong JWT secret', () => {
    expect(() => loadConfig({ ...REQUIRED, JWT_ACCESS_SECRET: 'short' })).toThrow(
      /JWT_ACCESS_SECRET: must be at least 32 characters/,
    );
  });

  it('requires a postgres connection string', () => {
    expect(() => loadConfig({ JWT_ACCESS_SECRET: REQUIRED.JWT_ACCESS_SECRET })).toThrow(
      /DATABASE_URL/,
    );
    expect(() => loadConfig({ ...REQUIRED, DATABASE_URL: 'mysql://localhost/db' })).toThrow(
      /DATABASE_URL/,
    );
  });
});
