import { asc, eq } from 'drizzle-orm';
import type { DbExecutor } from '../../db/client.js';
import { ticketActivities, type ActivityRow } from '../../db/schema.js';
import type { ActivityType } from './domain/activity.js';

export interface NewActivity {
  ticketId: string;
  actorId: string | null;
  type: ActivityType;
  data?: Record<string, unknown>;
  createdAt: Date;
}

/** Append-only audit trail of everything that happened to a ticket. */
export class ActivitiesRepository {
  constructor(private readonly db: DbExecutor) {}

  async record(activity: NewActivity): Promise<void> {
    await this.db.insert(ticketActivities).values({ ...activity, data: activity.data ?? {} });
  }

  listForTicket(ticketId: string): Promise<ActivityRow[]> {
    return this.db
      .select()
      .from(ticketActivities)
      .where(eq(ticketActivities.ticketId, ticketId))
      .orderBy(asc(ticketActivities.sequence));
  }
}
