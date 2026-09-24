import { sql } from 'drizzle-orm';
import type { DbExecutor } from '../../db/client.js';

export interface HealthReport {
  status: 'ok' | 'degraded';
  uptimeSeconds: number;
  checks: { database: 'up' | 'down' };
}

export class HealthService {
  constructor(private readonly db: DbExecutor) {}

  async check(): Promise<HealthReport> {
    const database = await this.pingDatabase();
    return {
      status: database === 'up' ? 'ok' : 'degraded',
      uptimeSeconds: Math.round(process.uptime()),
      checks: { database },
    };
  }

  private async pingDatabase(): Promise<'up' | 'down'> {
    try {
      await this.db.execute(sql`select 1`);
      return 'up';
    } catch {
      return 'down';
    }
  }
}
