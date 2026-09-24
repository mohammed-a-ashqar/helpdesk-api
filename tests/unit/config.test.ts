import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config/env.js';

describe('loadConfig', () => {
  it('applies defaults', () => {
    const config = loadConfig({});
    expect(config.env).toBe('development');
    expect(config.server).toEqual({ host: '0.0.0.0', port: 3000 });
    expect(config.logLevel).toBe('info');
  });

  it('coerces numeric values', () => {
    expect(loadConfig({ PORT: '8080' }).server.port).toBe(8080);
  });

  it('rejects invalid values with a readable message', () => {
    expect(() => loadConfig({ PORT: 'not-a-port' })).toThrow(/PORT/);
  });
});
