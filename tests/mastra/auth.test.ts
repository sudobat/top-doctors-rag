import { describe, expect, it } from 'vitest';
import { isAuthorized, isPublicPath } from '../../src/mastra/auth.js';

describe('isAuthorized', () => {
  it('acepta la clave de servicio correcta', () => {
    expect(isAuthorized('Bearer s3cret', 's3cret')).toBe(true);
    expect(isAuthorized('bearer   s3cret ', 's3cret')).toBe(true);
  });
  it('rechaza claves incorrectas, ausentes o mal formadas', () => {
    expect(isAuthorized('Bearer otra', 's3cret')).toBe(false);
    expect(isAuthorized(undefined, 's3cret')).toBe(false);
    expect(isAuthorized('s3cret', 's3cret')).toBe(false);
  });
  it('sin RAG_SERVICE_KEY configurada no deja pasar nada', () => {
    expect(isAuthorized('Bearer ', undefined)).toBe(false);
    expect(isAuthorized('Bearer x', '')).toBe(false);
  });
});

describe('isPublicPath', () => {
  it('capturas y salud son públicas; la API y Mastra no', () => {
    expect(isPublicPath('/frames/abc/24.jpg')).toBe(true);
    expect(isPublicPath('/health')).toBe(true);
    expect(isPublicPath('/v1/chat')).toBe(false);
    expect(isPublicPath('/api/agents/tutorialsAgent/generate')).toBe(false);
    expect(isPublicPath('/framesX')).toBe(false);
  });
});
