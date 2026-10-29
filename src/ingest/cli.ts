import 'dotenv/config';
import { parseArgs } from 'node:util';
import { loadConfig, requireOpenAIKey } from '../config.js';
import { createPool } from '../db/pool.js';
import { migrate } from '../db/schema.js';
import { Store } from '../db/store.js';
import { runCommand } from '../youtube/ytdlp.js';
import { createOpenAIIngestAi } from './ai.js';
import { runIngest } from './pipeline.js';

const { values } = parseArgs({
  options: {
    video: { type: 'string' },
    limit: { type: 'string' },
    'retry-errors': { type: 'boolean', default: false },
    whisper: { type: 'boolean', default: false },
  },
});

if (values.whisper && !values.video) {
  console.error('--whisper requiere --video <id>');
  process.exit(2);
}

const config = loadConfig();
const pool = createPool(config.DATABASE_URL);

try {
  await migrate(pool, config.EMBEDDING_DIM);
  const summary = await runIngest(
    {
      store: new Store(pool),
      ai: createOpenAIIngestAi({
        apiKey: requireOpenAIKey(config),
        visionModel: config.VISION_MODEL,
        embeddingModel: config.EMBEDDING_MODEL,
        whisperModel: config.WHISPER_MODEL,
      }),
      run: runCommand,
      ytdlp: { bin: config.YTDLP_BIN, cookies: config.YTDLP_COOKIES, jsRuntime: config.YTDLP_JS_RUNTIME },
      ffmpegBin: config.FFMPEG_BIN,
      framesDir: config.FRAMES_DIR,
      workDir: config.WORK_DIR,
      channelUrl: config.CHANNEL_URL,
      windowSec: config.CHUNK_WINDOW_SEC,
      overlapSec: config.CHUNK_OVERLAP_SEC,
      frameOffsetSec: config.FRAME_OFFSET_SEC,
      maxAttempts: config.MAX_ATTEMPTS,
      whisperFallback: config.WHISPER_FALLBACK,
      log: (msg) => console.log(msg),
    },
    {
      videoId: values.video,
      limit: values.limit ? Number(values.limit) : undefined,
      retryErrors: values['retry-errors'],
      whisper: values.whisper,
    },
  );
  if (summary) console.log('Resumen:', JSON.stringify(summary));
  if (summary && summary.failed > 0) process.exitCode = 1;
} finally {
  await pool.end();
}
