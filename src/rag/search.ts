import type pg from 'pg';
import { toVectorLiteral } from '../db/pool.js';

export interface SearchResult {
  videoId: string;
  title: string;
  startSec: number;
  endSec: number;
  transcript: string;
  frameDescription: string | null;
  framePath: string | null;
  similarity: number;
}

/** Fragmentos más similares por coseno que superan el umbral. */
export async function searchChunks(
  pool: pg.Pool,
  embedding: number[],
  opts: { topK: number; minSimilarity: number },
): Promise<SearchResult[]> {
  // El ORDER BY sobre la distancia es lo que permite usar el índice HNSW; el umbral se aplica después.
  const res = await pool.query(
    `SELECT * FROM (
       SELECT c.video_id, v.title, c.start_sec, c.end_sec, c.transcript, c.frame_description, c.frame_path,
              1 - (c.embedding <=> $1::vector) AS similarity
       FROM rag_chunks c JOIN rag_videos v USING (video_id)
       ORDER BY c.embedding <=> $1::vector
       LIMIT $2
     ) t WHERE similarity >= $3
     ORDER BY similarity DESC`,
    [toVectorLiteral(embedding), opts.topK, opts.minSimilarity],
  );
  return res.rows.map((r) => ({
    videoId: r.video_id,
    title: r.title,
    startSec: r.start_sec,
    endSec: r.end_sec,
    transcript: r.transcript,
    frameDescription: r.frame_description,
    framePath: r.frame_path,
    similarity: Number(r.similarity),
  }));
}
