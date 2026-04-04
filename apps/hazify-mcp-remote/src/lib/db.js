import crypto from "crypto";
import { createDatabasePool, tryAcquireAdvisoryLock } from "@hazify/db-core";

let pool = null;
let themeDraftSchemaPromise = null;
let testPoolOverride = null;

function hasDatabaseUrl() {
  return Boolean(String(process.env.DATABASE_URL || "").trim());
}

function hasTestPoolOverride() {
  return String(process.env.NODE_ENV || "").trim().toLowerCase() === "test" && Boolean(testPoolOverride);
}

function getPoolSource() {
  if (hasDatabaseUrl()) {
    return "database";
  }
  if (hasTestPoolOverride()) {
    return "test";
  }
  return null;
}

function assertThemeDraftDatabaseAvailable() {
  if (getPoolSource()) {
    return;
  }
  throw new Error(
    "DATABASE_URL is verplicht voor theme draft persistence en advisory locks. In tests moet expliciet een test pool override gezet worden."
  );
}

function serializeJson(value, { allowNull = false } = {}) {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return allowNull ? null : undefined;
  }
  return JSON.stringify(value);
}

export function setThemeDraftTestPoolOverride(nextPool) {
  testPoolOverride = nextPool || null;
  pool = null;
  themeDraftSchemaPromise = null;
}

export function clearThemeDraftTestPoolOverride() {
  testPoolOverride = null;
  pool = null;
  themeDraftSchemaPromise = null;
}

export function getDbPool() {
  if (pool) {
    return pool;
  }

  const source = getPoolSource();
  if (!source) {
    assertThemeDraftDatabaseAvailable();
    return null;
  }

  if (source === "test") {
    pool = testPoolOverride;
    return pool;
  }

  const connectionString = String(process.env.DATABASE_URL || "").trim();
  const isLocalMock = process.env.NODE_ENV === "test";
  pool = createDatabasePool(connectionString, !isLocalMock);
  return pool;
}

async function ensureThemeDraftSchema() {
  assertThemeDraftDatabaseAvailable();

  if (!themeDraftSchemaPromise) {
    const dbPool = getDbPool();
    const source = getPoolSource();
    const schemaSql =
      source === "database"
        ? `
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
    `
        : `
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
    `;

    themeDraftSchemaPromise = dbPool.query(schemaSql).catch((error) => {
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
  const draftId = crypto.randomUUID();

  const result = await dbPool.query(
    `INSERT INTO theme_drafts (
      id,
      shop_domain,
      status,
      files_json,
      reference_input_json,
      reference_spec_json,
      preview_theme_id
    ) VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING *`,
    [
      draftId,
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

  const assignments = [];
  const values = [];
  const mapping = {
    status: updates.status,
    files_json: updates.files ? JSON.stringify(updates.files) : undefined,
    reference_input_json: serializeJson(updates.referenceInput, { allowNull: true }),
    reference_spec_json: serializeJson(updates.referenceSpec, { allowNull: true }),
    lint_report_json: serializeJson(updates.lintReport, { allowNull: true }),
    verify_result_json: serializeJson(updates.verifyResult, { allowNull: true }),
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
  const result = await dbPool.query(`SELECT * FROM theme_drafts WHERE id = $1`, [
    normalizeDraftId(draftId),
  ]);
  return result.rows[0] || null;
}

export async function tryAcquireThemeFileLock(themeId, fileKey) {
  await ensureThemeDraftSchema();
  const dbPool = getDbPool();
  const lockKeyString = `theme:${themeId}:${fileKey}`;
  return tryAcquireAdvisoryLock(dbPool, lockKeyString);
}
