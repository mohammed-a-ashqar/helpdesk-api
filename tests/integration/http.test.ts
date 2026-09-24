import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../support/test-app.js';

describe('HTTP platform', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(async () => {
    await t.close();
  });

  it('reports health including the database check', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/health' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ok', checks: { database: 'up' } });
  });

  it('assigns a request id and echoes it in the response headers', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/health' });
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('propagates a well-formed incoming request id', async () => {
    const res = await t.app.inject({
      method: 'GET',
      url: '/health',
      headers: { 'x-request-id': 'trace-abc-123' },
    });
    expect(res.headers['x-request-id']).toBe('trace-abc-123');
  });

  it('replaces a malformed incoming request id', async () => {
    const res = await t.app.inject({
      method: 'GET',
      url: '/health',
      headers: { 'x-request-id': 'bad id with spaces' },
    });
    expect(res.headers['x-request-id']).not.toBe('bad id with spaces');
  });

  it('answers unknown routes with a problem document', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/nope?x=1' });

    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.json()).toMatchObject({
      type: 'urn:problem-type:route-not-found',
      title: 'Not Found',
      status: 404,
      requestId: res.headers['x-request-id'],
    });
  });

  it('sets security headers', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/health' });
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['strict-transport-security']).toBeDefined();
  });

  it('allows configured CORS origins only', async () => {
    const allowed = await t.app.inject({
      method: 'OPTIONS',
      url: '/health',
      headers: { origin: 'https://app.example.com', 'access-control-request-method': 'GET' },
    });
    expect(allowed.headers['access-control-allow-origin']).toBe('https://app.example.com');

    const denied = await t.app.inject({
      method: 'OPTIONS',
      url: '/health',
      headers: { origin: 'https://evil.example.com', 'access-control-request-method': 'GET' },
    });
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('serves the OpenAPI document and Swagger UI', async () => {
    const spec = await t.app.inject({ method: 'GET', url: '/docs/json' });
    expect(spec.statusCode).toBe(200);
    expect(spec.json()).toMatchObject({ openapi: '3.0.3', info: { title: 'Helpdesk API' } });
    expect(Object.keys(spec.json<{ paths: object }>().paths)).toContain('/health');

    const ui = await t.app.inject({ method: 'GET', url: '/docs/' });
    expect(ui.statusCode).toBe(200);
    expect(ui.headers['content-type']).toContain('text/html');
  });
});
