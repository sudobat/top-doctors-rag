import type pg from 'pg';
import { createPool } from '../../src/db/pool.js';
import { migrate } from '../../src/db/schema.js';

/** Base de datos de pruebas con pgvector. Si no está definida, los tests de BD se omiten. */
export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
export const TEST_DIM = 3;

export async function freshPool(): Promise<pg.Pool> {
  const pool = createPool(TEST_DATABASE_URL!);
  await pool.query('DROP TABLE IF EXISTS rag_chunks, rag_videos CASCADE');
  await migrate(pool, TEST_DIM);
  return pool;
}
