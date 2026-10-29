import { Agent } from '@mastra/core/agent';
import type { MastraMemory } from '@mastra/core/memory';
import type { createSearchTool } from './tool.js';

export const NO_INFO_ANSWER =
  'No he encontrado información sobre esto en los videotutoriales de Ofimedic. ' +
  '¿Puedes reformular la pregunta o darme más detalles de lo que quieres hacer?';

export const AGENT_INSTRUCTIONS = `Eres el asistente de ayuda de Ofimedic, un software de gestión para consultas y centros médicos.
Respondes las dudas de los usuarios exclusivamente con la información de los videotutoriales oficiales.

Reglas:
- Antes de responder una pregunta sobre el software, llama SIEMPRE a la herramienta searchTutorials. Si la pregunta
  depende de la conversación anterior ("¿y cómo lo deshago?"), formula una consulta autocontenida.
- Responde solo con lo que digan los fragmentos devueltos (narración y descripción de pantalla). No uses tu
  conocimiento general ni inventes menús, botones o pasos.
- Cita los fragmentos que uses con su número entre corchetes, por ejemplo [1] o [2, 3], justo después de la frase
  que se apoya en ellos.
- Si la herramienta no devuelve resultados, o ninguno responde a la pregunta, contesta exactamente:
  "${NO_INFO_ANSWER}" y no cites nada.
- Responde siempre en español, de forma clara y breve. Si hay pasos, usa una lista numerada.
- No incluyas enlaces ni URLs: la aplicación muestra las fuentes aparte.
- Para saludos o agradecimientos responde con naturalidad sin buscar.`;

type AgentModel = ConstructorParameters<typeof Agent>[0]['model'];

export function createTutorialsAgent(opts: {
  /** Cadena del router de Mastra ('openai/gpt-…') o un modelo del AI SDK. */
  model: AgentModel;
  searchTool: ReturnType<typeof createSearchTool>;
  memory?: MastraMemory;
}) {
  return new Agent({
    id: 'tutorialsAgent',
    name: 'Asistente de videotutoriales de Ofimedic',
    instructions: AGENT_INSTRUCTIONS,
    model: opts.model,
    tools: { searchTutorials: opts.searchTool },
    memory: opts.memory,
  });
}
