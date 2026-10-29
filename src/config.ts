import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

const schema = z.object({
  DATABASE_URL: z.string().default('postgresql://rag:rag@localhost:5432/rag'),
  OPENAI_API_KEY: z.string().optional(),
  RAG_SERVICE_KEY: z.string().optional(),
  PUBLIC_BASE_URL: z.string().default('http://localhost:4111'),
  FRAMES_DIR: z.string().default('./data/frames'),
  WORK_DIR: z.string().default('./data/work'),

  CHANNEL_URL: z.string().default('https://www.youtube.com/@ofimedic'),
  YTDLP_BIN: z.string().default('yt-dlp'),
  YTDLP_COOKIES: z.string().optional(),
  YTDLP_JS_RUNTIME: z.string().default('node'),
  FFMPEG_BIN: z.string().default('ffmpeg'),

  CHAT_MODEL: z.string().default('openai/gpt-5.4-mini'),
  VISION_MODEL: z.string().default('gpt-4.1-mini'),
  EMBEDDING_MODEL: z.string().default('text-embedding-3-small'),
  EMBEDDING_DIM: z.coerce.number().int().positive().default(1536),
  WHISPER_MODEL: z.string().default('whisper-1'),
  WHISPER_FALLBACK: bool.default(false),

  CHUNK_WINDOW_SEC: z.coerce.number().positive().default(45),
  CHUNK_OVERLAP_SEC: z.coerce.number().min(0).default(10),
  FRAME_OFFSET_SEC: z.coerce.number().min(0).default(4),
  MAX_ATTEMPTS: z.coerce.number().int().positive().default(3),

  SEARCH_TOP_K: z.coerce.number().int().positive().default(8),
  MIN_SIMILARITY: z.coerce.number().min(-1).max(1).default(0.35),
  MAX_SOURCES: z.coerce.number().int().positive().default(3),
  MEMORY_LAST_MESSAGES: z.coerce.number().int().positive().default(20),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  // Variables vacías en .env cuentan como no definidas.
  const cleaned = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined && v !== ''));
  return schema.parse(cleaned);
}

export function requireOpenAIKey(config: Config): string {
  if (!config.OPENAI_API_KEY) throw new Error('Falta OPENAI_API_KEY');
  return config.OPENAI_API_KEY;
}
