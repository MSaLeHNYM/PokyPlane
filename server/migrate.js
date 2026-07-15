import { migrate } from './models/user.js';
import { pool } from './db.js';

migrate()
  .then(() => {
    console.log('[migrate] done');
    return pool.end();
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
