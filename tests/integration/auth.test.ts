import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../support/test-app.js';

interface AuthBody {
  user: { id: string; email: string; role: string };
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  tokenType: string;
}

const PASSWORD = 'a-long-enough-password';

describe('auth', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });

  beforeEach(async () => {
    await t.database.reset();
  });

  afterAll(async () => {
    await t.close();
  });

  const register = (email = 'Jane@Example.com', password = PASSWORD) =>
    t.app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email, name: 'Jane Customer', password },
    });

  const login = (email: string, password: string) =>
    t.app.inject({ method: 'POST', url: '/auth/login', payload: { email, password } });

  const refresh = (refreshToken: string) =>
    t.app.inject({ method: 'POST', url: '/auth/refresh', payload: { refreshToken } });

  describe('register', () => {
    it('creates a customer and returns a session', async () => {
      const res = await register();

      expect(res.statusCode).toBe(201);
      const body = res.json<AuthBody>();
      expect(body.user).toMatchObject({ email: 'jane@example.com', role: 'customer' });
      expect(body.user).not.toHaveProperty('passwordHash');
      expect(body.tokenType).toBe('Bearer');
      expect(body.expiresIn).toBe(900);
      await expect(t.container.tokens.verifyAccessToken(body.accessToken)).resolves.toEqual({
        userId: body.user.id,
        role: 'customer',
      });
    });

    it('rejects a duplicate email regardless of case', async () => {
      await register('jane@example.com');
      const res = await register('JANE@example.com');

      expect(res.statusCode).toBe(409);
      expect(res.json()).toMatchObject({ type: 'urn:problem-type:email-taken', status: 409 });
    });

    it('validates the payload and reports field errors', async () => {
      const res = await t.app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: { email: 'not-an-email', name: '', password: 'short' },
      });

      expect(res.statusCode).toBe(400);
      expect(res.headers['content-type']).toContain('application/problem+json');
      const paths = res.json<{ errors: { path: string }[] }>().errors.map((e) => e.path);
      expect(paths).toEqual(expect.arrayContaining(['body.email', 'body.name', 'body.password']));
    });
  });

  describe('login', () => {
    it('returns tokens for valid credentials', async () => {
      await register();
      const res = await login('jane@example.com', PASSWORD);

      expect(res.statusCode).toBe(200);
      expect(res.json<AuthBody>().refreshToken).toEqual(expect.any(String));
    });

    it('gives the same answer for a wrong password and an unknown email', async () => {
      await register();
      const wrongPassword = await login('jane@example.com', 'wrong-password!');
      const unknownEmail = await login('nobody@example.com', PASSWORD);

      expect(wrongPassword.statusCode).toBe(401);
      expect(unknownEmail.statusCode).toBe(401);
      expect(wrongPassword.json<{ detail: string }>().detail).toBe(
        unknownEmail.json<{ detail: string }>().detail,
      );
    });
  });

  describe('refresh token rotation', () => {
    it('issues a new pair and consumes the old refresh token', async () => {
      const session = (await register()).json<AuthBody>();

      const rotated = await refresh(session.refreshToken);
      expect(rotated.statusCode).toBe(200);
      const next = rotated.json<AuthBody>();
      expect(next.refreshToken).not.toBe(session.refreshToken);

      const replay = await refresh(session.refreshToken);
      expect(replay.statusCode).toBe(401);
    });

    it('revokes the whole family when a used token is replayed', async () => {
      const session = (await register()).json<AuthBody>();
      const next = (await refresh(session.refreshToken)).json<AuthBody>();

      // An attacker replays the stolen, already-used token...
      expect((await refresh(session.refreshToken)).statusCode).toBe(401);
      // ...which also kills the legitimate descendant.
      expect((await refresh(next.refreshToken)).statusCode).toBe(401);
    });

    it('rejects expired refresh tokens', async () => {
      const session = (await register()).json<AuthBody>();
      t.clock.advance({ hours: 14 * 24 + 1 });

      expect((await refresh(session.refreshToken)).statusCode).toBe(401);
    });

    it('rejects unknown tokens', async () => {
      const res = await refresh('does-not-exist');
      expect(res.statusCode).toBe(401);
      expect(res.json()).toMatchObject({ type: 'urn:problem-type:unauthorized' });
    });
  });

  describe('logout', () => {
    it('revokes the session and is idempotent', async () => {
      const session = (await register()).json<AuthBody>();

      const first = await t.app.inject({
        method: 'POST',
        url: '/auth/logout',
        payload: { refreshToken: session.refreshToken },
      });
      const second = await t.app.inject({
        method: 'POST',
        url: '/auth/logout',
        payload: { refreshToken: session.refreshToken },
      });

      expect(first.statusCode).toBe(204);
      expect(second.statusCode).toBe(204);
      expect((await refresh(session.refreshToken)).statusCode).toBe(401);
    });
  });

  it('documents the auth endpoints in the OpenAPI spec', async () => {
    const spec = (await t.app.inject({ method: 'GET', url: '/docs/json' })).json<{
      paths: Record<string, unknown>;
    }>();
    expect(Object.keys(spec.paths)).toEqual(
      expect.arrayContaining(['/auth/register', '/auth/login', '/auth/refresh', '/auth/logout']),
    );
  });
});

describe('auth rate limiting', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp({ authRateLimitMax: 3 });
  });

  afterAll(async () => {
    await t.close();
  });

  it('throttles repeated login attempts with a 429 problem', async () => {
    const attempt = () =>
      t.app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'x@example.com', password: 'whatever-password' },
      });

    for (let i = 0; i < 3; i += 1) {
      expect((await attempt()).statusCode).toBe(401);
    }
    const limited = await attempt();

    expect(limited.statusCode).toBe(429);
    expect(limited.headers['content-type']).toContain('application/problem+json');
    expect(limited.json()).toMatchObject({ status: 429, type: 'urn:problem-type:rate-limited' });
    expect(limited.headers['retry-after']).toBeDefined();
  });
});
