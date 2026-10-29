# RAG de videotutoriales de Ofimedic

Responde preguntas sobre Ofimedic a partir de los videotutoriales del canal
[youtube.com/@ofimedic](https://www.youtube.com/@ofimedic). Cada respuesta incluye la captura de pantalla del
momento relevante y el enlace al vídeo en el segundo exacto.

- **Ingesta** (`npm run ingest`): lista el canal, descarga los subtítulos y el vídeo, trocea la transcripción,
  extrae un fotograma por fragmento, lo describe con un modelo de visión y guarda los embeddings en pgvector.
- **API** (Mastra, `POST /v1/chat`): agente conversacional con memoria por hilo que busca en los fragmentos y
  responde en español citando las fuentes.

Requisitos y comportamiento detallado: [`specs/ingesta.spec.md`](specs/ingesta.spec.md) y
[`specs/api-chat.spec.md`](specs/api-chat.spec.md).

```
YouTube ──yt-dlp──▶ subtítulos + vídeo ──▶ fragmentos de 45 s ──ffmpeg──▶ captura ──visión──▶ descripción
                                                    │                                          │
                                                    └──────────── embedding (OpenAI) ◀──────────┘
                                                                        │
                                                         Postgres + pgvector (rag_chunks)
                                                                        │
backend ──Bearer──▶ Mastra /v1/chat ──▶ agente ──searchTutorials──▶ top-k ──▶ respuesta + fuentes
```

## Puesta en marcha

Requisitos: Node 20+, Docker, `ffmpeg` y [`yt-dlp`](https://github.com/yt-dlp/yt-dlp) (`pip install yt-dlp`,
mantenedlo actualizado: YouTube cambia a menudo).

```bash
cp .env.example .env        # rellenar OPENAI_API_KEY y RAG_SERVICE_KEY
docker compose up -d        # Postgres 16 + pgvector
npm install
npm run db:migrate
```

Probar con unos pocos vídeos y arrancar la API:

```bash
npm run ingest -- --limit 5
npm run dev                 # http://localhost:4111
```

```bash
curl -s http://localhost:4111/v1/chat \
  -H "Authorization: Bearer $RAG_SERVICE_KEY" -H 'Content-Type: application/json' \
  -d '{"threadId":"prueba-1","message":"¿Cómo busco disponibilidad en las agendas por concepto?"}'
```

En producción: `npm run build && npm start`.

## API

`POST /v1/chat` con `Authorization: Bearer <RAG_SERVICE_KEY>`:

```json
{ "threadId": "conv-123", "message": "¿Y cómo lo deshago?", "userId": "u-42" }
```

- `threadId`: identificador de la conversación; lo genera vuestro backend. Con el mismo `threadId` el agente
  recuerda los mensajes anteriores (memoria en Postgres, esquema `mastra`).
- `userId` (opcional): propietario del hilo.

Respuesta:

```json
{
  "threadId": "conv-123",
  "answer": "En la agenda, pulsa **Buscar disponibilidad** y elige el concepto [1].",
  "sources": [
    {
      "videoId": "D_ZyBqvO4hY",
      "title": "Ofimedic 7.6.18 Buscador agendas por concepto",
      "startSec": 20,
      "url": "https://www.youtube.com/watch?v=D_ZyBqvO4hY&t=20s",
      "frameUrl": "http://localhost:4111/frames/D_ZyBqvO4hY/24.jpg",
      "excerpt": "Otra mejora que hemos incluido…"
    }
  ]
}
```

- La cita `[k]` de `answer` corresponde a `sources[k-1]`. Hay como máximo 3 fuentes, una por vídeo.
- Si los vídeos no cubren la pregunta, el agente lo dice y `sources` va vacío.
- Errores: `401 unauthorized`, `400 invalid_request` y `500 internal_error`.
- `GET /frames/<videoId>/<segundo>.jpg` y `GET /health` son públicos. El resto, incluidas las rutas `/api/*` de
  Mastra, exige la clave. Por eso Mastra Studio no funciona contra este servidor sin la clave.

## Ingesta

```bash
npm run ingest                              # incremental: vídeos nuevos + errores con reintentos disponibles
npm run ingest -- --limit 50                # procesa como máximo 50
npm run ingest -- --video <id>              # reprocesa un vídeo
npm run ingest -- --video <id> --whisper    # reprocesa transcribiendo con Whisper (subtítulos malos)
npm run ingest -- --retry-errors            # reintenta también los que agotaron los intentos
```

Estado de cada vídeo en `rag_videos`:

```sql
SELECT status, count(*) FROM rag_videos GROUP BY status;
SELECT video_id, title, last_error FROM rag_videos WHERE status <> 'done';
```

Cron diario en el servidor (un candado de Postgres evita que dos ejecuciones se solapen):

```cron
30 3 * * * cd /srv/ofimedic-rag && npm run ingest >> /var/log/ofimedic-rag-ingest.log 2>&1
```

### Carga inicial (~1.990 vídeos, ~103 h de vídeo)

- Genera unos 10.600 fragmentos, cada uno con una captura y una descripción visual. Procesa los vídeos uno a uno,
  así que dura muchas horas: lanzadla por tandas (`--limit 200`) o dejadla una noche. Si se corta, la siguiente
  ejecución continúa por donde iba.
- Coste aproximado de OpenAI con los modelos por defecto: del orden de 10 $ (casi todo es la descripción visual;
  los embeddings no llegan a 1 $). Revisad los precios vigentes.
- Las capturas ocupan ~1 GB en `FRAMES_DIR`. Los vídeos se borran tras procesarlos.
- Si YouTube responde *"Sign in to confirm you're not a bot"*, exportad las cookies de una cuenta con acceso al
  canal a un `cookies.txt` y apuntad `YTDLP_COOKIES` a ese fichero.

## Desarrollo

```bash
npm run typecheck
npm test          # tests unitarios; los de base de datos se omiten
npm run test:db   # todos, contra la base rag_test (la crea docker compose)
```

| Ruta | Contenido |
| --- | --- |
| `src/youtube/` | `yt-dlp`: listado del canal, subtítulos `json3`, descarga de vídeo y audio |
| `src/ingest/` | troceado, capturas, OpenAI (visión, embeddings, Whisper), pipeline y CLI |
| `src/db/` | esquema (`rag_videos`, `rag_chunks` con índice HNSW) y acceso a datos |
| `src/rag/` | búsqueda vectorial, herramienta y agente, selección de fuentes, flujo de chat |
| `src/mastra/` | servidor: `/v1/chat`, `/frames`, autenticación |

### Ajustes de calidad

- `MIN_SIMILARITY` (0,35): súbelo si aparecen fuentes poco relacionadas y bájalo si responde "no he encontrado"
  con demasiada frecuencia. Conviene calibrarlo con preguntas reales una vez hecha la carga.
- `CHUNK_WINDOW_SEC` / `CHUNK_OVERLAP_SEC` / `FRAME_OFFSET_SEC`: si los cambiáis, reprocesad con
  `UPDATE rag_videos SET status = 'pending'` y `npm run ingest`.
- Cambiar `EMBEDDING_MODEL` a uno con otra dimensión exige recrear `rag_chunks` y reprocesar todo.
