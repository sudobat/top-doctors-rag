import type { SearchResult } from './search.js';

export interface Source {
  videoId: string;
  title: string;
  startSec: number;
  url: string;
  frameUrl: string | null;
  excerpt: string;
}

export function youtubeTimeUrl(videoId: string, startSec: number): string {
  return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&t=${Math.max(0, Math.floor(startSec))}s`;
}

export function frameUrl(publicBaseUrl: string, framePath: string | null): string | null {
  return framePath ? `${publicBaseUrl.replace(/\/+$/, '')}/frames/${framePath}` : null;
}

/** Números citados como [n] o [n, m] en la respuesta, en orden de aparición y sin repetir. */
export function citedNumbers(answer: string): number[] {
  const seen: number[] = [];
  for (const match of answer.matchAll(/\[(\d+(?:\s*,\s*\d+)*)\]/g)) {
    for (const n of match[1].split(',').map((x) => Number(x.trim()))) {
      if (!seen.includes(n)) seen.push(n);
    }
  }
  return seen;
}

const EXCERPT_CHARS = 280;

/**
 * Fuentes de la respuesta: los fragmentos citados, en orden de cita, como mucho `max` y uno por
 * vídeo. `numbered` es la lista que vio el modelo (la cita [n] es `numbered[n - 1]`).
 *
 * Las citas del texto se renumeran para que [k] apunte a `sources[k - 1]`; dos fragmentos del mismo
 * vídeo comparten número, y las citas sin fuente (inexistentes o por encima de `max`) se eliminan.
 */
export function selectSources(
  answer: string,
  numbered: SearchResult[],
  opts: { max: number; publicBaseUrl: string },
): { answer: string; sources: Source[] } {
  const sources: Source[] = [];
  const sourceByVideo = new Map<string, number>();
  const renumber = new Map<number, number>();
  for (const n of citedNumbers(answer)) {
    const r = numbered[n - 1];
    if (!r) continue;
    let k = sourceByVideo.get(r.videoId);
    if (k === undefined) {
      if (sources.length >= opts.max) continue;
      sources.push({
        videoId: r.videoId,
        title: r.title,
        startSec: r.startSec,
        url: youtubeTimeUrl(r.videoId, r.startSec),
        frameUrl: frameUrl(opts.publicBaseUrl, r.framePath),
        excerpt: r.transcript.length > EXCERPT_CHARS ? `${r.transcript.slice(0, EXCERPT_CHARS)}…` : r.transcript,
      });
      k = sources.length;
      sourceByVideo.set(r.videoId, k);
    }
    renumber.set(n, k);
  }

  const rewritten = answer
    .replace(/\s*\[(\d+(?:\s*,\s*\d+)*)\]/g, (match, list: string) => {
      const ks = [...new Set(list.split(',').map((x) => renumber.get(Number(x.trim()))).filter((k) => k !== undefined))];
      return ks.length ? `${match.match(/^\s*/)![0]}[${ks.join(', ')}]` : '';
    })
    .trim();
  return { answer: rewritten, sources };
}
