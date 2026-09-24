import 'dotenv/config';
import { buildApp } from './app.js';
import { loadConfig } from './config/env.js';
import { createContainer } from './container.js';
import { createPostgresDatabase } from './db/client.js';
import { systemClock } from './shared/clock.js';

const config = loadConfig();
const database = createPostgresDatabase(config.databaseUrl);
const container = createContainer({ config, db: database.db, clock: systemClock });
const app = await buildApp(config, container);

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info({ signal }, 'shutting down');
  await app.close();
  await database.close();
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void shutdown(signal).then(() => process.exit(0));
  });
}

try {
  await app.listen({ host: config.server.host, port: config.server.port });
} catch (error) {
  app.log.fatal({ err: error }, 'failed to start');
  await database.close();
  process.exit(1);
}
