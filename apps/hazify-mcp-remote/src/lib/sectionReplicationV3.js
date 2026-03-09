import crypto from "crypto";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";
import { chromium } from "playwright";
import { getThemeFile, resolveTheme, upsertThemeFile } from "./themeFiles.js";

if (!process.env.PLAYWRIGHT_BROWSERS_PATH) {
  process.env.PLAYWRIGHT_BROWSERS_PATH = "0";
}

const ThemeRoleSchema = z.enum(["main", "unpublished", "demo", "development"]);

const SECTION_SETTING_TYPES_WITHOUT_DEFAULT = new Set([
  "article",
  "blog",
  "collection",
  "image_picker",
  "page",
  "product",
]);

const NON_EMPTY_DEFAULT_TYPES = new Set(["text", "textarea", "url", "inline_richtext", "liquid"]);

const PREVIEW_TARGETS = [
  {
    id: "desktop",
    viewport: { width: 1440, height: 900 },
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
    threshold: 0.12,
  },
  {
    id: "mobile",
    viewport: { width: 390, height: 844 },
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1",
    threshold: 0.15,
  },
];

const REFERENCE_TIMEOUT_MS = Number(process.env.HAZIFY_SECTION_V3_REFERENCE_TIMEOUT_MS || 45000);
const BROWSER_TIMEOUT_MS = Number(process.env.HAZIFY_SECTION_V3_BROWSER_TIMEOUT_MS || 20000);

const VISUAL_DIFF_THRESHOLD = Number(process.env.HAZIFY_SECTION_V3_PIXEL_THRESHOLD || 0.08);

const TEMPLATE_ERROR_CODES = new Set([
  "template_missing_json",
  "template_missing_reference_section",
  "template_reference_section_missing",
]);

const SectionSchemaSettingSchema = z
  .object({
    type: z.string().min(1),
    id: z.string().optional(),
    label: z.string().optional(),
    default: z.unknown().optional(),
  })
  .passthrough();

const SectionBlockSchema = z
  .object({
    type: z.string().min(1),
    name: z.string().min(1),
    settings: z.array(SectionSchemaSettingSchema).default([]),
  })
  .passthrough();

const SectionPresetSchema = z
  .object({
    name: z.string().min(1),
    category: z.string().optional(),
    settings: z.record(z.unknown()).optional(),
    blocks: z
      .array(
        z
          .object({
            type: z.string().min(1),
            settings: z.record(z.unknown()).optional(),
          })
          .passthrough()
      )
      .optional(),
  })
  .passthrough();

const CompiledSectionSchema = z
  .object({
    name: z.string().min(1),
    tag: z.string().optional(),
    class: z.string().optional(),
    settings: z.array(SectionSchemaSettingSchema).default([]),
    blocks: z.array(SectionBlockSchema).default([]),
    presets: z.array(SectionPresetSchema).min(1),
    max_blocks: z.number().int().positive().optional(),
    limit: z.number().int().positive().optional(),
  })
  .passthrough();

const ArchetypeResultSchema = z.object({
  archetype: z.enum(["feature-tabs-media-slider", "slideshow-pro"]),
  confidence: z.number().min(0).max(1),
});

export const ReplicateSectionFromReferenceInputSchema = z.object({
  referenceUrl: z.string().url(),
  visionHints: z.string().max(12000).optional(),
  imageUrls: z.array(z.string().url()).max(10).default([]),
  themeId: z.coerce.number().int().positive().optional(),
  themeRole: ThemeRoleSchema.default("main"),
  sectionHandle: z.string().min(1).optional(),
  overwriteSection: z.boolean().default(false),
  addToTemplate: z.boolean().default(true),
  templateKey: z.string().default("templates/index.json"),
  sectionInstanceId: z.string().optional(),
  insertPosition: z.enum(["start", "end", "before", "after"]).default("end"),
  referenceSectionId: z.string().optional(),
  sectionSettings: z.record(z.unknown()).optional(),
  maxAttempts: z.number().int().min(1).max(4).default(3),
  verify: z.boolean().default(true),
});

const toIsoNow = () => new Date().toISOString();

const formatErrorMessage = (error) => {
  const raw = error instanceof Error ? error.message : String(error);
  return raw.length > 500 ? `${raw.slice(0, 497)}...` : raw;
};

const isPlaywrightBrowserMissingError = (error) => {
  const message = formatErrorMessage(error).toLowerCase();
  if (error && typeof error === "object" && error.code === "browser_runtime_unavailable") {
    return true;
  }
  return (
    message.includes("executable doesn't exist") ||
    (message.includes("playwright") && message.includes("install")) ||
    message.includes("chrome-headless-shell")
  );
};

const tokenize = (value) =>
  Array.from(
    new Set(
      String(value || "")
        .toLowerCase()
        .split(/[^a-z0-9]+/g)
        .filter((token) => token.length >= 3)
    )
  );

const stripHtml = (value) =>
  String(value || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const extractTagTexts = (html, tagName) => {
  const regex = new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "gi");
  const values = [];
  let match;
  while ((match = regex.exec(String(html || ""))) !== null) {
    const text = stripHtml(match[1]);
    if (text) {
      values.push(text);
    }
  }
  return values;
};

const humanizeHandle = (handle) =>
  String(handle || "")
    .split(/[-_]+/g)
    .filter(Boolean)
    .map((chunk) => chunk.charAt(0).toUpperCase() + chunk.slice(1))
    .join(" ") || "Custom Section";

export const normalizeSectionHandle = (rawHandle) => {
  const normalized = String(rawHandle || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "");

  if (!normalized) {
    throw new Error("sectionHandle is ongeldig na normalisatie; gebruik letters/cijfers en optioneel '-'.");
  }

  return normalized;
};

const deriveSectionHandle = (input) => {
  if (input.sectionHandle) {
    return normalizeSectionHandle(input.sectionHandle);
  }

  try {
    const url = new URL(input.referenceUrl);
    const segment = url.pathname.split("/").filter(Boolean).pop() || "replica-section";
    return normalizeSectionHandle(segment.replace(/\.(html?|php)$/i, ""));
  } catch (_error) {
    return normalizeSectionHandle("replica-section");
  }
};

const uniqueStrings = (values) =>
  Array.from(new Set(values.filter((value) => typeof value === "string" && value.trim()))).map((value) =>
    value.trim()
  );

const ensureJsonTemplateStructure = (rawValue, templateKey) => {
  let parsed;
  try {
    parsed = JSON.parse(String(rawValue || ""));
  } catch (_error) {
    throw new Error(`Template '${templateKey}' bevat ongeldige JSON.`);
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Template '${templateKey}' heeft geen geldig object root.`);
  }

  if (!parsed.sections || typeof parsed.sections !== "object" || Array.isArray(parsed.sections)) {
    parsed.sections = {};
  }

  if (!Array.isArray(parsed.order)) {
    parsed.order = Object.keys(parsed.sections);
  }

  return parsed;
};

const normalizeTemplateSectionId = (rawId) =>
  String(rawId || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "");

const pickSectionInstanceId = (sectionHandle, explicitId, templateJson) => {
  const requested = normalizeTemplateSectionId(explicitId);
  if (requested) {
    return requested;
  }

  const existing = templateJson?.sections || {};
  const base = normalizeTemplateSectionId(sectionHandle).replace(/-/g, "_") || "custom_section";
  let candidate = base;
  let index = 2;

  while (Object.prototype.hasOwnProperty.call(existing, candidate)) {
    candidate = `${base}_${index}`;
    index += 1;
  }

  return candidate;
};

const insertSectionOrder = (order, sectionId, insertPosition, referenceSectionId) => {
  const nextOrder = Array.isArray(order) ? [...order] : [];
  const withoutCurrent = nextOrder.filter((entry) => entry !== sectionId);

  if (insertPosition === "start") {
    return [sectionId, ...withoutCurrent];
  }

  if (insertPosition === "end") {
    return [...withoutCurrent, sectionId];
  }

  const anchorId = String(referenceSectionId || "").trim();
  if (!anchorId) {
    throw new Error(`referenceSectionId is verplicht bij insertPosition='${insertPosition}'.`);
  }

  const anchorIndex = withoutCurrent.indexOf(anchorId);
  if (anchorIndex < 0) {
    throw new Error(`referenceSectionId '${anchorId}' niet gevonden in template.order.`);
  }

  if (insertPosition === "before") {
    withoutCurrent.splice(anchorIndex, 0, sectionId);
    return withoutCurrent;
  }

  withoutCurrent.splice(anchorIndex + 1, 0, sectionId);
  return withoutCurrent;
};

const summarizeAssetRead = (asset) => ({
  key: asset?.key || null,
  checksum: asset?.checksum || null,
  valueBytes: typeof asset?.value === "string" ? Buffer.byteLength(asset.value, "utf8") : null,
  hasAttachment: Boolean(asset?.attachment),
  attachmentLength: typeof asset?.attachment === "string" ? asset.attachment.length : null,
});

const issue = (severity, code, message) => ({ severity, code, message });

const deriveStatus = (issues) => {
  if ((issues || []).some((entry) => entry.severity === "error")) {
    return "fail";
  }
  if ((issues || []).some((entry) => entry.severity === "warn")) {
    return "warn";
  }
  return "pass";
};

const toValidationCheck = (name, issues) => ({
  name,
  status: deriveStatus(issues),
  issues,
});

const buildTemplateInsertIssues = ({ insertPosition, referenceSectionId, templateJson }) => {
  const issues = [];

  if ((insertPosition === "before" || insertPosition === "after") && !referenceSectionId) {
    issues.push(issue("error", "template_missing_reference_section", `referenceSectionId is verplicht bij insertPosition='${insertPosition}'.`));
    return issues;
  }

  if ((insertPosition === "before" || insertPosition === "after") && referenceSectionId) {
    const exists = Array.isArray(templateJson.order) && templateJson.order.includes(referenceSectionId);
    if (!exists) {
      issues.push(
        issue(
          "error",
          "template_reference_section_missing",
          `referenceSectionId '${referenceSectionId}' niet gevonden in template.order.`
        )
      );
    }
  }

  return issues;
};

const runThemeContextPreflight = async ({
  shopifyClient,
  apiVersion,
  themeId,
  themeRole,
  sectionHandle,
  sectionKey,
  overwriteSection,
  addToTemplate,
  templateKey,
  insertPosition,
  referenceSectionId,
  sectionInstanceId,
}) => {
  const issues = [];
  const theme = await resolveTheme(shopifyClient, apiVersion, { themeId, themeRole });

  let sectionExists = false;
  try {
    await getThemeFile(shopifyClient, apiVersion, {
      themeId: theme.id,
      key: sectionKey,
    });
    sectionExists = true;
  } catch (error) {
    if (error?.status !== 404) {
      throw error;
    }
  }

  if (sectionExists && !overwriteSection) {
    issues.push(issue("error", "section_exists_overwrite_false", `Section '${sectionKey}' bestaat al en overwriteSection=false.`));
  }

  let template = null;
  if (addToTemplate) {
    const templateFile = await getThemeFile(shopifyClient, apiVersion, {
      themeId: theme.id,
      key: templateKey,
    });

    if (typeof templateFile?.asset?.value !== "string" || !templateFile.asset.value.trim()) {
      issues.push(
        issue(
          "error",
          "template_missing_json",
          `Template '${templateKey}' bevat geen leesbare JSON tekst (asset.value ontbreekt).`
        )
      );
    } else {
      const templateJson = ensureJsonTemplateStructure(templateFile.asset.value, templateKey);
      issues.push(...buildTemplateInsertIssues({ insertPosition, referenceSectionId, templateJson }));

      template = {
        key: templateKey,
        sectionIdCandidate: pickSectionInstanceId(sectionHandle, sectionInstanceId, templateJson),
        sectionsCount: Object.keys(templateJson.sections || {}).length,
        orderCount: Array.isArray(templateJson.order) ? templateJson.order.length : 0,
      };
    }
  }

  return {
    theme: {
      id: theme.id,
      name: theme.name,
      role: theme.role,
    },
    sectionKey,
    sectionExists,
    template,
    issues,
  };
};

const lintSchema = (schema) => {
  const issues = [];
  const parsed = CompiledSectionSchema.safeParse(schema);
  if (!parsed.success) {
    return {
      issues: parsed.error.issues.map((entry) =>
        issue("error", "schema_invalid", `Section schema invalid op '${entry.path.join(".") || "root"}': ${entry.message}`)
      ),
    };
  }

  const normalized = parsed.data;
  const sectionIds = [];
  const sectionIdSet = new Set();

  for (const setting of normalized.settings || []) {
    const type = String(setting?.type || "").toLowerCase().trim();
    const id = typeof setting?.id === "string" ? setting.id.trim() : "";

    if (!["header", "paragraph", "note"].includes(type) && !id) {
      issues.push(issue("error", "schema_invalid", `section.settings type '${type}' mist verplicht veld 'id'.`));
      continue;
    }

    if (id) {
      sectionIds.push(id);
      if (sectionIdSet.has(id)) {
        issues.push(issue("error", "schema_invalid", `section.settings bevat duplicate id '${id}'.`));
      }
      sectionIdSet.add(id);
    }

    if (Object.prototype.hasOwnProperty.call(setting, "default")) {
      if (SECTION_SETTING_TYPES_WITHOUT_DEFAULT.has(type)) {
        issues.push(issue("error", "schema_invalid", `section.settings '${id || type}' type '${type}' ondersteunt geen default.`));
      }

      if (typeof setting.default === "string" && NON_EMPTY_DEFAULT_TYPES.has(type) && !setting.default.trim()) {
        issues.push(
          issue(
            "error",
            "schema_invalid",
            `section.settings '${id || type}' type '${type}' heeft lege default string; laat default weg of geef een waarde.`
          )
        );
      }
    }
  }

  const blockTypeSet = new Set();
  for (const block of normalized.blocks || []) {
    const blockType = String(block?.type || "").trim();
    if (!blockType) {
      issues.push(issue("error", "schema_invalid", "section.blocks bevat item zonder type."));
      continue;
    }

    if (blockTypeSet.has(blockType)) {
      issues.push(issue("warn", "schema_invalid", `section.blocks bevat duplicate type '${blockType}'.`));
    }
    blockTypeSet.add(blockType);

    const blockSettingIds = new Set();
    for (const setting of block.settings || []) {
      const type = String(setting?.type || "").toLowerCase().trim();
      const id = typeof setting?.id === "string" ? setting.id.trim() : "";

      if (!["header", "paragraph", "note"].includes(type) && !id) {
        issues.push(issue("error", "schema_invalid", `block '${blockType}' setting type '${type}' mist verplicht veld 'id'.`));
        continue;
      }

      if (id) {
        if (blockSettingIds.has(id)) {
          issues.push(issue("error", "schema_invalid", `block '${blockType}' bevat duplicate setting id '${id}'.`));
        }
        blockSettingIds.add(id);
      }

      if (Object.prototype.hasOwnProperty.call(setting, "default")) {
        if (SECTION_SETTING_TYPES_WITHOUT_DEFAULT.has(type)) {
          issues.push(issue("error", "schema_invalid", `block '${blockType}' setting '${id || type}' type '${type}' ondersteunt geen default.`));
        }

        if (typeof setting.default === "string" && NON_EMPTY_DEFAULT_TYPES.has(type) && !setting.default.trim()) {
          issues.push(
            issue(
              "error",
              "schema_invalid",
              `block '${blockType}' setting '${id || type}' type '${type}' heeft lege default string; laat default weg of geef een waarde.`
            )
          );
        }
      }
    }
  }

  for (const preset of normalized.presets || []) {
    for (const presetBlock of preset.blocks || []) {
      if (!blockTypeSet.has(String(presetBlock?.type || "").trim())) {
        issues.push(
          issue(
            "error",
            "schema_invalid",
            `preset '${preset.name}' verwijst naar onbekend block type '${String(presetBlock?.type || "")}'.`
          )
        );
      }
    }
  }

  return { issues };
};

const escapeHtml = (value) =>
  String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");

const toRichText = (value) => {
  const text = stripHtml(value);
  if (!text) {
    return "<p>Describe this item.</p>";
  }
  return `<p>${escapeHtml(text)}</p>`;
};

const normalizeTextItem = (value, fallback) => {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text || fallback;
};

const pickCandidateTabs = (html, fallback) => {
  const candidates = [
    ...extractTagTexts(html, "button"),
    ...extractTagTexts(html, "a"),
    ...extractTagTexts(html, "li"),
  ];

  const filtered = [];
  const seen = new Set();
  for (const candidate of candidates) {
    const value = normalizeTextItem(candidate, "");
    const lower = value.toLowerCase();
    if (!value || value.length < 3 || value.length > 36) {
      continue;
    }
    const words = lower.split(/\s+/g);
    if (words.length > 5) {
      continue;
    }
    if (["next", "previous", "shop now", "learn more", "read more", "menu", "home"].includes(lower)) {
      continue;
    }
    if (seen.has(lower)) {
      continue;
    }
    seen.add(lower);
    filtered.push(value);
    if (filtered.length >= 8) {
      break;
    }
  }

  if (filtered.length >= 3) {
    return filtered;
  }

  return fallback;
};

const pickBodyTexts = (html, fallback) => {
  const paragraphs = extractTagTexts(html, "p");
  const values = [];
  for (const paragraph of paragraphs) {
    const normalized = normalizeTextItem(paragraph, "");
    if (normalized.length < 30 || normalized.length > 260) {
      continue;
    }
    values.push(normalized);
    if (values.length >= 10) {
      break;
    }
  }

  return values.length ? values : fallback;
};

const pickImages = (html, fallback) => {
  const regex = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
  const images = [];
  const seen = new Set();
  let match;
  while ((match = regex.exec(String(html || ""))) !== null) {
    const src = String(match[1] || "").trim();
    if (!src || seen.has(src)) {
      continue;
    }
    seen.add(src);
    images.push(src);
    if (images.length >= 12) {
      break;
    }
  }

  return images.length ? images : fallback;
};

const detectArchetype = ({ referenceUrl, mergedText, visionHints }) => {
  const pathname = (() => {
    try {
      return new URL(referenceUrl).pathname.toLowerCase();
    } catch (_error) {
      return "";
    }
  })();

  const text = `${String(mergedText || "").toLowerCase()} ${String(visionHints || "").toLowerCase()}`;

  if (pathname.includes("feature-15") || text.includes("what makes it special") || text.includes("feature 15")) {
    return ArchetypeResultSchema.parse({ archetype: "feature-tabs-media-slider", confidence: 0.92 });
  }

  if (pathname.includes("slideshow-pro") || text.includes("slideshow pro") || text.includes("slideshow")) {
    return ArchetypeResultSchema.parse({ archetype: "slideshow-pro", confidence: 0.88 });
  }

  return null;
};

const feature15LiquidMarkup = () => `
<section class="hz-feature15" style="--hz-bg: {{ section.settings.bg_color }}; --hz-text: {{ section.settings.text_color }}; --hz-muted: {{ section.settings.muted_color }}; --hz-accent: {{ section.settings.accent_color }}; padding-top: {{ section.settings.padding_top }}px; padding-bottom: {{ section.settings.padding_bottom }}px;">
  <div class="page-width hz-feature15__inner">
    <div class="hz-feature15__tabs" role="tablist" aria-label="{{ section.settings.heading | escape }}">
      {% for block in section.blocks %}
        <button
          type="button"
          class="hz-feature15__tab{% if forloop.first %} is-active{% endif %}"
          data-tab-index="{{ forloop.index0 }}"
          role="tab"
          aria-selected="{% if forloop.first %}true{% else %}false{% endif %}"
          aria-controls="hz-feature15-panel-{{ section.id }}-{{ forloop.index0 }}"
          id="hz-feature15-tab-{{ section.id }}-{{ forloop.index0 }}"
        >
          {{ block.settings.tab_label | default: block.settings.heading | escape }}
        </button>
      {% endfor %}
    </div>

    <div class="hz-feature15__content">
      <div class="hz-feature15__copy">
        <h2 class="hz-feature15__heading">{{ section.settings.heading | escape }}</h2>
        <div class="hz-feature15__panels">
          {% for block in section.blocks %}
            <article
              id="hz-feature15-panel-{{ section.id }}-{{ forloop.index0 }}"
              class="hz-feature15__panel{% if forloop.first %} is-active{% endif %}"
              data-tab-index="{{ forloop.index0 }}"
              role="tabpanel"
              aria-labelledby="hz-feature15-tab-{{ section.id }}-{{ forloop.index0 }}"
              {% unless forloop.first %}hidden{% endunless %}
              {{ block.shopify_attributes }}
            >
              <h3 class="hz-feature15__panel-title">{{ block.settings.heading | escape }}</h3>
              <div class="hz-feature15__panel-body rte">{{ block.settings.body }}</div>
              {% if block.settings.cta_label != blank and block.settings.cta_url != blank %}
                <a class="hz-feature15__panel-link" href="{{ block.settings.cta_url }}">{{ block.settings.cta_label | escape }}</a>
              {% endif %}
            </article>
          {% endfor %}
        </div>
      </div>

      <div class="hz-feature15__media" aria-live="polite">
        {% for block in section.blocks %}
          <figure class="hz-feature15__figure{% if forloop.first %} is-active{% endif %}" data-tab-index="{{ forloop.index0 }}" {% unless forloop.first %}hidden{% endunless %}>
            {% if block.settings.image != blank %}
              <img src="{{ block.settings.image | image_url: width: 1400 }}" alt="{{ block.settings.image_alt | default: block.settings.heading | escape }}" loading="lazy">
            {% elsif block.settings.image_url != blank %}
              <img src="{{ block.settings.image_url | escape }}" alt="{{ block.settings.image_alt | default: block.settings.heading | escape }}" loading="lazy">
            {% endif %}
          </figure>
        {% endfor %}
      </div>
    </div>
  </div>
</section>
`;

const feature15Css = ({ variant = 1 } = {}) => {
  const density = variant === 1 ? "1rem" : variant === 2 ? "0.75rem" : "1.15rem";
  const radius = variant === 1 ? "18px" : variant === 2 ? "14px" : "22px";

  return `
.hz-feature15 {
  background: var(--hz-bg, #f2eadf);
  color: var(--hz-text, #222222);
}
.hz-feature15__inner {
  background: rgba(255, 255, 255, 0.28);
  border-radius: ${radius};
  padding: ${density};
  display: grid;
  gap: ${density};
}
.hz-feature15__tabs {
  display: flex;
  flex-wrap: wrap;
  gap: .5rem;
  border-bottom: 1px solid rgba(0,0,0,.12);
  padding-bottom: .55rem;
}
.hz-feature15__tab {
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--hz-muted, #666666);
  font-size: .82rem;
  line-height: 1.2;
  padding: .35rem .6rem;
  cursor: pointer;
}
.hz-feature15__tab.is-active {
  color: var(--hz-accent, #111111);
  background: rgba(255,255,255,.62);
}
.hz-feature15__content {
  display: grid;
  gap: 1rem;
}
.hz-feature15__heading {
  margin: 0;
  font-size: clamp(1.65rem, 2.2vw, 2.8rem);
  line-height: 1.08;
  max-width: 26ch;
}
.hz-feature15__panel-title {
  margin: .8rem 0 .35rem;
  font-size: 1.12rem;
}
.hz-feature15__panel-body {
  color: var(--hz-muted, #666666);
}
.hz-feature15__panel-link {
  margin-top: .8rem;
  display: inline-block;
  color: var(--hz-accent, #111111);
  text-underline-offset: 3px;
}
.hz-feature15__media {
  min-height: 260px;
  border-radius: ${radius};
  overflow: hidden;
  background: rgba(0,0,0,.05);
}
.hz-feature15__figure,
.hz-feature15__figure img {
  width: 100%;
  height: 100%;
  margin: 0;
}
.hz-feature15__figure img {
  object-fit: cover;
  display: block;
}
@media screen and (min-width: 990px) {
  .hz-feature15__inner {
    padding: 1.3rem;
  }
  .hz-feature15__content {
    grid-template-columns: minmax(0, 1fr) minmax(0, 0.92fr);
    align-items: start;
    gap: 1.7rem;
  }
  .hz-feature15__media {
    min-height: 395px;
  }
}
@media screen and (max-width: 749px) {
  .hz-feature15__tabs {
    overflow-x: auto;
    white-space: nowrap;
    flex-wrap: nowrap;
  }
}
`;
};

const feature15Js = () => `
(() => {
  const initSection = (root) => {
    if (!root || root.dataset.hzFeature15Ready === "true") {
      return;
    }
    root.dataset.hzFeature15Ready = "true";

    const tabs = Array.from(root.querySelectorAll(".hz-feature15__tab"));
    const panels = Array.from(root.querySelectorAll(".hz-feature15__panel"));
    const figures = Array.from(root.querySelectorAll(".hz-feature15__figure"));

    const setActive = (index) => {
      tabs.forEach((tab, tabIndex) => {
        const active = tabIndex === index;
        tab.classList.toggle("is-active", active);
        tab.setAttribute("aria-selected", active ? "true" : "false");
      });
      panels.forEach((panel, panelIndex) => {
        const active = panelIndex === index;
        panel.classList.toggle("is-active", active);
        if (active) {
          panel.removeAttribute("hidden");
        } else {
          panel.setAttribute("hidden", "hidden");
        }
      });
      figures.forEach((figure, figureIndex) => {
        const active = figureIndex === index;
        figure.classList.toggle("is-active", active);
        if (active) {
          figure.removeAttribute("hidden");
        } else {
          figure.setAttribute("hidden", "hidden");
        }
      });
    };

    root.addEventListener("click", (event) => {
      const trigger = event.target.closest("[data-tab-index]");
      if (!trigger || !root.contains(trigger)) {
        return;
      }
      const index = Number(trigger.dataset.tabIndex || "0");
      if (!Number.isFinite(index)) {
        return;
      }
      setActive(index);
    });
  };

  const initAll = (scope = document) => {
    scope.querySelectorAll(".hz-feature15").forEach(initSection);
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => initAll(document));
  } else {
    initAll(document);
  }

  document.addEventListener("shopify:section:load", (event) => {
    if (event?.target?.querySelectorAll) {
      initAll(event.target);
    }
  });
})();
`;

const slideshowLiquidMarkup = () => `
<section class="hz-slideshow-pro" style="--hz-bg: {{ section.settings.bg_color }}; --hz-card: {{ section.settings.card_color }}; --hz-text: {{ section.settings.text_color }}; padding-top: {{ section.settings.padding_top }}px; padding-bottom: {{ section.settings.padding_bottom }}px;">
  <div class="page-width hz-slideshow-pro__inner">
    {% if section.settings.heading != blank %}
      <h2 class="hz-slideshow-pro__heading">{{ section.settings.heading | escape }}</h2>
    {% endif %}

    <div class="hz-slideshow-pro__track" data-hz-slideshow>
      {% for block in section.blocks %}
        <article class="hz-slideshow-pro__slide{% if forloop.first %} is-active{% endif %}" data-slide-index="{{ forloop.index0 }}" {% unless forloop.first %}hidden{% endunless %} {{ block.shopify_attributes }}>
          <div class="hz-slideshow-pro__media">
            {% if block.settings.image != blank %}
              <img src="{{ block.settings.image | image_url: width: 1800 }}" alt="{{ block.settings.image_alt | default: block.settings.title | escape }}" loading="lazy">
            {% elsif block.settings.image_url != blank %}
              <img src="{{ block.settings.image_url | escape }}" alt="{{ block.settings.image_alt | default: block.settings.title | escape }}" loading="lazy">
            {% endif %}
          </div>
          <div class="hz-slideshow-pro__content">
            {% if block.settings.eyebrow != blank %}
              <p class="hz-slideshow-pro__eyebrow">{{ block.settings.eyebrow | escape }}</p>
            {% endif %}
            <h3 class="hz-slideshow-pro__title">{{ block.settings.title | escape }}</h3>
            <div class="hz-slideshow-pro__body rte">{{ block.settings.body }}</div>
            {% if block.settings.button_label != blank and block.settings.button_url != blank %}
              <a class="hz-slideshow-pro__button" href="{{ block.settings.button_url }}">{{ block.settings.button_label | escape }}</a>
            {% endif %}
          </div>
        </article>
      {% endfor %}
    </div>

    {% if section.blocks.size > 1 %}
      <div class="hz-slideshow-pro__controls">
        <button type="button" class="hz-slideshow-pro__control" data-direction="prev" aria-label="Previous slide">&#8592;</button>
        <button type="button" class="hz-slideshow-pro__control" data-direction="next" aria-label="Next slide">&#8594;</button>
      </div>
    {% endif %}
  </div>
</section>
`;

const slideshowCss = ({ variant = 1 } = {}) => {
  const cardShadow = variant === 1 ? "0 12px 28px rgba(0,0,0,.10)" : variant === 2 ? "0 8px 20px rgba(0,0,0,.08)" : "0 16px 36px rgba(0,0,0,.12)";

  return `
.hz-slideshow-pro {
  background: var(--hz-bg, #f7f2e8);
  color: var(--hz-text, #191919);
}
.hz-slideshow-pro__inner {
  display: grid;
  gap: 1rem;
}
.hz-slideshow-pro__heading {
  margin: 0;
  font-size: clamp(1.45rem, 2vw, 2.4rem);
}
.hz-slideshow-pro__slide {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  border-radius: 18px;
  overflow: hidden;
  box-shadow: ${cardShadow};
  background: var(--hz-card, #ffffff);
}
.hz-slideshow-pro__media {
  min-height: 280px;
  background: rgba(0,0,0,.06);
}
.hz-slideshow-pro__media img {
  width: 100%;
  height: 100%;
  display: block;
  object-fit: cover;
}
.hz-slideshow-pro__content {
  padding: 1rem;
}
.hz-slideshow-pro__eyebrow {
  margin: 0;
  font-size: .78rem;
  letter-spacing: .08em;
  text-transform: uppercase;
  opacity: .75;
}
.hz-slideshow-pro__title {
  margin: .4rem 0;
  font-size: 1.35rem;
}
.hz-slideshow-pro__button {
  display: inline-block;
  margin-top: .7rem;
  border-radius: 999px;
  padding: .5rem .9rem;
  text-decoration: none;
  background: #111111;
  color: #ffffff;
}
.hz-slideshow-pro__controls {
  display: flex;
  gap: .5rem;
}
.hz-slideshow-pro__control {
  border: 1px solid rgba(0,0,0,.2);
  border-radius: 999px;
  background: transparent;
  width: 38px;
  height: 38px;
  cursor: pointer;
}
@media screen and (min-width: 990px) {
  .hz-slideshow-pro__slide {
    grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr);
  }
  .hz-slideshow-pro__content {
    padding: 1.35rem;
  }
}
`;
};

const slideshowJs = () => `
(() => {
  const init = (root) => {
    if (!root || root.dataset.hzSlideshowReady === "true") {
      return;
    }
    root.dataset.hzSlideshowReady = "true";

    const slides = Array.from(root.querySelectorAll(".hz-slideshow-pro__slide"));
    if (slides.length <= 1) {
      return;
    }

    let index = 0;

    const setIndex = (nextIndex) => {
      index = (nextIndex + slides.length) % slides.length;
      slides.forEach((slide, slideIndex) => {
        const active = slideIndex === index;
        slide.classList.toggle("is-active", active);
        if (active) {
          slide.removeAttribute("hidden");
        } else {
          slide.setAttribute("hidden", "hidden");
        }
      });
    };

    root.addEventListener("click", (event) => {
      const button = event.target.closest("[data-direction]");
      if (!button || !root.contains(button)) {
        return;
      }
      const direction = button.dataset.direction;
      setIndex(direction === "prev" ? index - 1 : index + 1);
    });
  };

  const initAll = (scope = document) => {
    scope.querySelectorAll(".hz-slideshow-pro").forEach(init);
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => initAll(document));
  } else {
    initAll(document);
  }

  document.addEventListener("shopify:section:load", (event) => {
    if (event?.target?.querySelectorAll) {
      initAll(event.target);
    }
  });
})();
`;

const buildFeatureArchetypeBundle = ({ sectionHandle, reference, imageUrls, attempt }) => {
  const fallbackTabs = ["Soft as a cloud", "Optimal support", "Sustainability", "Care guide"];
  const fallbackBodies = [
    "The BENI BED is a pillowy, roll-up bed that you can take anywhere.",
    "Designed for support and comfort across everyday routines.",
    "Crafted with durable and responsibly sourced materials.",
    "Easy maintenance and long-lasting performance.",
  ];

  const targetHtml = reference?.views?.[0]?.target?.html || reference?.mergedHtml || "";
  const tabLabels = pickCandidateTabs(targetHtml, fallbackTabs).slice(0, 6);
  const bodyTexts = pickBodyTexts(targetHtml, fallbackBodies);
  const imageCandidates = uniqueStrings([...imageUrls, ...pickImages(targetHtml, [])]);

  const headingCandidate =
    extractTagTexts(targetHtml, "h2").find((entry) => entry.toLowerCase().includes("what makes")) ||
    extractTagTexts(targetHtml, "h2")[0] ||
    "What makes it special?";

  const heading = normalizeTextItem(headingCandidate, "What makes it special?");

  const blocks = tabLabels.map((label, index) => ({
    type: "feature",
    settings: {
      tab_label: label,
      heading: label,
      body: toRichText(bodyTexts[index] || bodyTexts[0] || "Describe this feature."),
      image_alt: label,
      ...(imageCandidates[index] ? { image_url: imageCandidates[index] } : {}),
    },
  }));

  const schema = {
    name: humanizeHandle(sectionHandle),
    tag: "section",
    class: "hz-feature15-section",
    settings: [
      { type: "text", id: "heading", label: "Heading", default: heading },
      { type: "color", id: "bg_color", label: "Background color", default: "#f2eadf" },
      { type: "color", id: "text_color", label: "Text color", default: "#222222" },
      { type: "color", id: "muted_color", label: "Muted text color", default: "#666666" },
      { type: "color", id: "accent_color", label: "Accent color", default: "#111111" },
      {
        type: "range",
        id: "padding_top",
        label: "Padding top",
        min: 0,
        max: 160,
        step: 4,
        unit: "px",
        default: 48,
      },
      {
        type: "range",
        id: "padding_bottom",
        label: "Padding bottom",
        min: 0,
        max: 160,
        step: 4,
        unit: "px",
        default: 48,
      },
    ],
    blocks: [
      {
        type: "feature",
        name: "Feature",
        settings: [
          { type: "text", id: "tab_label", label: "Tab label" },
          { type: "text", id: "heading", label: "Heading" },
          { type: "richtext", id: "body", label: "Body" },
          { type: "image_picker", id: "image", label: "Image (theme asset)" },
          { type: "url", id: "image_url", label: "Image URL fallback" },
          { type: "text", id: "image_alt", label: "Image alt text" },
          { type: "text", id: "cta_label", label: "CTA label" },
          { type: "url", id: "cta_url", label: "CTA URL" },
        ],
      },
    ],
    presets: [
      {
        name: humanizeHandle(sectionHandle),
        category: "Custom",
        blocks,
      },
    ],
  };

  const css = feature15Css({ variant: attempt });
  const js = feature15Js();
  const sectionMarkup = feature15LiquidMarkup();

  const previewHtml = renderFeaturePreviewHtml({
    heading,
    tabs: blocks.map((block, index) => ({
      tabLabel: block.settings.tab_label,
      heading: block.settings.heading,
      body: stripHtml(block.settings.body),
      imageUrl: imageCandidates[index] || "",
      imageAlt: block.settings.image_alt,
    })),
    css,
  });

  return {
    archetype: "feature-tabs-media-slider",
    schema,
    sectionMarkup,
    css,
    js,
    previewHtml,
  };
};

const buildSlideshowArchetypeBundle = ({ sectionHandle, reference, imageUrls, attempt }) => {
  const targetHtml = reference?.views?.[0]?.target?.html || reference?.mergedHtml || "";
  const headings = extractTagTexts(targetHtml, "h2");
  const heading = normalizeTextItem(headings[0], "Featured slideshow");

  const slideTitles = pickCandidateTabs(targetHtml, ["Slide One", "Slide Two", "Slide Three"]).slice(0, 5);
  const bodies = pickBodyTexts(targetHtml, [
    "Showcase your most important message here.",
    "Use slides to highlight product collections and storytelling.",
    "Add a clear call-to-action for conversions.",
  ]);
  const images = uniqueStrings([...imageUrls, ...pickImages(targetHtml, [])]);

  const blocks = slideTitles.map((title, index) => ({
    type: "slide",
    settings: {
      eyebrow: `Slide ${index + 1}`,
      title,
      body: toRichText(bodies[index] || bodies[0] || "Describe this slide."),
      image_alt: title,
      button_label: "Learn more",
      ...(images[index] ? { image_url: images[index] } : {}),
    },
  }));

  const schema = {
    name: humanizeHandle(sectionHandle),
    tag: "section",
    class: "hz-slideshow-pro-section",
    max_blocks: 8,
    settings: [
      { type: "text", id: "heading", label: "Heading", default: heading },
      { type: "color", id: "bg_color", label: "Background color", default: "#f7f2e8" },
      { type: "color", id: "card_color", label: "Card color", default: "#ffffff" },
      { type: "color", id: "text_color", label: "Text color", default: "#191919" },
      {
        type: "range",
        id: "padding_top",
        label: "Padding top",
        min: 0,
        max: 160,
        step: 4,
        unit: "px",
        default: 56,
      },
      {
        type: "range",
        id: "padding_bottom",
        label: "Padding bottom",
        min: 0,
        max: 160,
        step: 4,
        unit: "px",
        default: 56,
      },
    ],
    blocks: [
      {
        type: "slide",
        name: "Slide",
        settings: [
          { type: "text", id: "eyebrow", label: "Eyebrow" },
          { type: "text", id: "title", label: "Title" },
          { type: "richtext", id: "body", label: "Body" },
          { type: "image_picker", id: "image", label: "Image (theme asset)" },
          { type: "url", id: "image_url", label: "Image URL fallback" },
          { type: "text", id: "image_alt", label: "Image alt text" },
          { type: "text", id: "button_label", label: "Button label" },
          { type: "url", id: "button_url", label: "Button URL" },
        ],
      },
    ],
    presets: [
      {
        name: humanizeHandle(sectionHandle),
        category: "Custom",
        blocks,
      },
    ],
  };

  const css = slideshowCss({ variant: attempt });
  const js = slideshowJs();
  const sectionMarkup = slideshowLiquidMarkup();

  const previewHtml = renderSlideshowPreviewHtml({
    heading,
    slides: blocks.map((block, index) => ({
      eyebrow: block.settings.eyebrow,
      title: block.settings.title,
      body: stripHtml(block.settings.body),
      imageUrl: images[index] || "",
      imageAlt: block.settings.image_alt,
      buttonLabel: block.settings.button_label,
    })),
    css,
  });

  return {
    archetype: "slideshow-pro",
    schema,
    sectionMarkup,
    css,
    js,
    previewHtml,
  };
};

const buildArchetypeBundle = ({ archetype, sectionHandle, reference, imageUrls, attempt }) => {
  if (archetype === "feature-tabs-media-slider") {
    return buildFeatureArchetypeBundle({ sectionHandle, reference, imageUrls, attempt });
  }

  if (archetype === "slideshow-pro") {
    return buildSlideshowArchetypeBundle({ sectionHandle, reference, imageUrls, attempt });
  }

  throw new Error(`Unsupported archetype '${archetype}'`);
};

const buildSectionLiquid = ({ sectionHandle, sectionMarkup, schema, css, js }) => {
  const cssAssetName = `section-${sectionHandle}.css`;
  const jsAssetName = `section-${sectionHandle}.js`;

  const lines = [];
  if (css && css.trim()) {
    lines.push(`{{ '${cssAssetName}' | asset_url | stylesheet_tag }}`);
  }
  if (js && js.trim()) {
    lines.push(`<script src=\"{{ '${jsAssetName}' | asset_url }}\" defer=\"defer\"></script>`);
  }
  lines.push(String(sectionMarkup || "").trim());
  lines.push(`{% schema %}`);
  lines.push(JSON.stringify(schema, null, 2));
  lines.push(`{% endschema %}`);
  lines.push("");

  const sectionLiquid = `${lines.join("\n").trim()}\n`;

  const additionalFiles = [];
  if (css && css.trim()) {
    additionalFiles.push({ key: `assets/${cssAssetName}`, value: `${css.trim()}\n` });
  }
  if (js && js.trim()) {
    additionalFiles.push({ key: `assets/${jsAssetName}`, value: `${js.trim()}\n` });
  }

  return {
    sectionLiquid,
    additionalFiles,
    schemaSummary: {
      name: schema.name,
      presetsCount: Array.isArray(schema.presets) ? schema.presets.length : 0,
      settingsCount: Array.isArray(schema.settings) ? schema.settings.length : 0,
      blocksCount: Array.isArray(schema.blocks) ? schema.blocks.length : 0,
    },
  };
};

const pngFromBuffer = (buffer) => PNG.sync.read(buffer);

const cropToSharedSize = (a, b) => {
  const width = Math.min(a.width, b.width);
  const height = Math.min(a.height, b.height);
  const crop = (source) => {
    const x = Math.max(0, Math.floor((source.width - width) / 2));
    const y = Math.max(0, Math.floor((source.height - height) / 2));
    const target = new PNG({ width, height });

    PNG.bitblt(source, target, x, y, width, height, 0, 0);
    return target;
  };

  return {
    first: crop(a),
    second: crop(b),
    width,
    height,
  };
};

const comparePngBuffers = (referenceBuffer, candidateBuffer) => {
  const reference = pngFromBuffer(referenceBuffer);
  const candidate = pngFromBuffer(candidateBuffer);
  const { first, second, width, height } = cropToSharedSize(reference, candidate);
  const diff = new PNG({ width, height });

  const mismatchPixels = pixelmatch(first.data, second.data, diff.data, width, height, {
    threshold: VISUAL_DIFF_THRESHOLD,
    includeAA: true,
  });

  const totalPixels = width * height;
  const mismatchRatio = totalPixels > 0 ? mismatchPixels / totalPixels : 1;

  return {
    mismatchPixels,
    totalPixels,
    mismatchRatio,
    width,
    height,
  };
};

const selectorSets = {
  "feature-tabs-media-slider": [
    "#shopify-section-template--21494267248969__ss_feature_15_tnnCDT",
    "[id*='ss_feature_15']",
    "[class*='ss_feature_15']",
    "[class*='feature-thumbs-slider']",
    "[class*='feature-template']",
    "section",
  ],
  "slideshow-pro": [
    "[id*='slideshow_pro']",
    "[id*='slideshow-pro']",
    "[class*='slideshow-pro']",
    "[class*='slideshow']",
    "[class*='swiper']",
    "section",
  ],
};

const scoreElement = async (locator, tokens) => {
  const box = await locator.boundingBox();
  if (!box || box.width < 80 || box.height < 80) {
    return null;
  }

  const metadata = await locator.evaluate((el) => ({
    id: el.id || "",
    className: el.className || "",
    tagName: el.tagName || "",
    text: String(el.innerText || "").slice(0, 5000),
    html: String(el.outerHTML || "").slice(0, 25000),
    heading: (el.querySelector("h1,h2,h3")?.textContent || "").trim(),
    tabs: Array.from(el.querySelectorAll("button,a,li"))
      .map((node) => String(node.textContent || "").trim())
      .filter(Boolean)
      .slice(0, 12),
    paragraphs: Array.from(el.querySelectorAll("p"))
      .map((node) => String(node.textContent || "").trim())
      .filter(Boolean)
      .slice(0, 12),
    imageUrls: Array.from(el.querySelectorAll("img"))
      .map((node) => node.getAttribute("src"))
      .filter(Boolean)
      .slice(0, 12),
  }));

  const haystack = `${metadata.id} ${metadata.className} ${metadata.text}`.toLowerCase();
  let overlap = 0;
  for (const token of tokens) {
    if (haystack.includes(token)) {
      overlap += 1;
    }
  }

  return {
    box,
    metadata,
    score: box.width * box.height + overlap * 12000,
  };
};

const findBestTarget = async (page, archetype, tokenSource) => {
  const selectors = selectorSets[archetype] || ["section", "main", "body"];
  const tokens = tokenize(tokenSource).slice(0, 20);
  const candidates = [];

  for (const selector of selectors) {
    const locator = page.locator(selector);
    const count = await locator.count();
    const limit = Math.min(count, 8);
    for (let index = 0; index < limit; index += 1) {
      const candidateLocator = locator.nth(index);
      try {
        const visible = await candidateLocator.isVisible();
        if (!visible) {
          continue;
        }
        const candidate = await scoreElement(candidateLocator, tokens);
        if (candidate) {
          candidates.push({
            ...candidate,
            selector,
            index,
            locator: candidateLocator,
          });
        }
      } catch (_error) {
        // Ignore stale or detached nodes.
      }
    }
  }

  if (!candidates.length) {
    return null;
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates[0];
};

const renderPreviewShell = ({ css, bodyHtml, width, height }) => `
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      :root { color-scheme: light; }
      html, body { margin: 0; padding: 0; }
      body {
        font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
        background: #f4f0e8;
        min-height: 100vh;
        display: grid;
        place-items: center;
      }
      #preview-root {
        width: ${Math.max(320, Math.floor(width || 960))}px;
        min-height: ${Math.max(220, Math.floor(height || 420))}px;
      }
${css}
    </style>
  </head>
  <body>
    <div id="preview-root">${bodyHtml}</div>
  </body>
</html>
`;

const renderFeaturePreviewHtml = ({ heading, tabs, css }) => {
  const tabButtons = tabs
    .map((tab, index) => `<button class="hz-feature15__tab${index === 0 ? " is-active" : ""}">${escapeHtml(tab.tabLabel)}</button>`)
    .join("");

  const panels = tabs
    .map(
      (tab, index) => `
      <article class="hz-feature15__panel${index === 0 ? " is-active" : ""}">
        <h3 class="hz-feature15__panel-title">${escapeHtml(tab.heading)}</h3>
        <div class="hz-feature15__panel-body"><p>${escapeHtml(tab.body)}</p></div>
      </article>
    `
    )
    .join("");

  const image = tabs[0]?.imageUrl
    ? `<img src="${escapeHtml(tabs[0].imageUrl)}" alt="${escapeHtml(tabs[0].imageAlt || tabs[0].heading)}">`
    : "";

  return renderPreviewShell({
    css,
    width: 1040,
    height: 420,
    bodyHtml: `
<section class="hz-feature15" style="--hz-bg:#f2eadf;--hz-text:#222;--hz-muted:#666;--hz-accent:#111;">
  <div class="hz-feature15__inner">
    <div class="hz-feature15__tabs">${tabButtons}</div>
    <div class="hz-feature15__content">
      <div class="hz-feature15__copy">
        <h2 class="hz-feature15__heading">${escapeHtml(heading)}</h2>
        <div class="hz-feature15__panels">${panels}</div>
      </div>
      <div class="hz-feature15__media">${image}</div>
    </div>
  </div>
</section>`,
  });
};

const renderSlideshowPreviewHtml = ({ heading, slides, css }) => {
  const first = slides[0] || {
    eyebrow: "Slide 1",
    title: "Slide",
    body: "Describe this slide.",
    imageUrl: "",
    imageAlt: "Slide",
    buttonLabel: "Learn more",
  };

  const image = first.imageUrl
    ? `<img src="${escapeHtml(first.imageUrl)}" alt="${escapeHtml(first.imageAlt || first.title)}">`
    : "";

  return renderPreviewShell({
    css,
    width: 1080,
    height: 500,
    bodyHtml: `
<section class="hz-slideshow-pro" style="--hz-bg:#f7f2e8;--hz-card:#fff;--hz-text:#191919;">
  <div class="hz-slideshow-pro__inner">
    <h2 class="hz-slideshow-pro__heading">${escapeHtml(heading)}</h2>
    <article class="hz-slideshow-pro__slide is-active">
      <div class="hz-slideshow-pro__media">${image}</div>
      <div class="hz-slideshow-pro__content">
        <p class="hz-slideshow-pro__eyebrow">${escapeHtml(first.eyebrow || "Slide 1")}</p>
        <h3 class="hz-slideshow-pro__title">${escapeHtml(first.title)}</h3>
        <div class="hz-slideshow-pro__body"><p>${escapeHtml(first.body)}</p></div>
        <a class="hz-slideshow-pro__button" href="#">${escapeHtml(first.buttonLabel || "Learn more")}</a>
      </div>
    </article>
  </div>
</section>`,
  });
};

const bufferToBase64 = (buffer) => Buffer.from(buffer).toString("base64");

const discoverLocalPlaywrightExecutable = () => {
  const localBrowsersRoot = path.join(process.cwd(), "node_modules", "playwright-core", ".local-browsers");
  if (!fs.existsSync(localBrowsersRoot)) {
    return null;
  }

  const entries = fs
    .readdirSync(localBrowsersRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => b.localeCompare(a));

  const chromiumDir = entries.find((name) => name.startsWith("chromium-"));
  if (chromiumDir) {
    const chromePath = path.join(localBrowsersRoot, chromiumDir, "chrome-linux64", "chrome");
    if (fs.existsSync(chromePath)) {
      return chromePath;
    }
  }

  const shellDir = entries.find((name) => name.startsWith("chromium_headless_shell-"));
  if (shellDir) {
    const shellPath = path.join(localBrowsersRoot, shellDir, "chrome-headless-shell-linux64", "chrome-headless-shell");
    if (fs.existsSync(shellPath)) {
      return shellPath;
    }
  }

  return null;
};

const createBrowser = async () => {
  const runtimeExecutablePath = chromium.executablePath();
  const localExecutablePath = discoverLocalPlaywrightExecutable();
  const resolvedExecutablePath =
    runtimeExecutablePath && fs.existsSync(runtimeExecutablePath)
      ? runtimeExecutablePath
      : localExecutablePath && fs.existsSync(localExecutablePath)
        ? localExecutablePath
        : null;

  if (!resolvedExecutablePath) {
    const error = new Error(
      `Chromium executable niet gevonden. runtimePath='${runtimeExecutablePath}', localPath='${localExecutablePath || ""}'. Zorg dat Playwright Chromium in de runtime-image is geïnstalleerd.`
    );
    error.code = "browser_runtime_unavailable";
    throw error;
  }

  try {
    return await chromium.launch({
      headless: true,
      args: ["--disable-dev-shm-usage", "--no-sandbox"],
      executablePath: resolvedExecutablePath,
    });
  } catch (error) {
    if (isPlaywrightBrowserMissingError(error)) {
      const runtimeError = new Error(
        `Playwright browser binary ontbreekt in runtime (resolvedPath='${resolvedExecutablePath}'). ${formatErrorMessage(error)}`
      );
      runtimeError.code = "browser_runtime_unavailable";
      throw runtimeError;
    }
    throw error;
  }
};

const defaultCaptureReference = async ({ referenceUrl, archetype, visionHints }) => {
  const browser = await createBrowser();
  try {
    const views = [];

    for (const target of PREVIEW_TARGETS) {
      const context = await browser.newContext({
        viewport: target.viewport,
        userAgent: target.userAgent,
      });
      const page = await context.newPage();

      try {
        const response = await page.goto(referenceUrl, {
          waitUntil: "domcontentloaded",
          timeout: REFERENCE_TIMEOUT_MS,
        });
        await page.waitForTimeout(300);

        const mergedText = await page.evaluate(() => String(document.body?.innerText || "").slice(0, 20000));

        const selected = await findBestTarget(page, archetype, `${visionHints || ""} ${mergedText}`);
        if (!selected || !selected.box) {
          views.push({
            id: target.id,
            ok: false,
            statusCode: response?.status() || null,
            error: "target_detection_failed",
          });
          await context.close();
          continue;
        }

        const clip = {
          x: Math.max(0, Math.floor(selected.box.x)),
          y: Math.max(0, Math.floor(selected.box.y)),
          width: Math.max(100, Math.floor(selected.box.width)),
          height: Math.max(100, Math.floor(selected.box.height)),
        };

        const screenshotBuffer = await page.screenshot({ clip, timeout: BROWSER_TIMEOUT_MS });

        views.push({
          id: target.id,
          ok: true,
          statusCode: response?.status() || 200,
          screenshotBuffer,
          clip,
          target: {
            selector: selected.selector,
            index: selected.index,
            score: selected.score,
            id: selected.metadata.id,
            className: selected.metadata.className,
            tagName: selected.metadata.tagName,
            heading: selected.metadata.heading,
            tabs: selected.metadata.tabs,
            paragraphs: selected.metadata.paragraphs,
            imageUrls: selected.metadata.imageUrls,
            html: selected.metadata.html,
            text: selected.metadata.text,
          },
          mergedText,
          mergedHtml: await page.content(),
        });
      } catch (error) {
        views.push({
          id: target.id,
          ok: false,
          statusCode: null,
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        await context.close();
      }
    }

    return views;
  } finally {
    await browser.close();
  }
};

const defaultRenderCandidateViews = async ({ previewHtml, referenceViews }) => {
  const browser = await createBrowser();
  try {
    const views = [];
    for (const target of PREVIEW_TARGETS) {
      const referenceView = referenceViews.find((entry) => entry.id === target.id);
      const context = await browser.newContext({
        viewport: target.viewport,
        userAgent: target.userAgent,
      });
      const page = await context.newPage();
      try {
        await page.setContent(previewHtml, { waitUntil: "domcontentloaded", timeout: BROWSER_TIMEOUT_MS });
        await page.waitForTimeout(200);

        const root = page.locator("#preview-root");
        const box = await root.boundingBox();
        if (!box) {
          views.push({ id: target.id, ok: false, error: "candidate_preview_missing_root" });
          await context.close();
          continue;
        }

        const fallbackClip = referenceView?.clip;
        const clip = fallbackClip
          ? {
              x: Math.max(0, Math.floor(box.x)),
              y: Math.max(0, Math.floor(box.y)),
              width: Math.max(100, Math.floor(fallbackClip.width)),
              height: Math.max(100, Math.floor(fallbackClip.height)),
            }
          : {
              x: Math.max(0, Math.floor(box.x)),
              y: Math.max(0, Math.floor(box.y)),
              width: Math.max(100, Math.floor(box.width)),
              height: Math.max(100, Math.floor(box.height)),
            };

        const screenshotBuffer = await page.screenshot({ clip, timeout: BROWSER_TIMEOUT_MS });
        views.push({ id: target.id, ok: true, screenshotBuffer, clip });
      } catch (error) {
        views.push({
          id: target.id,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        await context.close();
      }
    }

    return views;
  } finally {
    await browser.close();
  }
};

const defaultCompareVisualGate = async ({ referenceViews, candidateViews }) => {
  const perViewport = [];
  for (const target of PREVIEW_TARGETS) {
    const reference = referenceViews.find((entry) => entry.id === target.id);
    const candidate = candidateViews.find((entry) => entry.id === target.id);

    if (!reference?.ok || !candidate?.ok || !reference.screenshotBuffer || !candidate.screenshotBuffer) {
      perViewport.push({
        id: target.id,
        pass: false,
        threshold: target.threshold,
        mismatchRatio: 1,
        error: !reference?.ok ? "reference_capture_failed" : "candidate_capture_failed",
      });
      continue;
    }

    const compared = comparePngBuffers(reference.screenshotBuffer, candidate.screenshotBuffer);
    perViewport.push({
      id: target.id,
      threshold: target.threshold,
      mismatchRatio: compared.mismatchRatio,
      mismatchPixels: compared.mismatchPixels,
      totalPixels: compared.totalPixels,
      width: compared.width,
      height: compared.height,
      pass: compared.mismatchRatio <= target.threshold,
      referenceBase64: bufferToBase64(reference.screenshotBuffer),
      candidateBase64: bufferToBase64(candidate.screenshotBuffer),
    });
  }

  const status = perViewport.every((entry) => entry.pass) ? "pass" : "fail";
  return {
    status,
    perViewport,
  };
};

const defaultRuntime = {
  captureReference: defaultCaptureReference,
  renderCandidateViews: defaultRenderCandidateViews,
  compareVisualGate: defaultCompareVisualGate,
};

let activeRuntime = defaultRuntime;

export const __setSectionReplicationV3RuntimeForTests = (runtimeOverrides = null) => {
  if (!runtimeOverrides) {
    activeRuntime = defaultRuntime;
    return;
  }

  activeRuntime = {
    ...defaultRuntime,
    ...runtimeOverrides,
  };
};

const buildFailureResponse = ({
  errorCode,
  message,
  archetype,
  confidence,
  validation,
  visualGate,
  attempts,
}) => ({
  action: "replicate_section_from_reference",
  status: "fail",
  errorCode,
  message,
  archetype: archetype || null,
  confidence: typeof confidence === "number" ? confidence : 0,
  validation,
  visualGate,
  writes: null,
  policy: {
    writesAllowed: false,
    manualFallbackAllowed: false,
    nextAction: "stop_and_report_failure",
  },
  attempts,
  telemetry: {
    pipeline: "section-replication-v3",
    generatedAt: toIsoNow(),
  },
});

const buildRuntimeFailureResponse = ({ errorCode = "reference_unreachable", message, issueCode, attempts = [] }) => {
  const runtimeIssue = issue(
    "error",
    issueCode || "runtime_error",
    message || "Runtime fout tijdens section replicatie."
  );

  return buildFailureResponse({
    errorCode,
    message: `Section replication v3 faalde: ${errorCode}.`,
    archetype: null,
    confidence: 0,
    validation: {
      status: "fail",
      checks: {
        themeContext: toValidationCheck("themeContext", []),
        schema: toValidationCheck("schema", []),
        bundle: toValidationCheck("bundle", [runtimeIssue]),
        visual: toValidationCheck("visual", []),
      },
      issues: [runtimeIssue],
    },
    visualGate: {
      status: "fail",
      perViewport: PREVIEW_TARGETS.map((entry) => ({
        id: entry.id,
        pass: false,
        mismatchRatio: 1,
        threshold: entry.threshold,
        error: issueCode || "runtime_error",
      })),
    },
    attempts,
  });
};

const classifyFailureCode = ({ schemaIssues, themeIssues, visualStatus, referenceViews, archetype }) => {
  if ((referenceViews || []).every((entry) => !entry.ok)) {
    return "reference_unreachable";
  }

  if ((referenceViews || []).some((entry) => entry.error === "target_detection_failed")) {
    return "target_detection_failed";
  }

  if (!archetype) {
    return "unsupported_archetype";
  }

  if ((schemaIssues || []).some((entry) => entry.severity === "error")) {
    return "schema_invalid";
  }

  if ((themeIssues || []).some((entry) => TEMPLATE_ERROR_CODES.has(entry.code))) {
    return "template_insert_invalid";
  }

  if (visualStatus === "fail") {
    return "visual_gate_fail";
  }

  return "visual_gate_fail";
};

const validateTemplateInstallReadback = ({ templateValue, templateKey, sectionId, sectionHandle }) => {
  const issues = [];
  let parsedTemplate = null;

  try {
    parsedTemplate = ensureJsonTemplateStructure(templateValue, templateKey);
  } catch (error) {
    issues.push(
      issue(
        "error",
        "template_insert_invalid",
        `Template readback parse mislukt voor '${templateKey}': ${formatErrorMessage(error)}`
      )
    );
    return {
      status: "fail",
      issues,
      sectionPresent: false,
      orderContainsSection: false,
      sectionType: null,
    };
  }

  const templateSection = parsedTemplate.sections?.[sectionId];
  const sectionPresent = Boolean(templateSection);
  const orderContainsSection = Array.isArray(parsedTemplate.order) && parsedTemplate.order.includes(sectionId);
  const sectionType = templateSection?.type || null;

  if (!sectionPresent) {
    issues.push(
      issue(
        "error",
        "template_insert_invalid",
        `Template '${templateKey}' mist section instance '${sectionId}' na write/readback.`
      )
    );
  }

  if (sectionPresent && sectionType !== sectionHandle) {
    issues.push(
      issue(
        "error",
        "template_insert_invalid",
        `Template '${templateKey}' heeft voor '${sectionId}' type '${sectionType}', verwacht '${sectionHandle}'.`
      )
    );
  }

  if (!orderContainsSection) {
    issues.push(
      issue(
        "error",
        "template_insert_invalid",
        `Template '${templateKey}' bevat section '${sectionId}' niet in order-array na write/readback.`
      )
    );
  }

  return {
    status: issues.some((entry) => entry.severity === "error") ? "fail" : "pass",
    issues,
    sectionPresent,
    orderContainsSection,
    sectionType,
  };
};

const applyWrites = async ({
  shopifyClient,
  apiVersion,
  input,
  sectionHandle,
  sectionKey,
  sectionLiquid,
  additionalFiles,
}) => {
  const resolvedTheme = await resolveTheme(shopifyClient, apiVersion, {
    themeId: input.themeId,
    themeRole: input.themeRole,
  });

  if (!input.overwriteSection) {
    try {
      await getThemeFile(shopifyClient, apiVersion, {
        themeId: resolvedTheme.id,
        key: sectionKey,
      });
      throw new Error(`Section '${sectionKey}' bestaat al. Zet overwriteSection=true.`);
    } catch (error) {
      if (error?.status !== 404) {
        throw error;
      }
    }
  }

  const sectionWrite = await upsertThemeFile(shopifyClient, apiVersion, {
    themeId: resolvedTheme.id,
    key: sectionKey,
    value: sectionLiquid,
  });

  let templateUpdate = null;
  if (input.addToTemplate) {
    const templateFile = await getThemeFile(shopifyClient, apiVersion, {
      themeId: resolvedTheme.id,
      key: input.templateKey,
    });

    const templateJson = ensureJsonTemplateStructure(templateFile.asset?.value || "", input.templateKey);
    const sectionId = pickSectionInstanceId(sectionHandle, input.sectionInstanceId, templateJson);

    templateJson.sections[sectionId] = {
      type: sectionHandle,
      settings: input.sectionSettings && typeof input.sectionSettings === "object" ? input.sectionSettings : {},
    };

    templateJson.order = insertSectionOrder(
      templateJson.order,
      sectionId,
      input.insertPosition,
      input.referenceSectionId
    );

    const templateValue = `${JSON.stringify(templateJson, null, 2)}\n`;
    const templateWrite = await upsertThemeFile(shopifyClient, apiVersion, {
      themeId: resolvedTheme.id,
      key: input.templateKey,
      value: templateValue,
    });

    templateUpdate = {
      key: input.templateKey,
      sectionId,
      position: input.insertPosition,
      referenceSectionId: input.referenceSectionId || null,
      orderLength: Array.isArray(templateJson.order) ? templateJson.order.length : null,
      checksum: templateWrite.asset?.checksum || null,
    };
  }

  const additionalWrites = [];
  for (const file of additionalFiles) {
    const writeResult = await upsertThemeFile(shopifyClient, apiVersion, {
      themeId: resolvedTheme.id,
      key: file.key,
      value: file.value,
      attachment: file.attachment,
      checksum: file.checksum,
    });

    additionalWrites.push({
      key: file.key,
      checksum: writeResult.asset?.checksum || null,
      mode: typeof file.value === "string" ? "value" : "attachment",
    });
  }

  const verification = {
    section: null,
    template: null,
    templateInstall: null,
    additionalFiles: [],
  };

  if (input.verify) {
    const sectionRead = await getThemeFile(shopifyClient, apiVersion, {
      themeId: resolvedTheme.id,
      key: sectionKey,
    });
    verification.section = summarizeAssetRead(sectionRead.asset);

    if (input.addToTemplate) {
      const templateRead = await getThemeFile(shopifyClient, apiVersion, {
        themeId: resolvedTheme.id,
        key: input.templateKey,
      });
      verification.template = summarizeAssetRead(templateRead.asset);
      if (templateUpdate?.sectionId) {
        verification.templateInstall = validateTemplateInstallReadback({
          templateValue: templateRead.asset?.value || "",
          templateKey: input.templateKey,
          sectionId: templateUpdate.sectionId,
          sectionHandle,
        });
      }
    }

    for (const write of additionalWrites) {
      const fileRead = await getThemeFile(shopifyClient, apiVersion, {
        themeId: resolvedTheme.id,
        key: write.key,
      });
      verification.additionalFiles.push(summarizeAssetRead(fileRead.asset));
    }
  }

  return {
    theme: {
      id: resolvedTheme.id,
      name: resolvedTheme.name,
      role: resolvedTheme.role,
    },
    section: {
      handle: sectionHandle,
      key: sectionKey,
      overwritten: input.overwriteSection,
      checksum: sectionWrite.asset?.checksum || null,
    },
    template: templateUpdate,
    additionalFiles: additionalWrites,
    verification,
  };
};

const mergeViewText = (views) =>
  views
    .filter((entry) => entry.ok)
    .map((entry) => `${entry.target?.text || ""} ${entry.mergedText || ""}`)
    .join(" ")
    .trim();

const mergeViewHtml = (views) =>
  views
    .filter((entry) => entry.ok)
    .map((entry) => entry.target?.html || entry.mergedHtml || "")
    .join("\n")
    .trim();

export const replicateSectionFromReferencePipeline = async ({ shopifyClient, apiVersion, input }) => {
  const parsedInputResult = ReplicateSectionFromReferenceInputSchema.safeParse(input);
  if (!parsedInputResult.success) {
    const schemaIssues = parsedInputResult.error.issues.map((entry) =>
      issue("error", "schema_invalid", `Input '${entry.path.join(".") || "root"}' is ongeldig: ${entry.message}`)
    );

    return buildFailureResponse({
      errorCode: "schema_invalid",
      message: "Section replication v3 faalde: schema_invalid.",
      archetype: null,
      confidence: 0,
      validation: {
        status: "fail",
        checks: {
          themeContext: toValidationCheck("themeContext", []),
          schema: toValidationCheck("schema", schemaIssues),
          bundle: toValidationCheck("bundle", []),
          visual: toValidationCheck("visual", []),
        },
        issues: schemaIssues,
      },
      visualGate: {
        status: "fail",
        perViewport: PREVIEW_TARGETS.map((entry) => ({
          id: entry.id,
          pass: false,
          mismatchRatio: 1,
          threshold: entry.threshold,
          error: "input_invalid",
        })),
      },
      attempts: [],
    });
  }

  const parsedInput = parsedInputResult.data;
  const sectionHandle = deriveSectionHandle(parsedInput);
  const sectionKey = `sections/${sectionHandle}.liquid`;

  const attempts = [];

  for (let attempt = 1; attempt <= parsedInput.maxAttempts; attempt += 1) {
    const attemptLog = {
      attempt,
      startedAt: toIsoNow(),
    };

    try {
      const referenceViews = await activeRuntime.captureReference({
        referenceUrl: parsedInput.referenceUrl,
        archetype: null,
        visionHints: parsedInput.visionHints,
        attempt,
      });

      attemptLog.referenceViews = (referenceViews || []).map((entry) => ({
        id: entry.id,
        ok: Boolean(entry.ok),
        statusCode: entry.statusCode || null,
        error: entry.error || null,
        clip: entry.clip || null,
        target: entry.target
          ? {
              selector: entry.target.selector,
              score: entry.target.score,
              heading: entry.target.heading,
            }
          : null,
      }));

      if ((referenceViews || []).every((entry) => !entry.ok)) {
        attempts.push(attemptLog);
        continue;
      }

      if ((referenceViews || []).some((entry) => entry.error === "target_detection_failed")) {
        attempts.push(attemptLog);
        continue;
      }

      const mergedText = mergeViewText(referenceViews);
      const mergedHtml = mergeViewHtml(referenceViews);

      const archetypeMatch = detectArchetype({
        referenceUrl: parsedInput.referenceUrl,
        mergedText,
        visionHints: parsedInput.visionHints,
      });

      if (!archetypeMatch) {
        attemptLog.archetype = null;
        attempts.push(attemptLog);
        continue;
      }

      attemptLog.archetype = archetypeMatch.archetype;
      attemptLog.confidence = archetypeMatch.confidence;

      const referenceContext = {
        views: referenceViews,
        mergedText,
        mergedHtml,
      };

      const generated = buildArchetypeBundle({
        archetype: archetypeMatch.archetype,
        sectionHandle,
        reference: referenceContext,
        imageUrls: parsedInput.imageUrls,
        attempt,
      });

      const lint = lintSchema(generated.schema);

      const themePreflight = await runThemeContextPreflight({
        shopifyClient,
        apiVersion,
        themeId: parsedInput.themeId,
        themeRole: parsedInput.themeRole,
        sectionHandle,
        sectionKey,
        overwriteSection: parsedInput.overwriteSection,
        addToTemplate: parsedInput.addToTemplate,
        templateKey: parsedInput.templateKey,
        insertPosition: parsedInput.insertPosition,
        referenceSectionId: parsedInput.referenceSectionId,
        sectionInstanceId: parsedInput.sectionInstanceId,
      });

      const compiled = buildSectionLiquid({
        sectionHandle,
        sectionMarkup: generated.sectionMarkup,
        schema: generated.schema,
        css: generated.css,
        js: generated.js,
      });

      const candidateViews = await activeRuntime.renderCandidateViews({
        previewHtml: generated.previewHtml,
        referenceViews,
        archetype: archetypeMatch.archetype,
        attempt,
      });

      const visualGate = await activeRuntime.compareVisualGate({
        referenceViews,
        candidateViews,
        archetype: archetypeMatch.archetype,
        attempt,
      });

      const visualIssues = [];
      for (const result of visualGate.perViewport || []) {
        if (!result.pass) {
          visualIssues.push(
            issue(
              "error",
              "visual_gate_fail",
              `Visual gate '${result.id}' mismatch ${Number(result.mismatchRatio || 1).toFixed(4)} > ${Number(result.threshold || 0).toFixed(4)}.`
            )
          );
        }
      }

      const schemaIssues = lint.issues || [];
      const themeIssues = themePreflight.issues || [];
      const validationIssues = [...schemaIssues, ...themeIssues, ...visualIssues];

      const validation = {
        status: deriveStatus(validationIssues),
        checks: {
          themeContext: toValidationCheck("themeContext", themeIssues),
          schema: toValidationCheck("schema", schemaIssues),
          bundle: toValidationCheck("bundle", []),
          visual: toValidationCheck("visual", visualIssues),
        },
        issues: validationIssues,
      };

      attemptLog.validation = {
        status: validation.status,
        issues: validation.issues,
      };

      if (validation.status !== "pass") {
        attempts.push(attemptLog);
        if (attempt < parsedInput.maxAttempts) {
          continue;
        }

        const errorCode = classifyFailureCode({
          schemaIssues,
          themeIssues,
          visualStatus: visualGate.status,
          referenceViews,
          archetype: archetypeMatch.archetype,
        });

        return buildFailureResponse({
          errorCode,
          message: `Section replication v3 faalde: ${errorCode}.`,
          archetype: archetypeMatch.archetype,
          confidence: archetypeMatch.confidence,
          validation,
          visualGate,
          attempts,
        });
      }

      const writes = await applyWrites({
        shopifyClient,
        apiVersion,
        input: parsedInput,
        sectionHandle,
        sectionKey,
        sectionLiquid: compiled.sectionLiquid,
        additionalFiles: compiled.additionalFiles,
      });

      attempts.push(attemptLog);

      return {
        action: "replicate_section_from_reference",
        status: "pass",
        archetype: archetypeMatch.archetype,
        confidence: archetypeMatch.confidence,
        validation,
        visualGate,
        writes: {
          ...writes,
          section: {
            ...writes.section,
            schema: compiled.schemaSummary,
          },
        },
        policy: {
          writesAllowed: true,
          manualFallbackAllowed: false,
          nextAction: "verify_readback",
        },
        telemetry: {
          pipeline: "section-replication-v3",
          generatedAt: toIsoNow(),
          attempts: attempts.length,
          referenceHash: crypto
            .createHash("sha256")
            .update(`${parsedInput.referenceUrl}|${parsedInput.visionHints || ""}`)
            .digest("hex"),
        },
        attempts,
      };
    } catch (error) {
      const runtimeMessage = formatErrorMessage(error);
      const issueCode = isPlaywrightBrowserMissingError(error) ? "browser_runtime_unavailable" : "runtime_error";
      attemptLog.runtimeError = {
        code: issueCode,
        message: runtimeMessage,
      };
      attempts.push(attemptLog);

      if (issueCode === "browser_runtime_unavailable" || attempt >= parsedInput.maxAttempts) {
        const userMessage =
          issueCode === "browser_runtime_unavailable"
            ? "Playwright Chromium ontbreekt in runtime. Installeer browser-binaries tijdens deploy zodat capture en visual gate kunnen draaien."
            : `Runtime fout tijdens section replicatie: ${runtimeMessage}`;
        return buildRuntimeFailureResponse({
          errorCode: "reference_unreachable",
          message: userMessage,
          issueCode,
          attempts,
        });
      }
    }
  }

  const sawTargetDetectionFailure = attempts.some((attempt) =>
    (attempt.referenceViews || []).some((entry) => entry.error === "target_detection_failed")
  );
  const sawReachableReference = attempts.some((attempt) => (attempt.referenceViews || []).some((entry) => entry.ok));
  const sawUnsupportedArchetype = attempts.some((attempt) => attempt.archetype === null && (attempt.referenceViews || []).some((entry) => entry.ok));

  const fallbackErrorCode = sawTargetDetectionFailure
    ? "target_detection_failed"
    : sawUnsupportedArchetype
      ? "unsupported_archetype"
      : "reference_unreachable";

  const fallbackMessageByCode = {
    reference_unreachable: "Reference URL kon niet worden opgehaald of geanalyseerd.",
    target_detection_failed: "Kon de juiste section target niet detecteren op de referentiepagina.",
    unsupported_archetype: "Geen ondersteund section-archetype gedetecteerd voor deze referentie.",
  };

  const fallbackValidation = {
    status: "fail",
    checks: {
      themeContext: toValidationCheck("themeContext", []),
      schema: toValidationCheck("schema", []),
      bundle: toValidationCheck("bundle", []),
      visual: toValidationCheck("visual", []),
    },
    issues: [
      issue(
        "error",
        fallbackErrorCode,
        fallbackMessageByCode[fallbackErrorCode] || "Section replication v3 faalde."
      ),
      ...(sawReachableReference && fallbackErrorCode === "reference_unreachable"
        ? [issue("warn", "reference_partial_capture", "Minimaal één reference request was bereikbaar maar niet bruikbaar.")]
        : []),
    ],
  };

  return buildFailureResponse({
    errorCode: fallbackErrorCode,
    message: `Section replication v3 faalde: ${fallbackErrorCode}.`,
    archetype: null,
    confidence: 0,
    validation: fallbackValidation,
    visualGate: {
      status: "fail",
      perViewport: PREVIEW_TARGETS.map((entry) => ({
        id: entry.id,
        pass: false,
        mismatchRatio: 1,
        threshold: entry.threshold,
        error: "reference_capture_failed",
      })),
    },
    attempts,
  });
};
