import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseJson3, pickSubtitleFile } from '../../src/youtube/subtitles.js';

describe('parseJson3', () => {
  it('convierte los eventos de YouTube en segmentos en segundos', () => {
    const segments = parseJson3(readFileSync('tests/fixtures/sample.es.json3', 'utf8'));
    expect(segments[0]).toEqual({ start: 0.72, end: 7.44, text: 'Buscador de disponibilidades en las' });
    expect(segments[1].text).toBe('agendas por concepto de manera rápida.');
    expect(segments.length).toBeGreaterThan(20);
  });

  it('ignora eventos sin texto (saltos de línea, cabeceras)', () => {
    const raw = JSON.stringify({
      events: [
        { tStartMs: 0, dDurationMs: 1000 },
        { tStartMs: 500, segs: [{ utf8: '\n' }] },
        { tStartMs: 1000, dDurationMs: 2000, segs: [{ utf8: 'Hola' }, { utf8: ' mundo' }] },
      ],
    });
    expect(parseJson3(raw)).toEqual([{ start: 1, end: 3, text: 'Hola mundo' }]);
  });
});

describe('pickSubtitleFile', () => {
  it('prefiere los subtítulos manuales a los automáticos', () => {
    expect(pickSubtitleFile(['x.es-orig.json3', 'x.es.json3'], 'x')).toEqual({ file: 'x.es.json3', lang: 'es' });
  });

  it('usa los automáticos si no hay otros', () => {
    expect(pickSubtitleFile(['x.es-orig.json3'], 'x')).toEqual({ file: 'x.es-orig.json3', lang: 'es-orig' });
  });

  it('devuelve null si no hay subtítulos en español', () => {
    expect(pickSubtitleFile(['x.en.json3'], 'x')).toBeNull();
  });
});
