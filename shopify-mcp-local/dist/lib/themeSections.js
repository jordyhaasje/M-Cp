import crypto from "crypto";

const SECTION_HANDLE_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SECTION_SCHEMA_PATTERN = /\{\%\s*schema\s*\%\}([\s\S]*?)\{\%\s*endschema\s*\%\}/i;
const SECTION_FILENAME_PATTERN = /^sections\/[a-z0-9]+(?:-[a-z0-9]+)*\.liquid$/;
const TEMPLATE_FILENAME_PATTERN = /^templates\/[a-z0-9][a-z0-9\-_.\/]*\.json$/;
const SNIPPET_FILENAME_PATTERN = /^snippets\/[a-z0-9]+(?:-[a-z0-9]+)*(?:--[a-z0-9]+(?:-[a-z0-9]+)*)*\.liquid$/;
const ASSET_FILENAME_PATTERN = /^assets\/sections-library\/[a-z0-9]+(?:-[a-z0-9]+)*\/[a-z0-9][a-z0-9\-_.\/]*\.(css|js|json|txt|svg)$/;
const UNSAFE_PATH_PATTERN = /(^\/|\\|\.\.|\u0000|\r|\n)/;
const DEFAULT_MAX_THEME_FILE_BYTES = 256 * 1024;

const parsedMaxThemeFileBytes = Number(process.env.HAZIFY_THEME_MAX_FILE_BYTES);
const MAX_THEME_FILE_BYTES = Number.isFinite(parsedMaxThemeFileBytes) && parsedMaxThemeFileBytes > 0
  ? parsedMaxThemeFileBytes
  : DEFAULT_MAX_THEME_FILE_BYTES;

function normalizeSectionHandle(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!SECTION_HANDLE_PATTERN.test(normalized)) {
    throw new Error("sectionHandle must contain lowercase letters, numbers, and dashes only");
  }
  return normalized;
}

function buildSectionFilename(sectionHandle) {
  return `sections/${normalizeSectionHandle(sectionHandle)}.liquid`;
}

function buildSectionLibraryStylesFilename(sectionHandle) {
  return `assets/sections-library/${normalizeSectionHandle(sectionHandle)}/styles.css`;
}

function assertAllowedThemeFilePath(filename, options = {}) {
  const value = String(filename || "").trim();
  if (!value) {
    throw new Error("Theme filename is required");
  }
  if (UNSAFE_PATH_PATTERN.test(value)) {
    throw new Error(`Invalid theme filename '${value}'`);
  }
  if (SECTION_FILENAME_PATTERN.test(value)) {
    return { normalized: value, kind: "section" };
  }
  if (options.allowTemplateJson && TEMPLATE_FILENAME_PATTERN.test(value)) {
    return { normalized: value, kind: "template" };
  }
  throw new Error(
    options.allowTemplateJson
      ? `Theme filename '${value}' is not allowed. Allowed: sections/*.liquid and templates/*.json`
      : `Theme filename '${value}' is not allowed. Allowed: sections/*.liquid`
  );
}

function assertAllowedSectionLibraryAssetPath(sectionHandle, relativeAssetPath) {
  const safeSectionHandle = normalizeSectionHandle(sectionHandle);
  const normalizedRelativePath = String(relativeAssetPath || "").trim().toLowerCase();
  if (!normalizedRelativePath) {
    throw new Error("Asset path is required");
  }
  if (UNSAFE_PATH_PATTERN.test(normalizedRelativePath)) {
    throw new Error(`Invalid asset path '${relativeAssetPath}'`);
  }
  const filename = `assets/sections-library/${safeSectionHandle}/${normalizedRelativePath}`;
  if (!ASSET_FILENAME_PATTERN.test(filename)) {
    throw new Error(
      `Asset filename '${filename}' is not allowed. Allowed: assets/sections-library/<id>/*.(css|js|json|txt|svg)`
    );
  }
  return filename;
}

function buildScopedSnippetFilename(sectionHandle, snippetName) {
  const safeSectionHandle = normalizeSectionHandle(sectionHandle);
  const safeSnippetHandle = normalizeSectionHandle(snippetName);
  const filename = `snippets/${safeSectionHandle}--${safeSnippetHandle}.liquid`;
  if (!SNIPPET_FILENAME_PATTERN.test(filename)) {
    throw new Error(`Snippet filename '${filename}' is not allowed`);
  }
  return filename;
}

function assertThemeFileSize(content, label = "Theme file") {
  if (typeof content !== "string") {
    throw new Error(`${label} content must be a string`);
  }
  const sizeBytes = Buffer.byteLength(content, "utf8");
  if (sizeBytes > MAX_THEME_FILE_BYTES) {
    throw new Error(`${label} exceeds ${MAX_THEME_FILE_BYTES} bytes`);
  }
  return sizeBytes;
}

function extractSectionSchema(liquid) {
  if (typeof liquid !== "string") {
    return { schema: null, error: "Liquid content must be a string" };
  }
  const match = liquid.match(SECTION_SCHEMA_PATTERN);
  if (!match) {
    return { schema: null, error: "Section liquid is missing a {% schema %} ... {% endschema %} block" };
  }
  const rawSchema = match[1].trim();
  if (!rawSchema) {
    return { schema: null, error: "Section schema block is empty" };
  }
  try {
    const schema = JSON.parse(rawSchema);
    return { schema, error: null };
  } catch (error) {
    return {
      schema: null,
      error: `Section schema JSON is invalid: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function validateThemeSectionInput({ sectionHandle, liquid, targetTemplate }) {
  const errors = [];
  const warnings = [];

  let normalizedHandle = null;
  try {
    normalizedHandle = normalizeSectionHandle(sectionHandle);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }

  if (typeof liquid !== "string" || !liquid.trim()) {
    errors.push("Liquid content is required");
  }

  let sizeBytes = null;
  if (!errors.length) {
    try {
      sizeBytes = assertThemeFileSize(liquid, "Section file");
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  let schema = null;
  if (!errors.length) {
    const parsedSchema = extractSectionSchema(liquid);
    schema = parsedSchema.schema;
    if (parsedSchema.error) {
      errors.push(parsedSchema.error);
    }
  }

  if (schema && (typeof schema !== "object" || Array.isArray(schema))) {
    errors.push("Section schema JSON must be an object");
  }

  if (schema && typeof schema === "object") {
    if (typeof schema.name !== "string" || !schema.name.trim()) {
      warnings.push("Section schema should include a non-empty 'name'");
    }
    if (!Array.isArray(schema.settings)) {
      warnings.push("Section schema should include a 'settings' array");
    }
    if (!Array.isArray(schema.presets) || schema.presets.length === 0) {
      warnings.push("Section schema has no presets; section may not be addable from the theme editor");
    }
  }

  let normalizedTemplatePath = null;
  if (typeof targetTemplate === "string" && targetTemplate.trim()) {
    try {
      normalizedTemplatePath = assertAllowedThemeFilePath(targetTemplate, { allowTemplateJson: true }).normalized;
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    sectionHandle: normalizedHandle,
    sectionFilename: normalizedHandle ? `sections/${normalizedHandle}.liquid` : null,
    targetTemplate: normalizedTemplatePath,
    schema,
    sizeBytes,
  };
}

function parseThemeFileBody(body) {
  if (body && typeof body.content === "string") {
    return {
      type: "TEXT",
      text: body.content,
      sizeBytes: Buffer.byteLength(body.content, "utf8"),
    };
  }
  if (body && typeof body.contentBase64 === "string") {
    const decoded = Buffer.from(body.contentBase64, "base64").toString("utf8");
    return {
      type: "BASE64",
      text: decoded,
      sizeBytes: Buffer.byteLength(decoded, "utf8"),
    };
  }
  if (body && typeof body.url === "string") {
    return {
      type: "URL",
      text: null,
      url: body.url,
      sizeBytes: null,
    };
  }
  return {
    type: "UNKNOWN",
    text: null,
    sizeBytes: null,
  };
}

function parseTemplateJson(templateText, templatePath) {
  if (typeof templateText !== "string" || !templateText.trim()) {
    throw new Error(`Template file '${templatePath}' is empty`);
  }

  let parsed;
  try {
    parsed = JSON.parse(templateText);
  } catch (error) {
    throw new Error(
      `Template file '${templatePath}' contains invalid JSON: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Template file '${templatePath}' must contain a JSON object`);
  }

  const sections = parsed.sections;
  const order = parsed.order;

  if (!sections || typeof sections !== "object" || Array.isArray(sections)) {
    throw new Error(`Template file '${templatePath}' must include a sections object`);
  }
  if (!Array.isArray(order)) {
    throw new Error(`Template file '${templatePath}' must include an order array`);
  }

  return {
    parsed,
    sections,
    order,
  };
}

function insertSectionInTemplate({ templateData, sectionKey, sectionType, position, referenceSectionId, settings }) {
  const normalizedKey = String(sectionKey || "").trim();
  if (!normalizedKey) {
    throw new Error("section key is required for template injection");
  }

  if (Object.prototype.hasOwnProperty.call(templateData.sections, normalizedKey)) {
    throw new Error(
      `Template already contains section id '${normalizedKey}'. Choose a different section id or remove the existing section first.`
    );
  }

  const nextSections = {
    ...templateData.sections,
    [normalizedKey]: {
      type: String(sectionType || "").trim(),
      settings: settings && typeof settings === "object" && !Array.isArray(settings) ? settings : {},
    },
  };

  const nextOrder = [...templateData.order];

  if (position === "before" || position === "after") {
    if (!referenceSectionId || typeof referenceSectionId !== "string") {
      throw new Error(`position '${position}' requires referenceSectionId`);
    }
    const referenceIndex = nextOrder.indexOf(referenceSectionId);
    if (referenceIndex < 0) {
      throw new Error(`referenceSectionId '${referenceSectionId}' was not found in template order`);
    }
    const targetIndex = position === "before" ? referenceIndex : referenceIndex + 1;
    nextOrder.splice(targetIndex, 0, normalizedKey);
  } else if (position === "start") {
    nextOrder.unshift(normalizedKey);
  } else {
    nextOrder.push(normalizedKey);
  }

  const dedupedOrder = [];
  const seen = new Set();
  for (const key of nextOrder) {
    if (typeof key !== "string" || !key.trim()) {
      continue;
    }
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    dedupedOrder.push(key);
  }

  const updated = {
    ...templateData.parsed,
    sections: nextSections,
    order: dedupedOrder,
  };

  const updatedText = `${JSON.stringify(updated, null, 2)}\n`;
  const sizeBytes = assertThemeFileSize(updatedText, "Template file");

  return {
    updated,
    updatedText,
    sizeBytes,
  };
}

function createThemeAuditId() {
  return `audit_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
}

export {
  ASSET_FILENAME_PATTERN,
  MAX_THEME_FILE_BYTES,
  SNIPPET_FILENAME_PATTERN,
  assertAllowedThemeFilePath,
  assertAllowedSectionLibraryAssetPath,
  assertThemeFileSize,
  buildScopedSnippetFilename,
  buildSectionFilename,
  buildSectionLibraryStylesFilename,
  createThemeAuditId,
  extractSectionSchema,
  insertSectionInTemplate,
  normalizeSectionHandle,
  parseTemplateJson,
  parseThemeFileBody,
  validateThemeSectionInput,
};
