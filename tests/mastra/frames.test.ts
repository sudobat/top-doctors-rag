import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { readFrame, resolveFramePath } from '../../src/mastra/frames.js';

describe('capturas', () => {
  it('lee la captura de FRAMES_DIR/<video>/<segundo>.jpg', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'frames-'));
    await mkdir(path.join(dir, 'D_ZyBqvO4hY'));
    await writeFile(path.join(dir, 'D_ZyBqvO4hY', '24.jpg'), 'jpg');
    expect((await readFrame(dir, 'D_ZyBqvO4hY', '24.jpg'))?.toString()).toBe('jpg');
    expect(await readFrame(dir, 'D_ZyBqvO4hY', '25.jpg')).toBeNull();
  });

  it('rechaza rutas que intentan salir del directorio o nombres no válidos', () => {
    expect(resolveFramePath('/data', '..', '24.jpg')).toBeNull();
    expect(resolveFramePath('/data', 'D_ZyBqvO4hY', '../../etc/passwd')).toBeNull();
    expect(resolveFramePath('/data', 'D_ZyBqvO4hY', '24.png')).toBeNull();
    expect(resolveFramePath('/data', 'D_ZyBqvO4hY', '24.jpg')).toBe('/data/D_ZyBqvO4hY/24.jpg');
  });
});
