import { randomUUID } from 'node:crypto';
import type { UserRow } from '../../db/schema.js';
import type { Repositories, UnitOfWork } from '../../db/unit-of-work.js';
import type { Clock } from '../../shared/clock.js';
import { UnauthorizedError } from '../../shared/errors.js';
import type { PasswordHasher } from './password-hasher.js';
import type { TokenService } from './token.service.js';

export interface AuthSession {
  user: UserRow;
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
  refreshTokenExpiresAt: Date;
}

export interface Credentials {
  email: string;
  password: string;
}

type RefreshOutcome = { kind: 'rotated'; session: AuthSession } | { kind: 'rejected' };

const INVALID_CREDENTIALS = 'Email or password is incorrect.';
const INVALID_REFRESH_TOKEN = 'The refresh token is invalid, expired or already used.';

export class AuthService {
  private dummyHash: Promise<string> | undefined;

  constructor(
    private readonly uow: UnitOfWork,
    private readonly hasher: PasswordHasher,
    private readonly tokens: TokenService,
    private readonly clock: Clock,
  ) {}

  /** Self-service sign-up always creates a customer account. */
  async register(input: Credentials & { name: string }): Promise<AuthSession> {
    const email = normalizeEmail(input.email);
    const passwordHash = await this.hasher.hash(input.password);

    return this.uow.transaction(async (repos) => {
      const user = await repos.users.create({
        email,
        name: input.name,
        passwordHash,
        role: 'customer',
      });
      return this.startSession(repos, user, randomUUID());
    });
  }

  async login(input: Credentials): Promise<AuthSession> {
    const user = await this.uow.repositories.users.findByEmail(normalizeEmail(input.email));

    if (!user) {
      // Spend the same time as a real check so response timing does not
      // reveal which emails are registered.
      await this.hasher.verify(await this.getDummyHash(), input.password);
      throw new UnauthorizedError(INVALID_CREDENTIALS);
    }
    if (!(await this.hasher.verify(user.passwordHash, input.password)) || !user.isActive) {
      throw new UnauthorizedError(INVALID_CREDENTIALS);
    }

    return this.uow.transaction((repos) => this.startSession(repos, user, randomUUID()));
  }

  /**
   * Refresh token rotation: every refresh token is single-use. Presenting a
   * token that was already rotated means it leaked, so the whole family
   * (every token descended from the same login) is revoked.
   */
  async refresh(refreshToken: string): Promise<AuthSession> {
    const tokenHash = this.tokens.hashRefreshToken(refreshToken);
    const now = this.clock.now();

    // The transaction must commit even when the token is rejected, so that a
    // detected reuse really does revoke the family; hence the outcome value.
    const outcome = await this.uow.transaction(async (repos): Promise<RefreshOutcome> => {
      const stored = await repos.refreshTokens.findByHash(tokenHash);
      if (!stored || stored.expiresAt <= now) {
        return { kind: 'rejected' };
      }
      if (stored.revokedAt) {
        await repos.refreshTokens.revokeFamily(stored.familyId, now);
        return { kind: 'rejected' };
      }

      const user = await repos.users.findById(stored.userId);
      if (!user?.isActive) {
        await repos.refreshTokens.revokeFamily(stored.familyId, now);
        return { kind: 'rejected' };
      }

      const { session, refreshTokenId } = await this.createSession(repos, user, stored.familyId);
      if (!(await repos.refreshTokens.markRotated(stored.id, refreshTokenId, now))) {
        // Lost a race with another request presenting the same token.
        await repos.refreshTokens.revokeFamily(stored.familyId, now);
        return { kind: 'rejected' };
      }
      return { kind: 'rotated', session };
    });

    if (outcome.kind === 'rejected') {
      throw new UnauthorizedError(INVALID_REFRESH_TOKEN);
    }
    return outcome.session;
  }

  /** Revokes the session the refresh token belongs to. Idempotent. */
  async logout(refreshToken: string): Promise<void> {
    const stored = await this.uow.repositories.refreshTokens.findByHash(
      this.tokens.hashRefreshToken(refreshToken),
    );
    if (stored) {
      await this.uow.repositories.refreshTokens.revokeFamily(stored.familyId, this.clock.now());
    }
  }

  private async startSession(
    repos: Repositories,
    user: UserRow,
    familyId: string,
  ): Promise<AuthSession> {
    return (await this.createSession(repos, user, familyId)).session;
  }

  private async createSession(
    repos: Repositories,
    user: UserRow,
    familyId: string,
  ): Promise<{ session: AuthSession; refreshTokenId: string }> {
    const access = await this.tokens.issueAccessToken({ userId: user.id, role: user.role });
    const refresh = this.tokens.issueRefreshToken();
    const stored = await repos.refreshTokens.create({
      userId: user.id,
      familyId,
      tokenHash: refresh.tokenHash,
      expiresAt: refresh.expiresAt,
    });
    return {
      refreshTokenId: stored.id,
      session: {
        user,
        accessToken: access.token,
        expiresIn: access.expiresIn,
        refreshToken: refresh.token,
        refreshTokenExpiresAt: refresh.expiresAt,
      },
    };
  }

  private getDummyHash(): Promise<string> {
    this.dummyHash ??= this.hasher.hash('dummy-password-for-timing-equalization');
    return this.dummyHash;
  }
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
