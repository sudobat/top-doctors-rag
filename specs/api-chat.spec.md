---
name: API conversacional de tutoriales
description: Endpoint HTTP en Mastra que responde preguntas en español a partir de los fragmentos de los vídeos, con memoria por hilo, capturas y enlaces al segundo exacto.
targets:
  - ../src/mastra/**/*.ts
  - ../src/rag/**/*.ts
---

# API conversacional de tutoriales

La API la consume solo el backend de la aplicación de Ofimedic (más adelante, también una
aplicación de escritorio). Es independiente del cliente y responde JSON.

## Contrato

```http
POST /v1/chat
Authorization: Bearer <RAG_SERVICE_KEY>
Content-Type: application/json

{ "threadId": "conv-123", "message": "¿Cómo busco disponibilidad por concepto?", "userId": "u-42" }
```

```json
{
  "threadId": "conv-123",
  "answer": "Para buscar disponibilidad… [1]",
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

- `userId` es opcional. Identifica al propietario de los hilos (`resourceId` en la memoria de
  Mastra). Si falta, se usa `backend`.
  `[@test] ../tests/rag/chat.test.ts`

## Autenticación

- `/v1/*` exige `Authorization: Bearer <RAG_SERVICE_KEY>`. Si falta o es incorrecta, devuelve
  401 `{ "error": "unauthorized" }`. La comparación se hace en tiempo constante.
  `[@test] ../tests/mastra/auth.test.ts`
- `/frames/*` y `/health` son públicos para que el cliente pueda mostrar las capturas. Solo
  contienen fotogramas de vídeos públicos.
  `[@test] ../tests/mastra/auth.test.ts`

## Validación

- Si `message` está vacío o falta, o `threadId` falta, devuelve 400 `{ "error": "invalid_request" }`.
  `[@test] ../tests/rag/chat.test.ts`

## Respuesta

- El agente busca con la herramienta `searchTutorials`, formulando la consulta a partir del hilo, de
  modo que entiende las repreguntas ("¿y cómo lo deshago?").
  `[@test] ../tests/rag/chat.test.ts`
- La búsqueda devuelve los `SEARCH_TOP_K` (8) fragmentos más similares por coseno con similitud
  ≥ `MIN_SIMILARITY` (0,35).
  `[@test] ../tests/rag/search.test.ts`
- Responde en español y solo con la información de los fragmentos, citándolos como `[n]`.
  `[@test] ../tests/rag/chat.test.ts`
- `sources` contiene los fragmentos citados en la respuesta, en orden de cita. Como máximo
  `MAX_SOURCES` (3) y uno por vídeo.
  `[@test] ../tests/rag/sources.test.ts`
- Enlace: `https://www.youtube.com/watch?v=<id>&t=<startSec>s`. Captura:
  `<PUBLIC_BASE_URL>/frames/<id>/<segundo>.jpg`.
  `[@test] ../tests/rag/sources.test.ts`

## Sin información

- Si ningún fragmento supera el umbral, el agente responde que no ha encontrado esa información en
  los videotutoriales, sin inventar, y `sources` va vacío.
  `[@test] ../tests/rag/chat.test.ts`

## Memoria

- La conversación se guarda en el mismo Postgres (`PostgresStore` de Mastra), con los últimos
  `MEMORY_LAST_MESSAGES` (20) mensajes como contexto.
  `[@test] ../tests/rag/chat.test.ts`

## Capturas

- `GET /frames/<videoId>/<segundo>.jpg` sirve el fichero desde `FRAMES_DIR`. Las rutas con `..` o
  nombres no válidos devuelven 404.
  `[@test] ../tests/mastra/frames.test.ts`
