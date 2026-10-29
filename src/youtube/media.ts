import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { baseArgs, watchUrl, type CommandRunner, type YtDlpOptions } from './ytdlp.js';

async function findDownloaded(workDir: string, prefix: string): Promise<string> {
  const file = (await readdir(workDir)).find((f) => f.startsWith(prefix) && !f.endsWith('.part'));
  if (!file) throw new Error(`yt-dlp no generó ${prefix}*`);
  return path.join(workDir, file);
}

/** Descarga solo la pista de vídeo a ≤720p: suficiente para leer la interfaz en las capturas. */
export async function downloadVideo(
  videoId: string,
  workDir: string,
  opts: YtDlpOptions,
  run: CommandRunner,
): Promise<string> {
  await run(opts.bin, [
    ...baseArgs(opts),
    '-f', 'bv*[height<=720][ext=mp4]/bv*[height<=720]/b[height<=720]/b',
    '-o', path.join(workDir, '%(id)s.video.%(ext)s'),
    watchUrl(videoId),
  ]);
  return findDownloaded(workDir, `${videoId}.video.`);
}

/** Descarga solo el audio (para Whisper). */
export async function downloadAudio(
  videoId: string,
  workDir: string,
  opts: YtDlpOptions,
  run: CommandRunner,
): Promise<string> {
  await run(opts.bin, [
    ...baseArgs(opts),
    '-f', 'ba/b',
    '-o', path.join(workDir, '%(id)s.audio.%(ext)s'),
    watchUrl(videoId),
  ]);
  return findDownloaded(workDir, `${videoId}.audio.`);
}
