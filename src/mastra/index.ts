import { Mastra } from '@mastra/core/mastra';
import { registerApiRoute } from '@mastra/core/server';
import { Memory } from '@mastra/memory';
import { PostgresStore } from '@mastra/pg';
import OpenAI from 'openai';
import { loadConfig, requireOpenAIKey } from '../config.js';
import { getPool } from '../db/pool.js';
import { createTutorialsAgent } from '../rag/agent.js';
import { chat, chatRequestSchema } from '../rag/chat.js';
import { createSearchTool } from '../rag/tool.js';
import { isAuthorized, isPublicPath } from './auth.js';
import { readFrame } from './frames.js';

const config = loadConfig();
const pool = getPool(config.DATABASE_URL);
const openai = new OpenAI({ apiKey: requireOpenAIKey(config) });

// Las tablas de Mastra (hilos, mensajes…) van en su propio esquema para no mezclarse con rag_*.
const storage = new PostgresStore({ id: 'rag-storage', connectionString: config.DATABASE_URL, schemaName: 'mastra' });

const tutorialsAgent = createTutorialsAgent({
  model: config.CHAT_MODEL,
  searchTool: createSearchTool({
    pool,
    embedQuery: async (text) =>
      (await openai.embeddings.create({ model: config.EMBEDDING_MODEL, input: text })).data[0].embedding,
    topK: config.SEARCH_TOP_K,
    minSimilarity: config.MIN_SIMILARITY,
  }),
  memory: new Memory({
    storage,
    options: { lastMessages: config.MEMORY_LAST_MESSAGES, semanticRecall: false },
  }),
});

export const mastra = new Mastra({
  agents: { tutorialsAgent },
  storage,
  server: {
    middleware: [
      async (c, next) => {
        if (isPublicPath(c.req.path)) return next();
        if (!isAuthorized(c.req.header('Authorization'), config.RAG_SERVICE_KEY)) {
          return c.json({ error: 'unauthorized' }, 401);
        }
        return next();
      },
    ],
    apiRoutes: [
      registerApiRoute('/v1/chat', {
        method: 'POST',
        handler: async (c) => {
          // Se comprueba aquí además de en el middleware: Mastra no aplica el middleware global a
          // todas las rutas propias (p. ej. las marcadas como públicas).
          if (!isAuthorized(c.req.header('Authorization'), config.RAG_SERVICE_KEY)) {
            return c.json({ error: 'unauthorized' }, 401);
          }
          const body = await c.req.json().catch(() => null);
          const parsed = chatRequestSchema.safeParse(body);
          if (!parsed.success) return c.json({ error: 'invalid_request', details: parsed.error.issues }, 400);
          try {
            const response = await chat(c.get('mastra').getAgent('tutorialsAgent'), parsed.data, {
              maxSources: config.MAX_SOURCES,
              publicBaseUrl: config.PUBLIC_BASE_URL,
            });
            return c.json(response);
          } catch (err) {
            c.get('mastra').getLogger().error('Error en /v1/chat', { err });
            return c.json({ error: 'internal_error' }, 500);
          }
        },
      }),
      registerApiRoute('/frames/:videoId/:file', {
        method: 'GET',
        requiresAuth: false,
        handler: async (c) => {
          const data = await readFrame(config.FRAMES_DIR, c.req.param('videoId'), c.req.param('file'));
          if (!data) return c.json({ error: 'not_found' }, 404);
          return c.body(new Uint8Array(data), 200, {
            'Content-Type': 'image/jpeg',
            'Cache-Control': 'public, max-age=86400',
          });
        },
      }),
    ],
  },
});
