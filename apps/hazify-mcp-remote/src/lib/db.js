import { createDatabasePool, tryAcquireAdvisoryLock } from '@hazify/db-core';

// Singleton pool instance for the remote MCP
let pool = null;

export function getDbPool() {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      console.warn('DATABASE_URL is niet ingesteld. Database lock / functionaliteit wordt overgeslagen als mocks actief zijn, anders zal dit falen.');
      return null;
    }
    const isLocalMock = process.env.NODE_ENV === 'test';
    pool = createDatabasePool(connectionString, !isLocalMock);
  }
  return pool;
}

/**
 * Convenience wrapper om een lock te krijgen voor een theme bestand.
 */
export async function tryAcquireThemeFileLock(themeId, fileKey) {
  if (!process.env.DATABASE_URL) {
    // Return dummy lock in contexten zonder DB URL (zoals unit tests)
    return async () => {};
  }
  const dbPool = getDbPool();
  const lockKeyString = `theme:${themeId}:${fileKey}`;
  return tryAcquireAdvisoryLock(dbPool, lockKeyString);
}
