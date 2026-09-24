import { SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import { TokenService, type TokenServiceOptions } from '../../../src/modules/auth/token.service.js';
import { UnauthorizedError } from '../../../src/shared/errors.js';
import { FakeClock } from '../../support/fake-clock.js';

const OPTIONS: TokenServiceOptions = {
  accessTokenSecret: 'test-secret-that-is-at-least-32-characters-long',
  accessTokenTtlSeconds: 900,
  refreshTokenTtlSeconds: 7 * 24 * 3600,
  issuer: 'helpdesk-api',
  audience: 'helpdesk-api',
};
const USER_ID = '0b9c7a2e-4a53-4f3e-9d1a-2f4d7d1c9a11';

describe('TokenService', () => {
  it('issues an access token that verifies back to the same claims', async () => {
    const tokens = new TokenService(OPTIONS, new FakeClock());

    const issued = await tokens.issueAccessToken({ userId: USER_ID, role: 'agent' });

    expect(issued.expiresIn).toBe(900);
    await expect(tokens.verifyAccessToken(issued.token)).resolves.toEqual({
      userId: USER_ID,
      role: 'agent',
    });
  });

  it('rejects an access token once it has expired', async () => {
    const clock = new FakeClock();
    const tokens = new TokenService(OPTIONS, clock);
    const { token } = await tokens.issueAccessToken({ userId: USER_ID, role: 'customer' });

    clock.advance({ seconds: 899 });
    await expect(tokens.verifyAccessToken(token)).resolves.toBeDefined();

    clock.advance({ seconds: 2 });
    await expect(tokens.verifyAccessToken(token)).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('rejects tokens signed with another secret', async () => {
    const clock = new FakeClock();
    const other = new TokenService({ ...OPTIONS, accessTokenSecret: 'x'.repeat(40) }, clock);
    const { token } = await other.issueAccessToken({ userId: USER_ID, role: 'admin' });

    await expect(new TokenService(OPTIONS, clock).verifyAccessToken(token)).rejects.toThrow(
      /invalid or has expired/,
    );
  });

  it('rejects tokens for another audience', async () => {
    const clock = new FakeClock();
    const other = new TokenService({ ...OPTIONS, audience: 'another-api' }, clock);
    const { token } = await other.issueAccessToken({ userId: USER_ID, role: 'admin' });

    await expect(new TokenService(OPTIONS, clock).verifyAccessToken(token)).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
  });

  it('rejects correctly signed tokens with unexpected claims', async () => {
    const clock = new FakeClock();
    const now = Math.floor(clock.now().getTime() / 1000);
    const forged = await new SignJWT({ role: 'superuser' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(USER_ID)
      .setIssuer(OPTIONS.issuer)
      .setAudience(OPTIONS.audience)
      .setIssuedAt(now)
      .setExpirationTime(now + 60)
      .sign(new TextEncoder().encode(OPTIONS.accessTokenSecret));

    await expect(new TokenService(OPTIONS, clock).verifyAccessToken(forged)).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
  });

  it('rejects garbage', async () => {
    await expect(
      new TokenService(OPTIONS, new FakeClock()).verifyAccessToken('not.a.jwt'),
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('issues unique opaque refresh tokens and stores only their hash', () => {
    const clock = new FakeClock('2025-01-01T00:00:00.000Z');
    const tokens = new TokenService(OPTIONS, clock);

    const first = tokens.issueRefreshToken();
    const second = tokens.issueRefreshToken();

    expect(first.token).not.toBe(second.token);
    expect(first.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(first.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(first.tokenHash).not.toContain(first.token);
    expect(tokens.hashRefreshToken(first.token)).toBe(first.tokenHash);
    expect(first.expiresAt.toISOString()).toBe('2025-01-08T00:00:00.000Z');
  });
});
