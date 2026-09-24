import { createHash, randomBytes } from 'node:crypto';
import { jwtVerify, SignJWT } from 'jose';
import { z } from 'zod';
import type { Clock } from '../../shared/clock.js';
import { UnauthorizedError } from '../../shared/errors.js';
import { ROLES, type Role } from '../users/domain/role.js';

export interface TokenServiceOptions {
  accessTokenSecret: string;
  accessTokenTtlSeconds: number;
  refreshTokenTtlSeconds: number;
  issuer: string;
  audience: string;
}

export interface AccessTokenClaims {
  userId: string;
  role: Role;
}

export interface IssuedAccessToken {
  token: string;
  expiresIn: number;
}

export interface IssuedRefreshToken {
  /** Opaque value handed to the client exactly once. */
  token: string;
  /** What gets stored; a database leak does not leak usable tokens. */
  tokenHash: string;
  expiresAt: Date;
}

const claimsSchema = z.object({
  sub: z.uuid(),
  role: z.enum(ROLES),
});

/**
 * Short-lived JWT access tokens (HS256) and long-lived opaque refresh tokens.
 * Time comes from the injected clock, so expiry is testable without waiting.
 */
export class TokenService {
  private readonly key: Uint8Array;

  constructor(
    private readonly options: TokenServiceOptions,
    private readonly clock: Clock,
  ) {
    this.key = new TextEncoder().encode(options.accessTokenSecret);
  }

  async issueAccessToken(claims: AccessTokenClaims): Promise<IssuedAccessToken> {
    const issuedAt = Math.floor(this.clock.now().getTime() / 1000);
    const token = await new SignJWT({ role: claims.role })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(claims.userId)
      .setIssuer(this.options.issuer)
      .setAudience(this.options.audience)
      .setIssuedAt(issuedAt)
      .setExpirationTime(issuedAt + this.options.accessTokenTtlSeconds)
      .sign(this.key);
    return { token, expiresIn: this.options.accessTokenTtlSeconds };
  }

  async verifyAccessToken(token: string): Promise<AccessTokenClaims> {
    try {
      const { payload } = await jwtVerify(token, this.key, {
        algorithms: ['HS256'],
        issuer: this.options.issuer,
        audience: this.options.audience,
        currentDate: this.clock.now(),
      });
      const claims = claimsSchema.parse(payload);
      return { userId: claims.sub, role: claims.role };
    } catch {
      throw new UnauthorizedError('The access token is invalid or has expired.');
    }
  }

  issueRefreshToken(): IssuedRefreshToken {
    const token = randomBytes(32).toString('base64url');
    return {
      token,
      tokenHash: this.hashRefreshToken(token),
      expiresAt: new Date(this.clock.now().getTime() + this.options.refreshTokenTtlSeconds * 1000),
    };
  }

  /**
   * Refresh tokens carry 256 bits of randomness, so a fast hash is enough
   * (no salt or key stretching needed, unlike passwords).
   */
  hashRefreshToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
