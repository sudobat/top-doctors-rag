---
name: Ingesta de videotutoriales
description: Convierte los vídeos del canal de YouTube de Ofimedic en fragmentos vectorizados (transcripción + descripción visual + captura) en Postgres/pgvector, de forma incremental y reanudable.
targets:
  - ../src/youtube/**/*.ts
  - ../src/ingest/**/*.ts
  - ../src/db/**/*.ts
---

# Ingesta de videotutoriales

Canal: `https://www.youtube.com/@ofimedic` (~1.990 vídeos, ~103 h, media ~3 min). La ingesta se
ejecuta en un servidor Linux propio con cron (`npm run ingest`). El canal es propiedad de Ofimedic,
por lo que descargar sus vídeos está autorizado.

## CLI

```bash
npm run ingest                         # incremental: procesa los vídeos nuevos y pendientes
npm run ingest -- --limit 20           # como máximo 20 vídeos en esta ejecución
npm run ingest -- --video <id>         # (re)procesa un vídeo concreto
npm run ingest -- --video <id> --whisper   # (re)procesa transcribiendo con Whisper
npm run ingest -- --retry-errors       # incluye vídeos en estado error aunque hayan agotado reintentos
```

## Listado del canal

- Se listan los vídeos con `yt-dlp --flat-playlist -J <canal>/videos`, sin descargar nada.
  `[@test] ../tests/youtube/channel.test.ts`
- Los vídeos que no están en `rag_videos` se registran como `pending`. Los ya registrados no se tocan.
  `[@test] ../tests/ingest/pipeline.test.ts`

## Transcripción

- Se usan los subtítulos de YouTube en español (`json3`), por orden de preferencia: manuales `es`,
  `es-ES` y automáticos `es-orig`.
  `[@test] ../tests/youtube/subtitles.test.ts`
- El parser de `json3` ignora los eventos sin texto (saltos de línea) y devuelve segmentos
  `{start, end, text}` en segundos.
  `[@test] ../tests/youtube/subtitles.test.ts`
- Whisper (API de OpenAI) se usa cuando se pide con `--whisper`, o cuando un vídeo no tiene
  subtítulos y `WHISPER_FALLBACK=true`. Sin subtítulos y sin fallback, el vídeo queda en estado
  `no_subtitles` y la ejecución continúa.
  `[@test] ../tests/ingest/pipeline.test.ts`

## Troceado

- Ventanas de `CHUNK_WINDOW_SEC` (45 s) con `CHUNK_OVERLAP_SEC` (10 s) de solapamiento. Cada
  fragmento empieza en el inicio de un segmento y conserva su segundo de inicio.
  `[@test] ../tests/ingest/chunk.test.ts`
- Un vídeo más corto que la ventana genera un único fragmento. Una transcripción vacía no genera
  fragmentos.
  `[@test] ../tests/ingest/chunk.test.ts`

## Capturas y descripción visual

- El vídeo se descarga a ≤720p con `yt-dlp` y, por cada fragmento, `ffmpeg` extrae un fotograma
  `FRAME_OFFSET_SEC` (4 s) después de su inicio, limitado a la duración del vídeo.
  `[@test] ../tests/ingest/frames.test.ts`
- El fotograma se guarda en `FRAMES_DIR/<video_id>/<segundo>.jpg`.
  `[@test] ../tests/ingest/frames.test.ts`
- Un modelo de OpenAI con visión (`VISION_MODEL`) describe la pantalla (ventana, menús, botones,
  campos) teniendo en cuenta lo que dice el narrador.
  `[@test] ../tests/ingest/pipeline.test.ts`
- El fichero de vídeo descargado se borra al terminar el vídeo, haya ido bien o mal.
  `[@test] ../tests/ingest/pipeline.test.ts`

## Embeddings y almacenamiento

- El texto vectorizado es: título + transcripción del fragmento + descripción de la pantalla.
  Modelo `text-embedding-3-small` (1536 dimensiones).
  `[@test] ../tests/ingest/pipeline.test.ts`
- Los fragmentos de un vídeo se sustituyen de forma atómica (transacción): reprocesar un vídeo
  nunca deja fragmentos duplicados ni a medias.
  `[@test] ../tests/db/store.test.ts`

## Robustez

- Si falla un vídeo (privado, borrado, error de red o de API), se guarda el error, se incrementan
  sus intentos y la ejecución sigue con el siguiente. Tras `MAX_ATTEMPTS` (3) intentos ya no se
  reintenta salvo con `--retry-errors` o `--video`.
  `[@test] ../tests/ingest/pipeline.test.ts`
- Un candado consultivo de Postgres impide que dos ejecuciones del cron se solapen. La segunda
  termina sin hacer nada.
  `[@test] ../tests/db/store.test.ts`
- Para evitar el bloqueo antibots de YouTube se pueden pasar cookies (`YTDLP_COOKIES`) y un
  runtime de JavaScript (`YTDLP_JS_RUNTIME`, por defecto `node`).
  `[@test] ../tests/youtube/channel.test.ts`
