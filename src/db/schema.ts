import type pg from 'pg';

export function schemaSql(embeddingDim: number): string {
  return `
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS rag_videos (
  video_id      text PRIMARY KEY,
  title         text NOT NULL,
  duration_sec  integer,
  status        text NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'done', 'error', 'no_subtitles')),
  transcript_source text,
  chunk_count   integer NOT NULL DEFAULT 0,
  attempts      integer NOT NULL DEFAULT 0,
  last_error    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS rag_chunks (
  id                bigserial PRIMARY KEY,
  video_id          text NOT NULL REFERENCES rag_videos(video_id) ON DELETE CASCADE,
  chunk_index       integer NOT NULL,
  start_sec         integer NOT NULL,
  end_sec           integer NOT NULL,
  transcript        text NOT NULL,
  frame_description text,
  frame_path        text,
  embedding         vector(${embeddingDim}) NOT NULL,
  UNIQUE (video_id, chunk_index)
);

CREATE INDEX IF NOT EXISTS rag_chunks_embedding_idx
  ON rag_chunks USING hnsw (embedding vector_cosine_ops);
`;
}

export async function migrate(pool: pg.Pool, embeddingDim: number): Promise<void> {
  await pool.query(schemaSql(embeddingDim));
}
