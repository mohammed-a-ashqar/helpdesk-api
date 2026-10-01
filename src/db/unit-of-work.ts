import { RefreshTokenRepository } from '../modules/auth/refresh-token.repository.js';
import { ActivitiesRepository } from '../modules/tickets/activities.repository.js';
import { WorkloadRepository } from '../modules/tickets/assignment/workload.repository.js';
import { TicketsRepository } from '../modules/tickets/tickets.repository.js';
import { UsersRepository } from '../modules/users/users.repository.js';
import type { Database, DbExecutor } from './client.js';

export interface Repositories {
  users: UsersRepository;
  refreshTokens: RefreshTokenRepository;
  tickets: TicketsRepository;
  activities: ActivitiesRepository;
  workloads: WorkloadRepository;
}

function createRepositories(db: DbExecutor): Repositories {
  return {
    users: new UsersRepository(db),
    refreshTokens: new RefreshTokenRepository(db),
    tickets: new TicketsRepository(db),
    activities: new ActivitiesRepository(db),
    workloads: new WorkloadRepository(db),
  };
}

/**
 * Gives services repositories bound either to the connection pool or to a
 * single transaction, so a use case can commit several writes atomically
 * without repositories knowing about transactions.
 */
export class UnitOfWork {
  readonly repositories: Repositories;

  constructor(private readonly db: Database) {
    this.repositories = createRepositories(db);
  }

  transaction<T>(work: (repositories: Repositories) => Promise<T>): Promise<T> {
    return this.db.transaction((tx) => work(createRepositories(tx)));
  }
}
