import { createHash, timingSafeEqual } from 'node:crypto';

/** Rutas accesibles sin clave: capturas (las muestra el cliente) y `/health`, que trae Mastra. */
export function isPublicPath(path: string): boolean {
  return path === '/health' || path.startsWith('/frames/');
}

/** Compara `Authorization: Bearer <clave>` en tiempo constante. */
export function isAuthorized(header: string | undefined | null, serviceKey: string | undefined): boolean {
  if (!serviceKey || !header) return false;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match) return false;
  // Se comparan los hashes para que la longitud de la clave no afecte al tiempo.
  const a = createHash('sha256').update(match[1]).digest();
  const b = createHash('sha256').update(serviceKey).digest();
  return timingSafeEqual(a, b);
}
