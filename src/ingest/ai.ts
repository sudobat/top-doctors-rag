import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import OpenAI from 'openai';
import type { Segment } from '../youtube/subtitles.js';

/** Operaciones de IA de la ingesta; se sustituye por un doble en los tests. */
export interface IngestAi {
  describeFrame(imagePath: string, context: { title: string; transcript: string }): Promise<string>;
  embed(texts: string[]): Promise<number[][]>;
  transcribe(audioPath: string): Promise<Segment[]>;
}

const DESCRIBE_PROMPT = `Eres un asistente que documenta capturas de pantalla de videotutoriales del software médico Ofimedic.
Describe en español, en 2-5 frases, lo que se ve en la pantalla: módulo o ventana abierta, menús, pestañas,
botones, campos y opciones visibles (con su texto literal cuando sea legible) y la acción que parece realizarse.
Usa la transcripción solo como contexto. No inventes elementos que no se vean. Si los datos de pacientes son
visibles, no los transcribas.`;

/** Lotes por debajo del límite de la API de embeddings. */
const EMBED_BATCH = 100;

export function createOpenAIIngestAi(opts: {
  apiKey: string;
  visionModel: string;
  embeddingModel: string;
  whisperModel: string;
}): IngestAi {
  const client = new OpenAI({ apiKey: opts.apiKey, maxRetries: 5 });

  return {
    async describeFrame(imagePath, { title, transcript }) {
      const b64 = (await readFile(imagePath)).toString('base64');
      const res = await client.chat.completions.create({
        model: opts.visionModel,
        messages: [
          { role: 'system', content: DESCRIBE_PROMPT },
          {
            role: 'user',
            content: [
              { type: 'text', text: `Vídeo: ${title}\nTranscripción del fragmento: ${transcript}` },
              { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${b64}`, detail: 'high' } },
            ],
          },
        ],
      });
      return res.choices[0]?.message.content?.trim() ?? '';
    },

    async embed(texts) {
      const out: number[][] = [];
      for (let i = 0; i < texts.length; i += EMBED_BATCH) {
        const res = await client.embeddings.create({
          model: opts.embeddingModel,
          input: texts.slice(i, i + EMBED_BATCH),
        });
        out.push(...res.data.sort((a, b) => a.index - b.index).map((d) => d.embedding));
      }
      return out;
    },

    async transcribe(audioPath) {
      const res = await client.audio.transcriptions.create({
        model: opts.whisperModel,
        file: createReadStream(audioPath),
        language: 'es',
        response_format: 'verbose_json',
        timestamp_granularities: ['segment'],
      });
      return (res.segments ?? [])
        .map((s) => ({ start: s.start, end: s.end, text: s.text.trim() }))
        .filter((s) => s.text);
    },
  };
}
