import { mkdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import type { Store, StoredChunk, VideoRow } from '../db/store.js';
import { listChannelVideos } from '../youtube/channel.js';
import { downloadAudio, downloadVideo } from '../youtube/media.js';
import { fetchSubtitles, type Segment } from '../youtube/subtitles.js';
import type { CommandRunner, YtDlpOptions } from '../youtube/ytdlp.js';
import type { IngestAi } from './ai.js';
import { chunkSegments } from './chunk.js';
import { extractFrame, frameRelPath, frameSecond } from './frames.js';

export interface IngestDeps {
  store: Store;
  ai: IngestAi;
  run: CommandRunner;
  ytdlp: YtDlpOptions;
  ffmpegBin: string;
  framesDir: string;
  workDir: string;
  channelUrl: string;
  windowSec: number;
  overlapSec: number;
  frameOffsetSec: number;
  maxAttempts: number;
  whisperFallback: boolean;
  log?: (msg: string) => void;
}

export interface IngestOptions {
  /** Procesa solo este vídeo (lo registra si no existe). */
  videoId?: string;
  limit?: number;
  retryErrors?: boolean;
  /** Fuerza la transcripción con Whisper. */
  whisper?: boolean;
}

export interface IngestSummary {
  newVideos: number;
  processed: number;
  done: number;
  failed: number;
  noSubtitles: number;
}

/** Límite de la API de transcripción de OpenAI. */
const WHISPER_MAX_BYTES = 25 * 1024 * 1024;

export class NoSubtitlesError extends Error {}

export function embeddingText(title: string, transcript: string, frameDescription: string | null): string {
  const parts = [`Vídeo: ${title}`, `Narración: ${transcript}`];
  if (frameDescription) parts.push(`Pantalla: ${frameDescription}`);
  return parts.join('\n');
}

export async function runIngest(deps: IngestDeps, opts: IngestOptions = {}): Promise<IngestSummary | null> {
  const outcome = await deps.store.withIngestLock(() => ingestUnlocked(deps, opts));
  if (!outcome.locked) {
    deps.log?.('Otra ingesta está en marcha; se omite esta ejecución.');
    return null;
  }
  return outcome.result;
}

async function ingestUnlocked(deps: IngestDeps, opts: IngestOptions): Promise<IngestSummary> {
  const log = deps.log ?? (() => {});
  const summary: IngestSummary = { newVideos: 0, processed: 0, done: 0, failed: 0, noSubtitles: 0 };

  let queue: VideoRow[];
  if (opts.videoId) {
    let video = await deps.store.getVideo(opts.videoId);
    if (!video) {
      summary.newVideos = await deps.store.registerVideos([{ videoId: opts.videoId, title: opts.videoId, durationSec: null }]);
      video = await deps.store.getVideo(opts.videoId);
    }
    queue = video ? [video] : [];
  } else {
    const videos = await listChannelVideos(deps.channelUrl, deps.ytdlp, deps.run);
    summary.newVideos = await deps.store.registerVideos(videos);
    log(`Canal: ${videos.length} vídeos, ${summary.newVideos} nuevos.`);
    queue = await deps.store.videosToProcess({
      maxAttempts: deps.maxAttempts,
      retryErrors: opts.retryErrors ?? false,
      limit: opts.limit,
    });
  }

  for (const video of queue) {
    summary.processed++;
    log(`[${summary.processed}/${queue.length}] ${video.videoId} ${video.title}`);
    try {
      const count = await ingestVideo(deps, video, opts.whisper ?? false);
      summary.done++;
      log(`  ✓ ${count} fragmentos`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (err instanceof NoSubtitlesError) {
        summary.noSubtitles++;
        await deps.store.markFailed(video.videoId, 'no_subtitles', message);
      } else {
        summary.failed++;
        await deps.store.markFailed(video.videoId, 'error', message);
      }
      log(`  ✗ ${message}`);
    }
  }
  return summary;
}

/** Procesa un vídeo completo. Devuelve el número de fragmentos guardados. */
export async function ingestVideo(deps: IngestDeps, video: VideoRow, forceWhisper: boolean): Promise<number> {
  const workDir = path.join(deps.workDir, video.videoId);
  await rm(workDir, { recursive: true, force: true });
  await mkdir(workDir, { recursive: true });
  try {
    const { segments, source } = await transcript(deps, video.videoId, workDir, forceWhisper);
    const chunks = chunkSegments(segments, deps.windowSec, deps.overlapSec);
    if (chunks.length === 0) throw new NoSubtitlesError('La transcripción está vacía');

    const videoPath = await downloadVideo(video.videoId, workDir, deps.ytdlp, deps.run);
    const described: Omit<StoredChunk, 'embedding'>[] = [];
    for (const chunk of chunks) {
      const second = frameSecond(chunk.startSec, deps.frameOffsetSec, video.durationSec);
      const rel = frameRelPath(video.videoId, second);
      const abs = path.join(deps.framesDir, rel);
      await extractFrame(deps.ffmpegBin, videoPath, second, abs, deps.run);
      const frameDescription = await deps.ai.describeFrame(abs, { title: video.title, transcript: chunk.text });
      described.push({
        chunkIndex: chunk.index,
        startSec: chunk.startSec,
        endSec: chunk.endSec,
        transcript: chunk.text,
        frameDescription: frameDescription || null,
        framePath: rel,
      });
    }

    const embeddings = await deps.ai.embed(described.map((c) => embeddingText(video.title, c.transcript, c.frameDescription)));
    await deps.store.replaceChunks(
      video.videoId,
      described.map((c, i) => ({ ...c, embedding: embeddings[i] })),
      source,
    );
    return described.length;
  } finally {
    // El vídeo descargado no se conserva: con ~2.000 vídeos llenaría el disco.
    await rm(workDir, { recursive: true, force: true });
  }
}

async function transcript(
  deps: IngestDeps,
  videoId: string,
  workDir: string,
  forceWhisper: boolean,
): Promise<{ segments: Segment[]; source: string }> {
  if (!forceWhisper) {
    const subs = await fetchSubtitles(videoId, workDir, deps.ytdlp, deps.run);
    if (subs) return subs;
    if (!deps.whisperFallback) throw new NoSubtitlesError('El vídeo no tiene subtítulos en español');
  }
  const audio = await downloadAudio(videoId, workDir, deps.ytdlp, deps.run);
  // Mono, 16 kHz y 24 kbps: ~2 h de audio caben en el límite de 25 MB de la API.
  const compressed = path.join(workDir, `${videoId}.whisper.mp3`);
  await deps.run(deps.ffmpegBin, ['-loglevel', 'error', '-y', '-i', audio, '-ac', '1', '-ar', '16000', '-b:a', '24k', compressed]);
  if ((await stat(compressed)).size > WHISPER_MAX_BYTES) {
    throw new Error('El audio supera el límite de 25 MB de Whisper');
  }
  return { segments: await deps.ai.transcribe(compressed), source: `whisper:${forceWhisper ? 'forced' : 'fallback'}` };
}
