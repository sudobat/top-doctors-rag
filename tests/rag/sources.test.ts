import { describe, expect, it } from 'vitest';
import type { SearchResult } from '../../src/rag/search.js';
import { citedNumbers, frameUrl, selectSources, youtubeTimeUrl } from '../../src/rag/sources.js';

const r = (videoId: string, startSec: number): SearchResult => ({
  videoId, title: `Vídeo ${videoId}`, startSec, endSec: startSec + 45, transcript: `texto ${videoId}@${startSec}`,
  frameDescription: null, framePath: `${videoId}/${startSec + 4}.jpg`, similarity: 0.8,
});
const opts = { max: 3, publicBaseUrl: 'http://localhost:4111/' };

describe('enlaces', () => {
  it('enlaza al segundo exacto de YouTube', () => {
    expect(youtubeTimeUrl('D_ZyBqvO4hY', 20.7)).toBe('https://www.youtube.com/watch?v=D_ZyBqvO4hY&t=20s');
  });
  it('construye la URL pública de la captura', () => {
    expect(frameUrl('http://localhost:4111/', 'abc/24.jpg')).toBe('http://localhost:4111/frames/abc/24.jpg');
    expect(frameUrl('http://x', null)).toBeNull();
  });
});

describe('citedNumbers', () => {
  it('extrae las citas en orden y sin repetir', () => {
    expect(citedNumbers('Paso uno [2]. Paso dos [1, 3]. Otra vez [2].')).toEqual([2, 1, 3]);
  });
});

describe('selectSources', () => {
  it('devuelve los fragmentos citados en orden de cita y renumera el texto', () => {
    const { answer, sources } = selectSources('Abre la agenda [3]. Pulsa Buscar [1].', [r('a', 0), r('b', 10), r('c', 20)], opts);
    expect(sources.map((s) => s.videoId)).toEqual(['c', 'a']);
    expect(answer).toBe('Abre la agenda [1]. Pulsa Buscar [2].');
    expect(sources[0]).toEqual({
      videoId: 'c', title: 'Vídeo c', startSec: 20,
      url: 'https://www.youtube.com/watch?v=c&t=20s',
      frameUrl: 'http://localhost:4111/frames/c/24.jpg',
      excerpt: 'texto c@20',
    });
  });

  it('una sola fuente por vídeo: los fragmentos del mismo vídeo comparten número', () => {
    const { answer, sources } = selectSources('Uno [1]. Dos [2]. Tres [3].', [r('a', 0), r('a', 35), r('b', 0)], opts);
    expect(sources.map((s) => [s.videoId, s.startSec])).toEqual([['a', 0], ['b', 0]]);
    expect(answer).toBe('Uno [1]. Dos [1]. Tres [2].');
  });

  it('como máximo MAX_SOURCES; las citas sobrantes o inexistentes se quitan', () => {
    const numbered = [r('a', 0), r('b', 0), r('c', 0), r('d', 0)];
    const { answer, sources } = selectSources('A [1]. B [2]. C [3]. D [4]. E [9]. F [4, 1].', numbered, opts);
    expect(sources).toHaveLength(3);
    expect(answer).toBe('A [1]. B [2]. C [3]. D. E. F [1].');
  });

  it('sin citas no hay fuentes', () => {
    expect(selectSources('No he encontrado información.', [r('a', 0)], opts)).toEqual({
      answer: 'No he encontrado información.', sources: [],
    });
  });
});
