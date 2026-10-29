import { RequestContext } from '@mastra/core/request-context';
import { z } from 'zod';
import type { SearchResult } from './search.js';
import { selectSources, type Source } from './sources.js';
import { RESULTS_KEY } from './tool.js';

export const chatRequestSchema = z.object({
  threadId: z.string().trim().min(1).max(200),
  message: z.string().trim().min(1).max(4000),
  userId: z.string().trim().min(1).max(200).optional(),
});

export type ChatRequest = z.infer<typeof chatRequestSchema>;

export interface ChatResponse {
  threadId: string;
  answer: string;
  sources: Source[];
}

/** Lo mínimo que se usa del agente de Mastra; permite un doble en los tests. */
export interface ChatAgent {
  generate(
    message: string,
    options: { memory: { thread: string; resource: string }; requestContext: RequestContext; maxSteps: number },
  ): Promise<{ text: string }>;
}

export const DEFAULT_RESOURCE_ID = 'backend';

export async function chat(
  agent: ChatAgent,
  req: ChatRequest,
  opts: { maxSources: number; publicBaseUrl: string },
): Promise<ChatResponse> {
  const requestContext = new RequestContext();
  requestContext.set(RESULTS_KEY, []);
  const result = await agent.generate(req.message, {
    memory: { thread: req.threadId, resource: req.userId ?? DEFAULT_RESOURCE_ID },
    requestContext,
    maxSteps: 5,
  });
  const seen = (requestContext.get(RESULTS_KEY) as SearchResult[] | undefined) ?? [];
  const { answer, sources } = selectSources(result.text, seen, {
    max: opts.maxSources,
    publicBaseUrl: opts.publicBaseUrl,
  });
  return { threadId: req.threadId, answer, sources };
}
