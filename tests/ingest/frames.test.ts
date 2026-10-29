import { existsSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { extractFrame, frameRelPath, frameSecond } from '../../src/ingest/frames.js';
import { runCommand } from '../../src/youtube/ytdlp.js';

describe('frameSecond', () => {
  it('toma el fotograma unos segundos después del inicio', () => {
    expect(frameSecond(20, 4, 118)).toBe(24);
  });

  it('no se pasa del final del vídeo', () => {
    expect(frameSecond(115, 4, 118)).toBe(117);
  });

  it('sin duración conocida usa el desplazamiento tal cual', () => {
    expect(frameSecond(10.6, 4, null)).toBe(14);
  });
});

describe('frameRelPath', () => {
  it('guarda en <video_id>/<segundo>.jpg', () => {
    expect(frameRelPath('D_ZyBqvO4hY', 24)).toBe('D_ZyBqvO4hY/24.jpg');
  });
});

describe('extractFrame', () => {
  it('extrae un JPEG con ffmpeg', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'frames-'));
    const video = path.join(dir, 'v.mp4');
    await runCommand('ffmpeg', ['-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=duration=3:size=320x240:rate=10', video]);
    const out = path.join(dir, 'abc', '2.jpg');
    await extractFrame('ffmpeg', video, 2, out, runCommand);
    expect(existsSync(out)).toBe(true);
  });
});
