import type { Segment } from '../youtube/subtitles.js';

export interface Chunk {
  index: number;
  startSec: number;
  endSec: number;
  text: string;
}

/**
 * Agrupa segmentos en ventanas de `windowSec` que se solapan `overlapSec`.
 * Cada ventana empieza en el inicio de un segmento, para que el enlace `&t=` caiga al principio
 * de una frase.
 */
export function chunkSegments(segments: Segment[], windowSec: number, overlapSec: number): Chunk[] {
  const segs = segments.filter((s) => s.text.trim());
  const chunks: Chunk[] = [];
  const step = Math.max(windowSec - overlapSec, 1);
  let i = 0;
  while (i < segs.length) {
    const start = segs[i].start;
    let j = i;
    while (j + 1 < segs.length && segs[j + 1].start < start + windowSec) j++;
    const group = segs.slice(i, j + 1);
    chunks.push({
      index: chunks.length,
      startSec: Math.floor(start),
      endSec: Math.ceil(Math.max(...group.map((s) => s.end), group[group.length - 1].start)),
      text: group.map((s) => s.text).join(' '),
    });
    if (j === segs.length - 1) break;
    // Siguiente ventana: primer segmento a partir de start + step, siempre avanzando al menos uno.
    let next = i + 1;
    while (next <= j && segs[next].start < start + step) next++;
    i = next;
  }
  return chunks;
}
