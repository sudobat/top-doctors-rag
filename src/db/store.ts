import type pg from 'pg';
import { toVectorLiteral } from './pool.js';

export type VideoStatus = 'pending' | 'done' | 'error' | 'no_subtitles';

export interface VideoRow {
  videoId: string;
  title: string;
  durationSec: number | null;
  status: VideoStatus;
  attempts: number;
}

export interface StoredChunk {
  chunkIndex: number;
  startSec: number;
  endSec: number;
  transcript: string;
  frameDescription: string | null;
  framePath: string | null;
  embedding: number[];
}

/** Clave arbitraria pero fija para pg_try_advisory_lock de la ingesta. */
const INGEST_LOCK_KEY = 74_210_513;

export class Store {
  constructor(private readonly pool: pg.Pool) {}

  /** Registra como `pending` los vídeos que aún no existen. Devuelve cuántos son nuevos. */
  async registerVideos(videos: { videoId: string; title: string; durationSec: number | null }[]): Promise<number> {
    if (videos.length === 0) return 0;
    const res = await this.pool.query(
      `INSERT INTO rag_videos (video_id, title, duration_sec)
       SELECT * FROM unnest($1::text[], $2::text[], $3::int[])
       ON CONFLICT (video_id) DO NOTHING`,
      [videos.map((v) => v.videoId), videos.map((v) => v.title), videos.map((v) => v.durationSec)],
    );
    return res.rowCount ?? 0;
  }

  /** Vídeos pendientes de procesar, más los fallidos con intentos disponibles. */
  async videosToProcess(opts: { maxAttempts: number; retryErrors: boolean; limit?: number }): Promise<VideoRow[]> {
    const res = await this.pool.query(
      `SELECT video_id, title, duration_sec, status, attempts FROM rag_videos
       WHERE status = 'pending'
          OR (status = 'error' AND ($2 OR attempts < $1))
       ORDER BY created_at, video_id
       LIMIT $3`,
      [opts.maxAttempts, opts.retryErrors, opts.limit ?? null],
    );
    return res.rows.map(rowToVideo);
  }

  async getVideo(videoId: string): Promise<VideoRow | null> {
    const res = await this.pool.query(
      `SELECT video_id, title, duration_sec, status, attempts FROM rag_videos WHERE video_id = $1`,
      [videoId],
    );
    return res.rows[0] ? rowToVideo(res.rows[0]) : null;
  }

  /** Sustituye todos los fragmentos del vídeo y lo marca como `done`, en una sola transacción. */
  async replaceChunks(videoId: string, chunks: StoredChunk[], transcriptSource: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM rag_chunks WHERE video_id = $1', [videoId]);
      for (const c of chunks) {
        await client.query(
          `INSERT INTO rag_chunks
             (video_id, chunk_index, start_sec, end_sec, transcript, frame_description, frame_path, embedding)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8::vector)`,
          [videoId, c.chunkIndex, c.startSec, c.endSec, c.transcript, c.frameDescription, c.framePath,
            toVectorLiteral(c.embedding)],
        );
      }
      await client.query(
        `UPDATE rag_videos SET status = 'done', transcript_source = $2, chunk_count = $3,
           last_error = NULL, attempts = attempts + 1, updated_at = now()
         WHERE video_id = $1`,
        [videoId, transcriptSource, chunks.length],
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async markFailed(videoId: string, status: 'error' | 'no_subtitles', message: string): Promise<void> {
    await this.pool.query(
      `UPDATE rag_videos SET status = $2, last_error = $3, attempts = attempts + 1, updated_at = now()
       WHERE video_id = $1`,
      [videoId, status, message.slice(0, 2000)],
    );
  }

  /**
   * Ejecuta `fn` con el candado de ingesta. Si otra ejecución lo tiene, devuelve `{ locked: false }`
   * sin ejecutar nada. El candado es de sesión, así que se usa una conexión dedicada.
   */
  async withIngestLock<T>(fn: () => Promise<T>): Promise<{ locked: true; result: T } | { locked: false }> {
    const client = await this.pool.connect();
    try {
      const { rows } = await client.query('SELECT pg_try_advisory_lock($1) AS ok', [INGEST_LOCK_KEY]);
      if (!rows[0].ok) return { locked: false };
      try {
        return { locked: true, result: await fn() };
      } finally {
        await client.query('SELECT pg_advisory_unlock($1)', [INGEST_LOCK_KEY]);
      }
    } finally {
      client.release();
    }
  }
}

function rowToVideo(r: Record<string, unknown>): VideoRow {
  return {
    videoId: r.video_id as string,
    title: r.title as string,
    durationSec: r.duration_sec as number | null,
    status: r.status as VideoStatus,
    attempts: r.attempts as number,
  };
}
