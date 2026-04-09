import { Pool } from 'pg';
import crypto from 'crypto';

export function createDatabasePool(connectionString, ssl = true) {
  if (!connectionString) {
    throw new Error('DATABASE_URL is required to create a pool');
  }
  return new Pool({
    connectionString,
    max: 10,
    statement_timeout: 5000,
    ssl: ssl ? { rejectUnauthorized: false } : false,
  });
}

export function stringToAdvisoryLockKey(str) {
  const hash = crypto.createHash('md5').update(str).digest();
  return hash.readBigInt64BE(0).toString();
}

/**
 * Vraag een non-blocking PostgreSQL advisory lock aan op basis van een string key.
 * 
 * @param {Pool} pool - De PostgreSQL connectiepool
 * @param {string} keyString - De unieke resource string (bijv. "theme_id:file_key")
 * @returns {Promise<Function|null>} - Een release functie indien succesvol, null wanneer al gelocked
 */
export async function tryAcquireAdvisoryLock(pool, keyString) {
  const lockKey = stringToAdvisoryLockKey(keyString);
  const client = await pool.connect();
  let acquired = false;
  
  try {
    const result = await client.query('SELECT pg_try_advisory_lock($1::bigint) AS acquired', [lockKey]);
    acquired = Boolean(result.rows[0]?.acquired);
    
    if (!acquired) {
      client.release();
      return null;
    }
    
    // Return de ontsluitingscallback (aanroepen met await of fire-and-forget in een finally block)
    return async () => {
      try {
        await client.query('SELECT pg_advisory_unlock($1::bigint)', [lockKey]);
      } catch (_err) {
        // Best effort release
      } finally {
        client.release();
      }
    };
  } catch (err) {
    client.release();
    throw err;
  }
}
