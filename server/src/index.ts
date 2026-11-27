import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import {
  collectSecretValues,
  ConfigError,
  createSafeLogger,
  formatConfigError,
  loadConfig,
  type AppConfig,
} from './config/index.js';
import { createDatabase } from './db/index.js';

function main(): void {
  let config: AppConfig;
  try {
    config = loadConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(formatConfigError(error));
    } else {
      console.error('加载配置失败，请检查环境变量或 .env 文件。');
    }
    process.exit(1);
  }

  const logger = createSafeLogger(collectSecretValues(config));
  const database = createDatabase(config.app.DATABASE_URL);
  const app = createApp(config, database.db);

  const server = serve(
    {
      fetch: app.fetch,
      hostname: config.app.HOST,
      port: config.app.PORT,
    },
    (info) => {
      logger.info(
        `homedash 服务已启动：http://${info.address}:${info.port}（${config.app.NODE_ENV}）`,
      );
    },
  );

  const shutdown = (signal: string) => {
    logger.info(`收到 ${signal} 信号，正在关闭服务...`);
    server.close(() => {
      database.close();
      process.exit(0);
    });
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main();
