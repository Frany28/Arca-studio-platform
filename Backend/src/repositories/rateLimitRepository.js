import { query } from "../config/db.js";

const MAX_COUNT = 2147483647;

/**
 * Incrementa de forma atómica uno o varios contadores de rate limiting compartidos en PostgreSQL.
 * Una sola sentencia INSERT ... ON CONFLICT DO UPDATE bloquea cada fila, así que las peticiones
 * concurrentes de distintas instancias cuentan exactamente; si la ventana expiró, la reinicia. Usa
 * el reloj de PostgreSQL para que todas las instancias compartan la misma referencia temporal.
 *
 * @param {Array<{ keyHash: Buffer, scope: string, windowMs: number }>} buckets - Contadores a incrementar, con claves distintas.
 * @returns {Promise<Array<{ keyHash: Buffer, count: number, retryAfterMs: number }>>} Estado de cada contador tras el incremento.
 * @throws {Error} Si PostgreSQL no está disponible o la consulta falla.
 */
export async function incrementRateLimitBuckets(buckets) {
  if (buckets.length === 0) return [];
  const params = [];
  const values = buckets.map(({ keyHash, scope, windowMs }) => {
    params.push(keyHash, scope, Math.max(1, Math.round(windowMs)));
    const offset = params.length - 3;
    return `($${offset + 1}::bytea, $${offset + 2}::varchar, 1, now(), now() + ($${offset + 3}::integer * interval '1 millisecond'), $${offset + 3}::integer)`;
  });

  const result = await query(
    `
      with input (key_hash, scope, count, window_started_at, expires_at, window_ms) as (
        values ${values.join(", ")}
      )
      insert into public.rate_limit_buckets as bucket (key_hash, scope, count, window_started_at, expires_at)
      -- Orden estable de bloqueo: dos peticiones con las mismas claves no pueden interbloquearse.
      select key_hash, scope, count, window_started_at, expires_at from input order by key_hash
      on conflict (key_hash) do update set
        count = case when bucket.expires_at <= now() then 1 else least(bucket.count + 1, ${MAX_COUNT}) end,
        window_started_at = case when bucket.expires_at <= now() then now() else bucket.window_started_at end,
        expires_at = case when bucket.expires_at <= now() then excluded.expires_at else bucket.expires_at end,
        scope = excluded.scope
      returning
        bucket.key_hash,
        bucket.count,
        greatest(0, ceil(extract(epoch from (bucket.expires_at - now())) * 1000))::bigint as retry_after_ms
    `,
    params,
  );

  return result.rows.map((row) => ({
    count: Number(row.count),
    keyHash: Buffer.from(row.key_hash),
    retryAfterMs: Number(row.retry_after_ms),
  }));
}

/**
 * Elimina por lotes los contadores cuya ventana ya terminó.
 * Limita el número de filas por ejecución para no bloquear la tabla ni alargar la petición que la dispara.
 *
 * @param {object} [options] - Opciones de limpieza.
 * @param {number} [options.limit=500] - Máximo de filas a eliminar en esta ejecución.
 * @returns {Promise<number>} Filas eliminadas.
 * @throws {Error} Si PostgreSQL no está disponible o la consulta falla.
 */
export async function deleteExpiredRateLimitBuckets({ limit = 500 } = {}) {
  const result = await query(
    `
      delete from public.rate_limit_buckets
      where key_hash in (
        select key_hash
        from public.rate_limit_buckets
        where expires_at < now()
        order by expires_at
        limit $1
        for update skip locked
      )
    `,
    [limit],
  );
  return result.rowCount || 0;
}
