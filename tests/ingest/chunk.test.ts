import { describe, expect, it } from 'vitest';
import { chunkSegments } from '../../src/ingest/chunk.js';

const seg = (start: number, text = `t${start}`) => ({ start, end: start + 5, text });

describe('chunkSegments', () => {
  it('agrupa en ventanas con solapamiento que empiezan en un segmento', () => {
    const segments = Array.from({ length: 20 }, (_, i) => seg(i * 5)); // 0..95 s
    const chunks = chunkSegments(segments, 45, 10);
    expect(chunks.map((c) => c.startSec)).toEqual([0, 35, 70]);
    expect(chunks[0].endSec).toBe(45);
    expect(chunks[0].text.split(' ')).toHaveLength(9); // 0..40
    // Solapamiento: el segmento de 35-40 s aparece en las dos primeras ventanas.
    expect(chunks[0].text).toContain('t35');
    expect(chunks[1].text).toContain('t35');
    expect(chunks.map((c) => c.index)).toEqual([0, 1, 2]);
    // El último fragmento llega hasta el final.
    expect(chunks.at(-1)!.text).toContain('t95');
  });

  it('un vídeo más corto que la ventana genera un solo fragmento', () => {
    const chunks = chunkSegments([seg(0.7), seg(3), seg(8)], 45, 10);
    expect(chunks).toEqual([{ index: 0, startSec: 0, endSec: 13, text: 't0.7 t3 t8' }]);
  });

  it('una transcripción vacía no genera fragmentos', () => {
    expect(chunkSegments([], 45, 10)).toEqual([]);
    expect(chunkSegments([{ start: 0, end: 1, text: '  ' }], 45, 10)).toEqual([]);
  });

  it('siempre avanza aunque haya huecos largos entre segmentos', () => {
    const chunks = chunkSegments([seg(0), seg(100), seg(300)], 45, 10);
    expect(chunks.map((c) => c.startSec)).toEqual([0, 100, 300]);
  });
});
