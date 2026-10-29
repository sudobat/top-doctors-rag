import { existsSync } from 'node:fs';
import { copyFile, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type pg from 'pg';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { Store } from '../../src/db/store.js';
import type { IngestAi } from '../../src/ingest/ai.js';
import { embeddingText, runIngest, type IngestDeps } from '../../src/ingest/pipeline.js';
import type { CommandRunner } from '../../src/youtube/ytdlp.js';
import { freshPool, TEST_DATABASE_URL } from '../helpers/db.js';

const FIXTURE = path.resolve('tests/fixtures/sample.es.json3');

interface FakeYouTube {
  videos: { id: string; title: string; duration: number }[];
  /** IDs sin subtítulos. */
  noSubs?: string[];
  /** IDs cuya descarga falla. */
  broken?: string[];
}

/** Simula yt-dlp y ffmpeg escribiendo los ficheros que generarían. */
function fakeRunner(yt: FakeYouTube, calls: string[][]): CommandRunner {
  return async (bin, args) => {
    calls.push([bin, ...args]);
    const out = args[args.indexOf('-o') + 1];
    const url = args.at(-1)!;
    const id = url.split('v=')[1];
    if (bin === 'ffmpeg') {
      await writeFile(args.at(-1)!, 'jpg');
      return '';
    }
    if (args.includes('--flat-playlist')) return JSON.stringify({ entries: yt.videos });
    if (yt.broken?.includes(id)) throw new Error('ERROR: Video unavailable');
    const dir = path.dirname(out);
    if (args.includes('--skip-download')) {
      if (!yt.noSubs?.includes(id)) await copyFile(FIXTURE, path.join(dir, `${id}.es-orig.json3`));
      return '';
    }
    const kind = out.includes('.audio.') ? 'audio' : 'video';
    await writeFile(path.join(dir, `${id}.${kind}.mp4`), 'data');
    return '';
  };
}

function fakeAi(): IngestAi & { described: string[]; embedded: string[] } {
  const described: string[] = [];
  const embedded: string[] = [];
  return {
    described,
    embedded,
    async describeFrame(imagePath) {
      described.push(imagePath);
      return 'Pantalla de agendas con el botón Buscar';
    },
    async embed(texts) {
      embedded.push(...texts);
      return texts.map(() => [1, 0, 0]);
    },
    async transcribe() {
      return [{ start: 0, end: 5, text: 'Transcripción de Whisper' }];
    },
  };
}

describe('embeddingText', () => {
  it('combina título, narración y pantalla', () => {
    expect(embeddingText('Agendas', 'pulsa aquí', 'Botón Buscar')).toBe(
      'Vídeo: Agendas\nNarración: pulsa aquí\nPantalla: Botón Buscar',
    );
    expect(embeddingText('Agendas', 'pulsa aquí', null)).toBe('Vídeo: Agendas\nNarración: pulsa aquí');
  });
});

describe.skipIf(!TEST_DATABASE_URL)('runIngest', () => {
  let pool: pg.Pool;
  let dir: string;
  beforeEach(async () => {
    pool ??= await freshPool();
    await pool.query('TRUNCATE rag_videos CASCADE');
    dir = await mkdtemp(path.join(tmpdir(), 'ingest-'));
  });
  afterAll(async () => pool?.end());

  function deps(yt: FakeYouTube, calls: string[][], ai: IngestAi, extra: Partial<IngestDeps> = {}): IngestDeps {
    return {
      store: new Store(pool), ai, run: fakeRunner(yt, calls), ytdlp: { bin: 'yt-dlp' }, ffmpegBin: 'ffmpeg',
      framesDir: path.join(dir, 'frames'), workDir: path.join(dir, 'work'), channelUrl: 'https://www.youtube.com/@ofimedic',
      windowSec: 45, overlapSec: 10, frameOffsetSec: 4, maxAttempts: 3, whisperFallback: false, ...extra,
    };
  }

  it('procesa los vídeos nuevos de principio a fin', async () => {
    const calls: string[][] = [];
    const ai = fakeAi();
    const yt = { videos: [{ id: 'D_ZyBqvO4hY', title: 'Buscador agendas por concepto', duration: 118 }] };
    const summary = await runIngest(deps(yt, calls, ai));
    expect(summary).toEqual({ newVideos: 1, processed: 1, done: 1, failed: 0, noSubtitles: 0 });

    const { rows } = await pool.query('SELECT start_sec, frame_path, frame_description FROM rag_chunks ORDER BY chunk_index');
    expect(rows.length).toBeGreaterThanOrEqual(3);
    expect(rows[0]).toEqual({ start_sec: 0, frame_path: 'D_ZyBqvO4hY/4.jpg', frame_description: 'Pantalla de agendas con el botón Buscar' });
    expect(existsSync(path.join(dir, 'frames', 'D_ZyBqvO4hY', '4.jpg'))).toBe(true);
    expect(ai.described).toHaveLength(rows.length);
    expect(ai.embedded[0]).toContain('Pantalla: Pantalla de agendas');
    // El vídeo descargado se borra.
    expect(existsSync(path.join(dir, 'work', 'D_ZyBqvO4hY'))).toBe(false);

    // Segunda ejecución: nada nuevo que hacer.
    expect(await runIngest(deps(yt, calls, ai))).toEqual({ newVideos: 0, processed: 0, done: 0, failed: 0, noSubtitles: 0 });
  });

  it('un vídeo que falla no detiene la ingesta y se guarda el error', async () => {
    const yt = {
      videos: [{ id: 'brokenvid01', title: 'Roto', duration: 60 }, { id: 'D_ZyBqvO4hY', title: 'Bueno', duration: 118 }],
      broken: ['brokenvid01'],
    };
    const summary = await runIngest(deps(yt, [], fakeAi()));
    expect(summary).toMatchObject({ processed: 2, done: 1, failed: 1 });
    const { rows } = await pool.query("SELECT status, attempts, last_error FROM rag_videos WHERE video_id = 'brokenvid01'");
    expect(rows[0]).toEqual({ status: 'error', attempts: 1, last_error: 'ERROR: Video unavailable' });
    expect(existsSync(path.join(dir, 'work', 'brokenvid01'))).toBe(false);
  });

  it('sin subtítulos y sin fallback marca no_subtitles', async () => {
    const yt = { videos: [{ id: 'nosubs00001', title: 'Mudo', duration: 60 }], noSubs: ['nosubs00001'] };
    expect(await runIngest(deps(yt, [], fakeAi()))).toMatchObject({ noSubtitles: 1, failed: 0 });
    const { rows } = await pool.query('SELECT status FROM rag_videos');
    expect(rows[0].status).toBe('no_subtitles');
  });

  it('sin subtítulos y con WHISPER_FALLBACK transcribe con Whisper', async () => {
    const calls: string[][] = [];
    const yt = { videos: [{ id: 'nosubs00001', title: 'Mudo', duration: 60 }], noSubs: ['nosubs00001'] };
    expect(await runIngest(deps(yt, calls, fakeAi(), { whisperFallback: true }))).toMatchObject({ done: 1 });
    const { rows } = await pool.query('SELECT v.transcript_source, c.transcript FROM rag_videos v JOIN rag_chunks c USING (video_id)');
    expect(rows).toEqual([{ transcript_source: 'whisper:fallback', transcript: 'Transcripción de Whisper' }]);
    // El audio se comprime a mono 16 kHz antes de enviarlo.
    expect(calls.some((c) => c[0] === 'ffmpeg' && c.includes('16000'))).toBe(true);
  });

  it('--video --whisper reprocesa un vídeo con Whisper aunque tenga subtítulos', async () => {
    const yt = { videos: [{ id: 'D_ZyBqvO4hY', title: 'Bueno', duration: 118 }] };
    await runIngest(deps(yt, [], fakeAi()));
    const calls: string[][] = [];
    expect(await runIngest(deps(yt, calls, fakeAi()), { videoId: 'D_ZyBqvO4hY', whisper: true })).toMatchObject({ done: 1 });
    expect(calls.some((c) => c.includes('--skip-download'))).toBe(false);
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM rag_chunks');
    expect(rows[0].n).toBe(1);
  });
});
