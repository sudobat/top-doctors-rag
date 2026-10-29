import { Memory } from '@mastra/memory';
import { PostgresStore } from '@mastra/pg';
import { MockLanguageModelV3 } from 'ai/test';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Store } from '../../src/db/store.js';
import { createTutorialsAgent } from '../../src/rag/agent.js';
import { chat } from '../../src/rag/chat.js';
import { createSearchTool } from '../../src/rag/tool.js';
import { freshPool, TEST_DATABASE_URL } from '../helpers/db.js';

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 10, text: 10, reasoning: 0 },
};

type Prompt = { role: string; content: unknown }[];

/**
 * Modelo simulado: si aún no ha visto el resultado de la herramienta, la llama con una consulta;
 * después responde citando [1] si la herramienta encontró algo.
 */
function scriptedModel(prompts: Prompt[]) {
  return new MockLanguageModelV3({
    doGenerate: async ({ prompt }) => {
      prompts.push(prompt as Prompt);
      const last = prompt.at(-1)!;
      if (last.role !== 'tool') {
        return {
          content: [{
            type: 'tool-call', toolCallId: `call-${prompts.length}`, toolName: 'searchTutorials',
            input: JSON.stringify({ query: 'buscar agenda por concepto' }),
          }],
          finishReason: { unified: 'tool-calls', raw: undefined },
          usage,
          warnings: [],
        };
      }
      const found = !JSON.stringify(last).includes('Sin resultados');
      return {
        content: [{ type: 'text', text: found ? 'Pulsa Buscar disponibilidad [1].' : 'No he encontrado información.' }],
        finishReason: { unified: 'stop', raw: undefined },
        usage,
        warnings: [],
      };
    },
  });
}

describe.skipIf(!TEST_DATABASE_URL)('agente Mastra real (modelo simulado)', () => {
  let pool: pg.Pool;
  let storage: PostgresStore;

  beforeAll(async () => {
    pool = await freshPool();
    await pool.query('DROP SCHEMA IF EXISTS mastra_test CASCADE');
    const store = new Store(pool);
    await store.registerVideos([{ videoId: 'agendas0001', title: 'Buscador agendas por concepto', durationSec: 118 }]);
    await store.replaceChunks('agendas0001', [{
      chunkIndex: 0, startSec: 20, endSec: 65, transcript: 'Para buscar por concepto pulsa Buscar disponibilidad.',
      frameDescription: 'Agenda con el botón Buscar', framePath: 'agendas0001/24.jpg', embedding: [1, 0, 0],
    }], 'youtube:es');
    storage = new PostgresStore({ id: 'test', connectionString: TEST_DATABASE_URL!, schemaName: 'mastra_test' });
  });
  afterAll(async () => {
    await storage?.close?.();
    await pool?.end();
  });

  it('busca con la herramienta, cita, devuelve fuentes y guarda el hilo en Postgres', async () => {
    const prompts: Prompt[] = [];
    const memory = new Memory({ storage, options: { lastMessages: 20, semanticRecall: false } });
    const agent = createTutorialsAgent({
      model: scriptedModel(prompts),
      searchTool: createSearchTool({ pool, embedQuery: async () => [1, 0, 0], topK: 8, minSimilarity: 0.35 }),
      memory,
    });
    const opts = { maxSources: 3, publicBaseUrl: 'http://localhost:4111' };

    const first = await chat(agent, { threadId: 'hilo-1', message: '¿Cómo busco por concepto?', userId: 'u-1' }, opts);
    expect(first.answer).toBe('Pulsa Buscar disponibilidad [1].');
    expect(first.sources).toEqual([expect.objectContaining({
      videoId: 'agendas0001',
      url: 'https://www.youtube.com/watch?v=agendas0001&t=20s',
      frameUrl: 'http://localhost:4111/frames/agendas0001/24.jpg',
    })]);
    // El resultado de la herramienta que ve el modelo lleva la numeración y la descripción de pantalla.
    expect(JSON.stringify(prompts[1])).toContain('[1] Vídeo: \\"Buscador agendas por concepto\\" (minuto 0:20)');
    expect(JSON.stringify(prompts[1])).toContain('Pantalla: Agenda con el botón Buscar');

    // Segundo turno en el mismo hilo: el modelo recibe la conversación anterior desde la memoria.
    const second = await chat(agent, { threadId: 'hilo-1', message: '¿y después?', userId: 'u-1' }, opts);
    expect(second.sources).toHaveLength(1);
    const lastPrompt = JSON.stringify(prompts.at(-2));
    expect(lastPrompt).toContain('¿Cómo busco por concepto?');
    expect(lastPrompt).toContain('¿y después?');

    const { messages } = await memory.recall({ threadId: 'hilo-1', resourceId: 'u-1' });
    expect(messages.length).toBeGreaterThanOrEqual(4);
  });
});
