import { and, eq, isNull } from 'drizzle-orm';
import type { DbExecutor } from '../../db/client.js';
import { refreshTokens, type RefreshTokenRow } from '../../db/schema.js';

export interface NewRefreshToken {
  userId: string;
  familyId: string;
  tokenHash: string;
  expiresAt: Date;
}

export class RefreshTokenRepository {
  constructor(private readonly db: DbExecutor) {}

  async findByHash(tokenHash: string): Promise<RefreshTokenRow | undefined> {
    const [row] = await this.db
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, tokenHash));
    return row;
  }

  async create(input: NewRefreshToken): Promise<RefreshTokenRow> {
    const [row] = await this.db.insert(refreshTokens).values(input).returning();
    if (!row) throw new Error('Insert into refresh_tokens returned no row');
    return row;
  }

  /**
   * Atomically marks a token as used. Returns false when it was already
   * revoked, which means a concurrent request (or an attacker) used it first.
   */
  async markRotated(id: string, replacedById: string, at: Date): Promise<boolean> {
    const rows = await this.db
      .update(refreshTokens)
      .set({ revokedAt: at, replacedById })
      .where(and(eq(refreshTokens.id, id), isNull(refreshTokens.revokedAt)))
      .returning({ id: refreshTokens.id });
    return rows.length === 1;
  }

  async revokeFamily(familyId: string, at: Date): Promise<void> {
    await this.db
      .update(refreshTokens)
      .set({ revokedAt: at })
      .where(and(eq(refreshTokens.familyId, familyId), isNull(refreshTokens.revokedAt)));
  }
}
