import 'dotenv/config';
import { loadConfig } from '../config.js';
import { createPool } from './pool.js';
import { migrate } from './schema.js';

const config = loadConfig();
const pool = createPool(config.DATABASE_URL);
try {
  await migrate(pool, config.EMBEDDING_DIM);
  console.log('Esquema aplicado.');
} finally {
  await pool.end();
}
