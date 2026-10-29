import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { baseArgs, watchUrl, type CommandRunner, type YtDlpOptions } from './ytdlp.js';

export interface Segment {
  /** Segundos desde el inicio del vídeo. */
  start: number;
  end: number;
  text: string;
}

/** Pistas por orden de preferencia: manuales primero, automáticas (`es-orig`) al final. */
export const SUBTITLE_LANGS = ['es', 'es-ES', 'es-419', 'es-orig'] as const;

interface Json3 {
  events?: { tStartMs?: number; dDurationMs?: number; segs?: { utf8?: string }[] }[];
}

/** Convierte el formato `json3` de YouTube en segmentos con texto. */
export function parseJson3(raw: string): Segment[] {
  const data = JSON.parse(raw) as Json3;
  const segments: Segment[] = [];
  for (const ev of data.events ?? []) {
    if (!ev.segs || ev.tStartMs === undefined) continue;
    const text = ev.segs
      .map((s) => s.utf8 ?? '')
      .join('')
      .replace(/\s+/g, ' ')
      .trim();
    if (!text) continue;
    segments.push({ start: ev.tStartMs / 1000, end: (ev.tStartMs + (ev.dDurationMs ?? 0)) / 1000, text });
  }
  return segments;
}

/** Elige el fichero de subtítulos preferido entre los descargados para un vídeo. */
export function pickSubtitleFile(files: string[], videoId: string): { file: string; lang: string } | null {
  for (const lang of SUBTITLE_LANGS) {
    const file = `${videoId}.${lang}.json3`;
    if (files.includes(file)) return { file, lang };
  }
  return null;
}

/** Descarga los subtítulos en español. Devuelve `null` si el vídeo no tiene ninguno. */
export async function fetchSubtitles(
  videoId: string,
  workDir: string,
  opts: YtDlpOptions,
  run: CommandRunner,
): Promise<{ segments: Segment[]; source: string } | null> {
  await run(opts.bin, [
    ...baseArgs(opts),
    '--skip-download',
    '--write-subs',
    '--write-auto-subs',
    '--sub-langs', SUBTITLE_LANGS.join(','),
    '--sub-format', 'json3',
    '-o', path.join(workDir, '%(id)s.%(ext)s'),
    watchUrl(videoId),
  ]);
  const picked = pickSubtitleFile(await readdir(workDir), videoId);
  if (!picked) return null;
  const segments = parseJson3(await readFile(path.join(workDir, picked.file), 'utf8'));
  if (segments.length === 0) return null;
  return { segments, source: `youtube:${picked.lang}` };
}
