import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** Ejecuta un binario y devuelve su stdout. Inyectable para los tests. */
export type CommandRunner = (bin: string, args: string[]) => Promise<string>;

export const runCommand: CommandRunner = async (bin, args) => {
  const { stdout } = await execFileAsync(bin, args, { maxBuffer: 256 * 1024 * 1024 });
  return stdout;
};

export interface YtDlpOptions {
  bin: string;
  cookies?: string;
  jsRuntime?: string;
}

/** Argumentos comunes: cookies y runtime JS ayudan a pasar el control antibots de YouTube. */
export function baseArgs(opts: YtDlpOptions): string[] {
  const args = ['--no-warnings', '--no-progress'];
  if (opts.cookies) args.push('--cookies', opts.cookies);
  if (opts.jsRuntime) args.push('--js-runtimes', opts.jsRuntime);
  return args;
}

export function watchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}
