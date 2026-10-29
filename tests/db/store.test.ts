import type pg from 'pg';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { Store, type StoredChunk } from '../../src/db/store.js';
import { freshPool, TEST_DATABASE_URL } from '../helpers/db.js';

const chunk = (i: number): StoredChunk => ({
  chunkIndex: i, startSec: i * 35, endSec: i * 35 + 45, transcript: `t${i}`,
  frameDescription: null, framePath: `v1/${i}.jpg`, embedding: [1, 0, 0],
});

describe.skipIf(!TEST_DATABASE_URL)('Store', () => {
  let pool: pg.Pool;
  let store: Store;
  beforeEach(async () => {
    pool ??= await freshPool();
    await pool.query('TRUNCATE rag_videos CASCADE');
    store = new Store(pool);
  });
  afterAll(async () => pool?.end());

  it('registra solo los vídeos nuevos', async () => {
    expect(await store.registerVideos([{ videoId: 'v1', title: 'A', durationSec: 60 }])).toBe(1);
    expect(await store.registerVideos([
      { videoId: 'v1', title: 'A cambiado', durationSec: 60 },
      { videoId: 'v2', title: 'B', durationSec: null },
    ])).toBe(1);
    expect((await store.getVideo('v1'))?.title).toBe('A');
  });

  it('sustituye los fragmentos de un vídeo sin duplicarlos', async () => {
    await store.registerVideos([{ videoId: 'v1', title: 'A', durationSec: 60 }]);
    await store.replaceChunks('v1', [chunk(0), chunk(1), chunk(2)], 'youtube:es');
    await store.replaceChunks('v1', [chunk(0), chunk(1)], 'whisper:forced');
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM rag_chunks WHERE video_id = $1', ['v1']);
    expect(rows[0].n).toBe(2);
    const v = await pool.query('SELECT status, chunk_count, transcript_source FROM rag_videos');
    expect(v.rows[0]).toEqual({ status: 'done', chunk_count: 2, transcript_source: 'whisper:forced' });
  });

  it('si falla la inserción no deja fragmentos a medias', async () => {
    await store.registerVideos([{ videoId: 'v1', title: 'A', durationSec: 60 }]);
    await store.replaceChunks('v1', [chunk(0)], 'youtube:es');
    const bad = { ...chunk(1), embedding: [1, 0] }; // dimensión incorrecta
    await expect(store.replaceChunks('v1', [chunk(0), bad], 'youtube:es')).rejects.toThrow();
    const { rows } = await pool.query('SELECT chunk_index FROM rag_chunks');
    expect(rows).toEqual([{ chunk_index: 0 }]);
  });

  it('reintenta los errores hasta agotar los intentos', async () => {
    await store.registerVideos([
      { videoId: 'p', title: 'pendiente', durationSec: 1 },
      { videoId: 'e', title: 'error', durationSec: 1 },
      { videoId: 'n', title: 'sin subtítulos', durationSec: 1 },
    ]);
    await store.markFailed('e', 'error', 'boom');
    await store.markFailed('n', 'no_subtitles', 'sin subs');
    const ids = async (retryErrors = false) =>
      (await store.videosToProcess({ maxAttempts: 2, retryErrors })).map((v) => v.videoId).sort();
    expect(await ids()).toEqual(['e', 'p']);
    await store.markFailed('e', 'error', 'boom');
    expect(await ids()).toEqual(['p']);
    expect(await ids(true)).toEqual(['e', 'p']);
  });

  it('el candado impide dos ingestas a la vez', async () => {
    let inner: unknown;
    const outer = await store.withIngestLock(async () => {
      inner = await new Store(pool).withIngestLock(async () => 'no debería ejecutarse');
      return 'ok';
    });
    expect(outer).toEqual({ locked: true, result: 'ok' });
    expect(inner).toEqual({ locked: false });
    // Tras liberar, se puede volver a coger.
    expect(await store.withIngestLock(async () => 1)).toEqual({ locked: true, result: 1 });
  });
});
