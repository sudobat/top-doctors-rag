import pg from 'pg';

let shared: pg.Pool | undefined;

export function createPool(connectionString: string): pg.Pool {
  return new pg.Pool({ connectionString, max: 10 });
}

/** Pool único por proceso para el servidor. */
export function getPool(connectionString: string): pg.Pool {
  shared ??= createPool(connectionString);
  return shared;
}

/** Formato literal de pgvector: '[0.1,0.2,...]'. */
export function toVectorLiteral(values: number[]): string {
  return `[${values.join(',')}]`;
}
