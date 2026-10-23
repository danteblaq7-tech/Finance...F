import { createApp } from './app.js';
import { config } from './config.js';
import { pool } from './db.js';

try {
  await pool.query('SELECT 1');
} catch (e) {
  console.error(`\n✖ Cannot connect to MySQL at ${config.db.host}:${config.db.port} (database "${config.db.database}").`);
  console.error(`  ${e.code || ''} ${e.message}`);
  console.error('  Check DB_HOST / DB_USER / DB_PASSWORD / DB_NAME in backend/.env and that MySQL is running.\n');
  process.exit(1);
}

const server = createApp().listen(config.port, () => {
  console.log(`✔ Finesse API running on http://localhost:${config.port}  (database: ${config.db.database})`);
});

const shutdown = () => server.close(() => pool.end().then(() => process.exit(0)));
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
