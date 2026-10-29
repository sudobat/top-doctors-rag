import { readFile } from 'node:fs/promises';
import path from 'node:path';

const VIDEO_ID = /^[A-Za-z0-9_-]{6,20}$/;
const FRAME_FILE = /^\d{1,6}\.jpg$/;

/**
 * Ruta absoluta de una captura, o `null` si los parámetros no son válidos. Solo se aceptan IDs de
 * YouTube y nombres `<segundo>.jpg`, así que no hay forma de salir de `framesDir`.
 */
export function resolveFramePath(framesDir: string, videoId: string, file: string): string | null {
  if (!VIDEO_ID.test(videoId) || !FRAME_FILE.test(file)) return null;
  return path.join(path.resolve(framesDir), videoId, file);
}

export async function readFrame(framesDir: string, videoId: string, file: string): Promise<Buffer | null> {
  const p = resolveFramePath(framesDir, videoId, file);
  if (!p) return null;
  try {
    return await readFile(p);
  } catch {
    return null;
  }
}
