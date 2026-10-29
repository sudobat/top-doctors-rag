import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { CommandRunner } from '../youtube/ytdlp.js';

/**
 * Segundo del fotograma: unos segundos después del inicio del fragmento, porque el narrador
 * suele anunciar la acción antes de hacerla. Nunca más allá del final del vídeo.
 */
export function frameSecond(startSec: number, offsetSec: number, durationSec: number | null): number {
  const target = startSec + offsetSec;
  if (durationSec === null || durationSec <= 0) return Math.floor(target);
  return Math.max(0, Math.min(Math.floor(target), Math.floor(durationSec) - 1));
}

/** Ruta relativa a FRAMES_DIR; es la que se guarda en BD y la que se publica en /frames. */
export function frameRelPath(videoId: string, second: number): string {
  return `${videoId}/${second}.jpg`;
}

export async function extractFrame(
  ffmpegBin: string,
  videoPath: string,
  second: number,
  outPath: string,
  run: CommandRunner,
): Promise<void> {
  await mkdir(path.dirname(outPath), { recursive: true });
  await run(ffmpegBin, [
    '-loglevel', 'error', '-y',
    '-ss', String(second),
    '-i', videoPath,
    '-frames:v', '1',
    '-q:v', '3',
    outPath,
  ]);
}
