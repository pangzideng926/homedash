import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createDatabase } from './db/index.js';

function main(): void {
  const config = loadConfig();
  const database = createDatabase(config.DATABASE_URL);
  const app = createApp(config, database.db);

  const server = serve(
    {
      fetch: app.fetch,
      hostname: config.HOST,
      port: config.PORT,
    },
    (info) => {
      console.log(`homedash 服务已启动：http://${info.address}:${info.port}（${config.NODE_ENV}）`);
    },
  );

  const shutdown = (signal: string) => {
    console.log(`收到 ${signal} 信号，正在关闭服务...`);
    server.close(() => {
      database.close();
      process.exit(0);
    });
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main();
