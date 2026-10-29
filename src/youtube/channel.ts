import { baseArgs, type CommandRunner, type YtDlpOptions } from './ytdlp.js';

export interface ChannelVideo {
  videoId: string;
  title: string;
  durationSec: number | null;
}

export function videosTabUrl(channelUrl: string): string {
  const base = channelUrl.replace(/\/+$/, '');
  return /\/(videos|streams|shorts)$/.test(base) ? base : `${base}/videos`;
}

/** Lista los vídeos del canal sin descargarlos. */
export async function listChannelVideos(
  channelUrl: string,
  opts: YtDlpOptions,
  run: CommandRunner,
): Promise<ChannelVideo[]> {
  const out = await run(opts.bin, [...baseArgs(opts), '--flat-playlist', '-J', videosTabUrl(channelUrl)]);
  const data = JSON.parse(out) as { entries?: { id?: string; title?: string; duration?: number | null }[] };
  return (data.entries ?? [])
    .filter((e): e is { id: string; title?: string; duration?: number | null } => typeof e.id === 'string')
    .map((e) => ({
      videoId: e.id,
      title: e.title ?? e.id,
      durationSec: typeof e.duration === 'number' ? Math.round(e.duration) : null,
    }));
}
