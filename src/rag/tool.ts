import { createTool } from '@mastra/core/tools';
import type pg from 'pg';
import { z } from 'zod';
import { searchChunks, type SearchResult } from './search.js';

/** Clave del RequestContext donde se acumulan los fragmentos vistos en el turno actual. */
export const RESULTS_KEY = 'tutorialSearchResults';

export interface SearchToolDeps {
  pool: pg.Pool;
  embedQuery: (text: string) => Promise<number[]>;
  topK: number;
  minSimilarity: number;
}

/**
 * Formatea los fragmentos numerados para el modelo. La numeración es global al turno, de modo que
 * si el agente busca varias veces las citas [n] siguen apuntando a un único fragmento.
 */
export function formatResults(results: SearchResult[], firstNumber: number): string {
  if (results.length === 0) return 'Sin resultados relevantes en los videotutoriales.';
  return results
    .map((r, i) => {
      const lines = [`[${firstNumber + i}] Vídeo: "${r.title}" (minuto ${formatTime(r.startSec)})`, `Narración: ${r.transcript}`];
      if (r.frameDescription) lines.push(`Pantalla: ${r.frameDescription}`);
      return lines.join('\n');
    })
    .join('\n\n');
}

export function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function createSearchTool(deps: SearchToolDeps) {
  return createTool({
    id: 'searchTutorials',
    description:
      'Busca en las transcripciones y capturas de los videotutoriales de Ofimedic. Úsala antes de responder ' +
      'cualquier pregunta sobre el software. La consulta debe ser autocontenida (incluye el tema del que se ' +
      'habla aunque el usuario lo haya mencionado en mensajes anteriores).',
    inputSchema: z.object({
      query: z.string().min(1).describe('Consulta de búsqueda en español, autocontenida'),
    }),
    execute: async ({ query }, context) => {
      const results = await searchChunks(deps.pool, await deps.embedQuery(query), {
        topK: deps.topK,
        minSimilarity: deps.minSimilarity,
      });
      const collected = (context?.requestContext?.get(RESULTS_KEY) as SearchResult[] | undefined) ?? [];
      const first = collected.length + 1;
      collected.push(...results);
      context?.requestContext?.set(RESULTS_KEY, collected);
      return { results: formatResults(results, first) };
    },
  });
}
