import type { RequestContext } from '@mastra/core/request-context';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Store } from '../../src/db/store.js';
import { AGENT_INSTRUCTIONS, NO_INFO_ANSWER, createTutorialsAgent } from '../../src/rag/agent.js';
import { chat, chatRequestSchema, DEFAULT_RESOURCE_ID, type ChatAgent } from '../../src/rag/chat.js';
import { createSearchTool } from '../../src/rag/tool.js';
import { freshPool, TEST_DATABASE_URL } from '../helpers/db.js';

const opts = { maxSources: 3, publicBaseUrl: 'http://localhost:4111' };

describe('chatRequestSchema', () => {
  it('exige threadId y un mensaje no vacío', () => {
    expect(chatRequestSchema.safeParse({ threadId: 't', message: '  ' }).success).toBe(false);
    expect(chatRequestSchema.safeParse({ message: 'hola' }).success).toBe(false);
    expect(chatRequestSchema.safeParse({ threadId: 't', message: 'hola' }).success).toBe(true);
  });
});

describe('instrucciones del agente', () => {
  it('obligan a buscar, citar, responder en español y no inventar', () => {
    expect(AGENT_INSTRUCTIONS).toContain('searchTutorials');
    expect(AGENT_INSTRUCTIONS).toContain('[1]');
    expect(AGENT_INSTRUCTIONS).toContain('en español');
    expect(AGENT_INSTRUCTIONS).toContain(NO_INFO_ANSWER);
  });
});

describe.skipIf(!TEST_DATABASE_URL)('chat', () => {
  let pool: pg.Pool;
  let tool: ReturnType<typeof createSearchTool>;
  const queries: string[] = [];

  beforeAll(async () => {
    pool = await freshPool();
    const store = new Store(pool);
    await store.registerVideos([
      { videoId: 'agendas0001', title: 'Buscador agendas por concepto', durationSec: 118 },
      { videoId: 'whatsapp001', title: 'WhatsApp en Ofimedic Web', durationSec: 1209 },
    ]);
    const c = (i: number, start: number, embedding: number[], text: string) => ({
      chunkIndex: i, startSec: start, endSec: start + 45, transcript: text,
      frameDescription: 'Pantalla de agenda', framePath: null as string | null, embedding,
    });
    await store.replaceChunks('agendas0001', [
      { ...c(0, 20, [1, 0, 0], 'Para buscar por concepto pulsa Buscar disponibilidad.'), framePath: 'agendas0001/24.jpg' },
    ], 'youtube:es');
    await store.replaceChunks('whatsapp001', [c(0, 300, [0, 1, 0], 'Para anular el envío pulsa Cancelar.')], 'youtube:es');
    // Embedding de juguete: "whatsapp"/"anular" apunta al segundo vídeo, "agenda" al primero, el resto a ninguno.
    tool = createSearchTool({
      pool,
      embedQuery: async (q) => {
        queries.push(q);
        if (/whatsapp|anul/i.test(q)) return [0, 1, 0];
        if (/agenda|concepto/i.test(q)) return [1, 0, 0];
        return [0, 0, 1];
      },
      topK: 8,
      minSimilarity: 0.35,
    });
  });
  afterAll(async () => pool?.end());

  /** Agente de prueba: ejecuta la herramienta real con las consultas dadas y devuelve un texto fijo. */
  function scriptedAgent(searches: string[], text: string, seen: unknown[] = []): ChatAgent {
    return {
      async generate(_message, options) {
        seen.push(options.memory);
        for (const query of searches) {
          await tool.execute!({ query }, { requestContext: options.requestContext as RequestContext });
        }
        return { text };
      },
    };
  }

  it('devuelve la respuesta con las fuentes citadas, captura y enlace al segundo', async () => {
    const seen: unknown[] = [];
    const res = await chat(
      scriptedAgent(['buscar agenda por concepto'], 'Pulsa **Buscar disponibilidad** [1].', seen),
      { threadId: 'conv-1', message: '¿Cómo busco por concepto?' },
      opts,
    );
    expect(res).toEqual({
      threadId: 'conv-1',
      answer: 'Pulsa **Buscar disponibilidad** [1].',
      sources: [{
        videoId: 'agendas0001',
        title: 'Buscador agendas por concepto',
        startSec: 20,
        url: 'https://www.youtube.com/watch?v=agendas0001&t=20s',
        frameUrl: 'http://localhost:4111/frames/agendas0001/24.jpg',
        excerpt: 'Para buscar por concepto pulsa Buscar disponibilidad.',
      }],
    });
    // Memoria: hilo del backend y, sin userId, el resource por defecto.
    expect(seen).toEqual([{ thread: 'conv-1', resource: DEFAULT_RESOURCE_ID }]);
  });

  it('numera de forma global si el agente busca varias veces en el mismo turno', async () => {
    const res = await chat(
      scriptedAgent(['agenda', 'anular envío whatsapp'], 'Primero la agenda [1] y luego cancela [2].'),
      { threadId: 'conv-2', message: '…', userId: 'u-42' },
      opts,
    );
    expect(res.sources.map((s) => s.videoId)).toEqual(['agendas0001', 'whatsapp001']);
    expect(res.sources[1].url).toBe('https://www.youtube.com/watch?v=whatsapp001&t=300s');
    expect(res.sources[1].frameUrl).toBeNull();
  });

  it('una repregunta se busca con la consulta autocontenida que formula el agente', async () => {
    queries.length = 0;
    // El usuario dice "¿y cómo lo anulo?"; el agente busca con el tema del hilo.
    const res = await chat(scriptedAgent(['anular envío de WhatsApp'], 'Pulsa Cancelar [1].'), { threadId: 'conv-3', message: '¿y cómo lo anulo?' }, opts);
    expect(queries).toEqual(['anular envío de WhatsApp']);
    expect(res.sources[0].videoId).toBe('whatsapp001');
  });

  it('sin resultados la herramienta lo dice y no hay fuentes', async () => {
    const output = await tool.execute!({ query: 'facturación electrónica' }, {});
    expect(output).toEqual({ results: 'Sin resultados relevantes en los videotutoriales.' });
    const res = await chat(scriptedAgent(['facturación electrónica'], NO_INFO_ANSWER), { threadId: 'c', message: '¿Facturo?' }, opts);
    expect(res).toEqual({ threadId: 'c', answer: NO_INFO_ANSWER, sources: [] });
  });

  it('el agente real se construye con la herramienta de búsqueda', () => {
    const agent = createTutorialsAgent({ model: 'openai/gpt-5.4-mini', searchTool: tool });
    expect(agent.id).toBe('tutorialsAgent');
  });
});
