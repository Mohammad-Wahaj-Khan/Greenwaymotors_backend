import { createServer } from 'node:http';
import { loadConfig } from './config/index.js';
import { createApp } from './app.js';
import { createPostgresPool } from './core/db/database.js';
import { createRedisClient } from './integrations/redis/redis.js';
import { createLogger } from './core/logging/logger.js';
import { createEmailService } from './integrations/email/email.service.js';
import { startOutboxWorker } from './integrations/outbox/outbox-worker.js';
const { environment: env } = loadConfig();
const logger = createLogger(env);
const database = createPostgresPool(env);
const redis = createRedisClient(env);
const email = createEmailService(env);
const outboxWorker = startOutboxWorker(database.db, env, email, logger);
const app = createApp(env, { database, redis });
const server = createServer(app);
server.requestTimeout = 30_000;
server.headersTimeout = 35_000;
server.keepAliveTimeout = 65_000;
let shuttingDown = false;
async function shutdown(signal, exitCode) {
    if (shuttingDown) {
        return;
    }
    shuttingDown = true;
    logger.info({ signal }, 'graceful shutdown started');
    server.close((error) => {
        if (error) {
            logger.error({ err: error }, 'http server close failed');
        }
    });
    const forcedExit = setTimeout(() => {
        logger.error('graceful shutdown timed out');
        process.exit(1);
    }, 10_000);
    forcedExit.unref();
    try {
        await outboxWorker.stop();
        await Promise.all([database.close(), redis.close()]);
        logger.info('graceful shutdown complete');
        process.exit(exitCode);
    }
    catch (error) {
        logger.fatal({ err: error }, 'graceful shutdown failed');
        process.exit(1);
    }
}
process.on('SIGTERM', () => void shutdown('SIGTERM', 0));
process.on('SIGINT', () => void shutdown('SIGINT', 0));
process.on('uncaughtException', (error) => {
    logger.fatal({ err: error }, 'uncaught exception');
    void shutdown('uncaughtException', 1);
});
process.on('unhandledRejection', (reason) => {
    logger.fatal({ err: reason }, 'unhandled rejection');
    void shutdown('unhandledRejection', 1);
});
server.listen(env.PORT, () => {
    logger.info({ port: env.PORT }, 'API listening');
});
//# sourceMappingURL=server.js.map