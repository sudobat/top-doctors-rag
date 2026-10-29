import { describe, expect, it } from 'vitest';
import { listChannelVideos, videosTabUrl } from '../../src/youtube/channel.js';
import { baseArgs } from '../../src/youtube/ytdlp.js';

describe('listChannelVideos', () => {
  it('lista la pestaña de vídeos con --flat-playlist y normaliza las entradas', async () => {
    const calls: string[][] = [];
    const videos = await listChannelVideos(
      'https://www.youtube.com/@ofimedic',
      { bin: 'yt-dlp' },
      async (_bin, args) => {
        calls.push(args);
        return JSON.stringify({
          entries: [
            { id: 'abc123def45', title: 'Agenda', duration: 118.4 },
            { id: 'zzz999yyy88', title: null, duration: null },
            { title: 'sin id' },
          ],
        });
      },
    );
    expect(calls[0]).toContain('--flat-playlist');
    expect(calls[0].at(-1)).toBe('https://www.youtube.com/@ofimedic/videos');
    expect(videos).toEqual([
      { videoId: 'abc123def45', title: 'Agenda', durationSec: 118 },
      { videoId: 'zzz999yyy88', title: 'zzz999yyy88', durationSec: null },
    ]);
  });

  it('no duplica /videos si ya viene en la URL', () => {
    expect(videosTabUrl('https://www.youtube.com/@ofimedic/videos/')).toBe('https://www.youtube.com/@ofimedic/videos');
  });
});

describe('baseArgs', () => {
  it('pasa cookies y runtime JS cuando están configurados', () => {
    expect(baseArgs({ bin: 'yt-dlp', cookies: '/srv/cookies.txt', jsRuntime: 'node' })).toEqual([
      '--no-warnings', '--no-progress', '--cookies', '/srv/cookies.txt', '--js-runtimes', 'node',
    ]);
    expect(baseArgs({ bin: 'yt-dlp' })).toEqual(['--no-warnings', '--no-progress']);
  });
});
