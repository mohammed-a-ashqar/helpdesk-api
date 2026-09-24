import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config/env.js';

const REQUIRED = {
  DATABASE_URL: 'postgres://helpdesk:helpdesk@localhost:5432/helpdesk',
};

describe('loadConfig', () => {
  it('applies defaults', () => {
    const config = loadConfig(REQUIRED);
    expect(config.env).toBe('development');
    expect(config.server).toEqual({ host: '0.0.0.0', port: 3000 });
    expect(config.logLevel).toBe('info');
    expect(config.databaseUrl).toBe(REQUIRED.DATABASE_URL);
  });

  it('coerces numeric values', () => {
    expect(loadConfig({ ...REQUIRED, PORT: '8080' }).server.port).toBe(8080);
  });

  it('rejects invalid values with a readable message', () => {
    expect(() => loadConfig({ ...REQUIRED, PORT: 'not-a-port' })).toThrow(/PORT/);
  });

  it('requires a postgres connection string', () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
    expect(() => loadConfig({ DATABASE_URL: 'mysql://localhost/db' })).toThrow(/DATABASE_URL/);
  });
});
