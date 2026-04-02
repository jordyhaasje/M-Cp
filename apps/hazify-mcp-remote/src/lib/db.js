import { createDatabasePool, tryAcquireAdvisoryLock } from '@hazify/db-core';

// Singleton pool instance for the remote MCP
let pool = null;
let themeDraftSchemaPromise = null;
const inMemoryThemeDrafts = new Map();

function allowInMemoryThemeDrafts() {
  const nodeEnv = String(process.env.NODE_ENV || "").trim().toLowerCase();
  if (nodeEnv === "production") {
    return false;
  }
  return true;
}

function assertThemeDraftDatabaseAvailable() {
  if (process.env.DATABASE_URL) {
    return;
  }
  if (allowInMemoryThemeDrafts()) {
    return;
  }
  throw new Error(
    "DATABASE_URL is verplicht voor theme draft persistence en advisory locks in productie."
  );
}

export function getDbPool() {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      if (allowInMemoryThemeDrafts()) {
        console.warn(
          'DATABASE_URL is niet ingesteld. In-memory theme draft fallback is actief buiten productie.'
        );
      }
      return null;
    }
    const isLocalMock = process.env.NODE_ENV === 'test';
    pool = createDatabasePool(connectionString, !isLocalMock);
  }
  return pool;
}

async function ensureThemeDraftSchema() {
  if (!process.env.DATABASE_URL) {
    assertThemeDraftDatabaseAvailable();
    return null;
  }

  if (!themeDraftSchemaPromise) {
    const dbPool = getDbPool();
    themeDraftSchemaPromise = dbPool.query(`
      CREATE EXTENSION IF NOT EXISTS pgcrypto;

      CREATE TABLE IF NOT EXISTS theme_drafts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        shop_domain TEXT NOT NULL,
        status TEXT NOT NULL,
        files_json JSONB NOT NULL DEFAULT '[]'::jsonb,
        reference_input_json JSONB,
        reference_spec_json JSONB,
        lint_report_json JSONB,
        verify_result_json JSONB,
        preview_theme_id BIGINT,
        applied_theme_id BIGINT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      ALTER TABLE theme_drafts ADD COLUMN IF NOT EXISTS reference_input_json JSONB;
      ALTER TABLE theme_drafts ADD COLUMN IF NOT EXISTS reference_spec_json JSONB;
      ALTER TABLE theme_drafts ADD COLUMN IF NOT EXISTS lint_report_json JSONB;
      ALTER TABLE theme_drafts ADD COLUMN IF NOT EXISTS verify_result_json JSONB;
      ALTER TABLE theme_drafts ADD COLUMN IF NOT EXISTS preview_theme_id BIGINT;
      ALTER TABLE theme_drafts ADD COLUMN IF NOT EXISTS applied_theme_id BIGINT;
      ALTER TABLE theme_drafts ALTER COLUMN files_json SET DEFAULT '[]'::jsonb;
    `).catch((error) => {
      themeDraftSchemaPromise = null;
      throw error;
    });
  }

  await themeDraftSchemaPromise;
  return getDbPool();
}

function normalizeDraftId(value) {
  const draftId = String(value || "").trim();
  if (!draftId) {
    throw new Error("draftId is verplicht.");
  }
  return draftId;
}

export async function createThemeDraftRecord({
  shopDomain,
  status,
  files,
  referenceInput = null,
  referenceSpec = null,
  previewThemeId = null,
} = {}) {
  const dbPool = await ensureThemeDraftSchema();
  if (!dbPool) {
    const id = `mock-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
    const record = {
      id,
      shop_domain: shopDomain,
      status,
      files_json: Array.isArray(files) ? files : [],
      reference_input_json: referenceInput,
      reference_spec_json: referenceSpec,
      lint_report_json: null,
      verify_result_json: null,
      preview_theme_id: previewThemeId,
      applied_theme_id: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    inMemoryThemeDrafts.set(id, record);
    return record;
  }

  const result = await dbPool.query(
    `INSERT INTO theme_drafts (
      shop_domain,
      status,
      files_json,
      reference_input_json,
      reference_spec_json,
      preview_theme_id
    ) VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING *`,
    [
      shopDomain,
      status,
      JSON.stringify(Array.isArray(files) ? files : []),
      referenceInput ? JSON.stringify(referenceInput) : null,
      referenceSpec ? JSON.stringify(referenceSpec) : null,
      previewThemeId,
    ]
  );

  return result.rows[0] || null;
}

export async function updateThemeDraftRecord(draftId, updates = {}) {
  const dbPool = await ensureThemeDraftSchema();
  if (!dbPool) {
    const existing = inMemoryThemeDrafts.get(normalizeDraftId(draftId));
    if (!existing) {
      return null;
    }
    const next = {
      ...existing,
      ...(updates.status !== undefined ? { status: updates.status } : {}),
      ...(updates.files !== undefined ? { files_json: updates.files } : {}),
      ...(updates.referenceInput !== undefined ? { reference_input_json: updates.referenceInput } : {}),
      ...(updates.referenceSpec !== undefined ? { reference_spec_json: updates.referenceSpec } : {}),
      ...(updates.lintReport !== undefined ? { lint_report_json: updates.lintReport } : {}),
      ...(updates.verifyResult !== undefined ? { verify_result_json: updates.verifyResult } : {}),
      ...(updates.previewThemeId !== undefined ? { preview_theme_id: updates.previewThemeId } : {}),
      ...(updates.appliedThemeId !== undefined ? { applied_theme_id: updates.appliedThemeId } : {}),
      updated_at: new Date().toISOString(),
    };
    inMemoryThemeDrafts.set(normalizeDraftId(draftId), next);
    return next;
  }

  const assignments = [];
  const values = [];
  const mapping = {
    status: updates.status,
    files_json: updates.files ? JSON.stringify(updates.files) : undefined,
    reference_input_json: updates.referenceInput ? JSON.stringify(updates.referenceInput) : updates.referenceInput === null ? null : undefined,
    reference_spec_json: updates.referenceSpec ? JSON.stringify(updates.referenceSpec) : updates.referenceSpec === null ? null : undefined,
    lint_report_json: updates.lintReport ? JSON.stringify(updates.lintReport) : updates.lintReport === null ? null : undefined,
    verify_result_json: updates.verifyResult ? JSON.stringify(updates.verifyResult) : updates.verifyResult === null ? null : undefined,
    preview_theme_id: updates.previewThemeId,
    applied_theme_id: updates.appliedThemeId,
  };

  for (const [column, value] of Object.entries(mapping)) {
    if (value === undefined) {
      continue;
    }
    assignments.push(`${column} = $${values.length + 1}`);
    values.push(value);
  }

  if (assignments.length === 0) {
    return getThemeDraftRecord(draftId);
  }

  values.push(normalizeDraftId(draftId));
  const result = await dbPool.query(
    `UPDATE theme_drafts
      SET ${assignments.join(", ")}, updated_at = NOW()
      WHERE id = $${values.length}
      RETURNING *`,
    values
  );

  return result.rows[0] || null;
}

export async function getThemeDraftRecord(draftId) {
  const dbPool = await ensureThemeDraftSchema();
  if (!dbPool) {
    return inMemoryThemeDrafts.get(normalizeDraftId(draftId)) || null;
  }

  const result = await dbPool.query(
    `SELECT * FROM theme_drafts WHERE id = $1`,
    [normalizeDraftId(draftId)]
  );
  return result.rows[0] || null;
}

/**
 * Convenience wrapper om een lock te krijgen voor een theme bestand.
 */
export async function tryAcquireThemeFileLock(themeId, fileKey) {
  if (!process.env.DATABASE_URL) {
    assertThemeDraftDatabaseAvailable();
    // Return dummy lock in contexten zonder DB URL (zoals unit tests)
    return async () => {};
  }
  const dbPool = getDbPool();
  const lockKeyString = `theme:${themeId}:${fileKey}`;
  return tryAcquireAdvisoryLock(dbPool, lockKeyString);
}
