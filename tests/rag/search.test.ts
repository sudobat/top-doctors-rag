import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Store } from '../../src/db/store.js';
import { searchChunks } from '../../src/rag/search.js';
import { freshPool, TEST_DATABASE_URL } from '../helpers/db.js';

describe.skipIf(!TEST_DATABASE_URL)('searchChunks', () => {
  let pool: pg.Pool;
  beforeAll(async () => {
    pool = await freshPool();
    const store = new Store(pool);
    await store.registerVideos([{ videoId: 'v1', title: 'Agendas', durationSec: 100 }]);
    const c = (i: number, embedding: number[]) => ({
      chunkIndex: i, startSec: i * 35, endSec: i * 35 + 45, transcript: `t${i}`,
      frameDescription: `p${i}`, framePath: `v1/${i}.jpg`, embedding,
    });
    await store.replaceChunks('v1', [c(0, [1, 0, 0]), c(1, [0.8, 0.6, 0]), c(2, [0, 0, 1])], 'youtube:es');
  });
  afterAll(async () => pool?.end());

  it('ordena por similitud y descarta lo que no supera el umbral', async () => {
    const results = await searchChunks(pool, [1, 0, 0], { topK: 8, minSimilarity: 0.35 });
    expect(results.map((r) => r.transcript)).toEqual(['t0', 't1']);
    expect(results[0]).toMatchObject({ videoId: 'v1', title: 'Agendas', startSec: 0, framePath: 'v1/0.jpg', frameDescription: 'p0' });
    expect(results[0].similarity).toBeCloseTo(1);
    expect(results[1].similarity).toBeCloseTo(0.8);
  });

  it('respeta topK', async () => {
    expect(await searchChunks(pool, [1, 0, 0], { topK: 1, minSimilarity: 0 })).toHaveLength(1);
  });

  it('sin nada por encima del umbral devuelve una lista vacía', async () => {
    expect(await searchChunks(pool, [0, 1, 0], { topK: 8, minSimilarity: 0.9 })).toEqual([]);
  });
});
