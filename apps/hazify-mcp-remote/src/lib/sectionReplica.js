import crypto from "crypto";
import { z } from "zod";
import { getThemeFile, resolveTheme, upsertThemeFile } from "./themeFiles.js";

const ThemeRoleSchema = z.enum(["main", "unpublished", "demo", "development"]);

const BundleFileSchema = z
  .object({
    key: z.string().min(1),
    value: z.string().optional(),
    attachment: z.string().optional(),
    checksum: z.string().optional(),
  })
  .superRefine((input, ctx) => {
    const hasValue = typeof input.value === "string";
    const hasAttachment = typeof input.attachment === "string";

    if (!hasValue && !hasAttachment) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["value"],
        message: "Provide either 'value' or 'attachment' for additional files.",
      });
    }

    if (hasValue && hasAttachment) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["attachment"],
        message: "Use either 'value' or 'attachment', not both.",
      });
    }
  });

const SectionSchemaSettingSchema = z.object({
  type: z.string().min(1),
  id: z.string().optional(),
  label: z.string().optional(),
}).passthrough();

const BlockSchema = z.object({
  type: z.string().min(1),
  name: z.string().min(1),
  limit: z.number().int().positive().optional(),
  settings: z.array(SectionSchemaSettingSchema).default([]),
}).passthrough();

const PresetSchema = z.object({
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
}).passthrough();

const SectionMarkupItemSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("heading"),
    settingId: z.string().min(1),
    tag: z.enum(["h1", "h2", "h3", "h4", "h5", "h6"]).default("h2"),
    className: z.string().optional(),
  }),
  z.object({
    kind: z.literal("text"),
    settingId: z.string().min(1),
    tag: z.string().default("p"),
    className: z.string().optional(),
  }),
  z.object({
    kind: z.literal("richtext"),
    settingId: z.string().min(1),
    className: z.string().optional(),
  }),
  z.object({
    kind: z.literal("image"),
    settingId: z.string().min(1),
    className: z.string().optional(),
    width: z.number().int().positive().default(1200),
    altSettingId: z.string().optional(),
  }),
  z.object({
    kind: z.literal("button"),
    labelSettingId: z.string().min(1),
    urlSettingId: z.string().min(1),
    className: z.string().optional(),
  }),
  z.object({
    kind: z.literal("blocks"),
    className: z.string().optional(),
    emptyText: z.string().optional(),
  }),
  z.object({
    kind: z.literal("literal"),
    liquid: z.string().min(1),
  }),
]);

const BlockMarkupItemSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("heading"),
    settingId: z.string().min(1),
    tag: z.enum(["h1", "h2", "h3", "h4", "h5", "h6"]).default("h3"),
    className: z.string().optional(),
  }),
  z.object({
    kind: z.literal("text"),
    settingId: z.string().min(1),
    tag: z.string().default("p"),
    className: z.string().optional(),
  }),
  z.object({
    kind: z.literal("richtext"),
    settingId: z.string().min(1),
    className: z.string().optional(),
  }),
  z.object({
    kind: z.literal("image"),
    settingId: z.string().min(1),
    className: z.string().optional(),
    width: z.number().int().positive().default(1200),
    altSettingId: z.string().optional(),
  }),
  z.object({
    kind: z.literal("button"),
    labelSettingId: z.string().min(1),
    urlSettingId: z.string().min(1),
    className: z.string().optional(),
  }),
  z.object({
    kind: z.literal("literal"),
    liquid: z.string().min(1),
  }),
]);

const BlockLayoutSchema = z.object({
  blockType: z.string().min(1),
  wrapperTag: z.string().default("div"),
  className: z.string().optional(),
  items: z.array(BlockMarkupItemSchema).default([]),
});

const MarkupSchema = z
  .object({
    mode: z.enum(["structured", "liquid"]).default("structured"),
    sectionItems: z.array(SectionMarkupItemSchema).default([]),
    blockLayouts: z.array(BlockLayoutSchema).default([]),
    liquid: z.string().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.mode === "liquid" && !String(value.liquid || "").trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["liquid"],
        message: "markup.liquid is verplicht als markup.mode='liquid'.",
      });
    }
  });

const SnippetSchema = z.object({
  key: z.string().min(1),
  content: z.string().min(1),
});

const AssetFileSchema = z.object({
  key: z.string().min(1),
  content: z.string().min(1),
});

const MobileRuleSchema = z.object({
  breakpointPx: z.number().int().min(240).max(2000),
  css: z.string().min(1),
});

export const SectionSpecSchema = z.object({
  version: z.literal("v2").default("v2"),
  handle: z.string().optional(),
  name: z.string().min(1),
  description: z.string().optional(),
  tag: z.string().default("section"),
  className: z.string().optional(),
  limit: z.number().int().positive().optional(),
  maxBlocks: z.number().int().positive().optional(),
  settings: z.array(SectionSchemaSettingSchema).default([]),
  blocks: z.array(BlockSchema).default([]),
  presets: z.array(PresetSchema).min(1),
  markup: MarkupSchema,
  mobileRules: z.array(MobileRuleSchema).default([]),
  assets: z
    .object({
      css: z.string().default(""),
      js: z.string().optional(),
      snippets: z.array(SnippetSchema).default([]),
      files: z.array(AssetFileSchema).default([]),
    })
    .default({ css: "", snippets: [], files: [] }),
});

export const PrepareSectionReplicaInputSchema = z.object({
  referenceUrl: z.string().url(),
  imageUrls: z.array(z.string().url()).max(10).default([]),
  previewRequired: z.boolean().default(true),
  sectionHandle: z.string().min(1).optional(),
  sectionSpec: SectionSpecSchema,
  themeId: z.coerce.number().int().positive().optional(),
  themeRole: ThemeRoleSchema.default("main"),
  overwriteSection: z.boolean().default(false),
  addToTemplate: z.boolean().default(true),
  templateKey: z.string().default("templates/index.json"),
  sectionInstanceId: z.string().optional(),
  insertPosition: z.enum(["start", "end", "before", "after"]).default("end"),
  referenceSectionId: z.string().optional(),
  sectionSettings: z.record(z.unknown()).optional(),
  additionalFiles: z.array(BundleFileSchema).max(20).default([]),
  applyOn: z.enum(["pass", "warn"]).default("warn"),
  sourceTool: z.string().optional(),
});

export const ApplySectionReplicaInputSchema = z.object({
  planId: z.string().min(1),
  allowWarn: z.boolean().default(true),
  verify: z.boolean().default(true),
});

const PREVIEW_USER_AGENTS = {
  desktop:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
  mobile:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1",
};

const SCHEMA_BLOCK_REGEX = /{%\s*schema\s*%}([\s\S]*?){%\s*endschema\s*%}/i;
const SECTION_PLAN_TTL_MS = Number(process.env.HAZIFY_SECTION_PLAN_TTL_MS || 60 * 60 * 1000);
const ID_OPTIONAL_SETTING_TYPES = new Set(["header", "paragraph", "note"]);
const ALLOWED_ADDITIONAL_PREFIXES = ["assets/", "snippets/", "locales/", "blocks/"];

const sectionReplicaPlanStore = new Map();

const asIsoNow = () => new Date().toISOString();

const cleanHtmlForTokenizing = (html) =>
  String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

const tokenize = (value) => {
  const tokens = String(value || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .filter((part) => part.length >= 3);
  return Array.from(new Set(tokens));
};

const byteLength = (value) => Buffer.byteLength(String(value || ""), "utf8");

const normalizeTemplateSectionId = (rawId) => {
  const normalized = String(rawId || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "");
  return normalized || "";
};

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

const humanizeHandle = (handle) =>
  String(handle || "")
    .split(/[-_]+/g)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
    .trim() || "Custom Section";

const uniqueStrings = (values) => Array.from(new Set(values.filter((value) => typeof value === "string" && value.trim())));

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

const escapeAttr = (value) =>
  String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .trim();

const findSettingIds = (settings) => {
  const all = [];
  for (const setting of settings || []) {
    if (setting && typeof setting === "object" && typeof setting.id === "string" && setting.id.trim()) {
      all.push(setting.id.trim());
    }
  }
  return all;
};

const lintSectionSpec = (sectionSpec) => {
  const errors = [];
  const warnings = [];

  const sectionIds = [];
  const sectionIdSet = new Set();
  for (const setting of sectionSpec.settings || []) {
    const settingType = String(setting?.type || "").trim().toLowerCase();
    const settingId = typeof setting?.id === "string" ? setting.id.trim() : "";

    if (!settingType) {
      errors.push("section.settings bevat item zonder 'type'.");
      continue;
    }

    if (!settingId && !ID_OPTIONAL_SETTING_TYPES.has(settingType)) {
      errors.push(`section.settings type '${settingType}' mist verplicht veld 'id'.`);
      continue;
    }

    if (settingId) {
      sectionIds.push(settingId);
      if (sectionIdSet.has(settingId)) {
        errors.push(`section.settings bevat duplicate id '${settingId}'.`);
      }
      sectionIdSet.add(settingId);
    }
  }

  const blockTypeSet = new Set();
  const blockSettingIdsByType = new Map();
  for (const block of sectionSpec.blocks || []) {
    const blockType = String(block?.type || "").trim();
    if (!blockType) {
      errors.push("section.blocks bevat item zonder 'type'.");
      continue;
    }

    if (blockTypeSet.has(blockType)) {
      warnings.push(`section.blocks bevat duplicate block type '${blockType}'.`);
    }
    blockTypeSet.add(blockType);

    const blockIds = [];
    const blockIdSet = new Set();
    for (const setting of block.settings || []) {
      const settingType = String(setting?.type || "").trim().toLowerCase();
      const settingId = typeof setting?.id === "string" ? setting.id.trim() : "";

      if (!settingType) {
        errors.push(`block '${blockType}' bevat setting zonder 'type'.`);
        continue;
      }

      if (!settingId && !ID_OPTIONAL_SETTING_TYPES.has(settingType)) {
        errors.push(`block '${blockType}' setting type '${settingType}' mist verplicht veld 'id'.`);
        continue;
      }

      if (settingId) {
        blockIds.push(settingId);
        if (blockIdSet.has(settingId)) {
          errors.push(`block '${blockType}' bevat duplicate setting id '${settingId}'.`);
        }
        blockIdSet.add(settingId);
      }
    }

    blockSettingIdsByType.set(blockType, new Set(blockIds));
  }

  for (const preset of sectionSpec.presets || []) {
    const presetBlocks = Array.isArray(preset?.blocks) ? preset.blocks : [];
    for (const presetBlock of presetBlocks) {
      const presetType = String(presetBlock?.type || "").trim();
      if (presetType && !blockTypeSet.has(presetType)) {
        errors.push(`preset '${preset.name}' verwijst naar onbekend block type '${presetType}'.`);
      }
    }
  }

  if (sectionSpec.markup.mode === "structured") {
    for (const item of sectionSpec.markup.sectionItems || []) {
      if (item.kind === "blocks") {
        continue;
      }

      if (item.kind === "heading" || item.kind === "text" || item.kind === "richtext" || item.kind === "image") {
        if (!sectionIdSet.has(item.settingId)) {
          errors.push(`markup.sectionItems verwijst naar onbekende section setting '${item.settingId}'.`);
        }
      }

      if (item.kind === "button") {
        if (!sectionIdSet.has(item.labelSettingId)) {
          errors.push(`markup.sectionItems.button mist setting '${item.labelSettingId}'.`);
        }
        if (!sectionIdSet.has(item.urlSettingId)) {
          errors.push(`markup.sectionItems.button mist setting '${item.urlSettingId}'.`);
        }
      }
    }

    for (const layout of sectionSpec.markup.blockLayouts || []) {
      const blockType = String(layout?.blockType || "").trim();
      if (!blockTypeSet.has(blockType)) {
        errors.push(`markup.blockLayouts verwijst naar onbekend block type '${blockType}'.`);
        continue;
      }

      const settingIds = blockSettingIdsByType.get(blockType) || new Set();
      for (const item of layout.items || []) {
        if (item.kind === "heading" || item.kind === "text" || item.kind === "richtext" || item.kind === "image") {
          if (!settingIds.has(item.settingId)) {
            errors.push(
              `markup.blockLayouts '${blockType}' verwijst naar onbekende block setting '${item.settingId}'.`
            );
          }
        }

        if (item.kind === "button") {
          if (!settingIds.has(item.labelSettingId)) {
            errors.push(
              `markup.blockLayouts '${blockType}' button mist setting '${item.labelSettingId}'.`
            );
          }
          if (!settingIds.has(item.urlSettingId)) {
            errors.push(
              `markup.blockLayouts '${blockType}' button mist setting '${item.urlSettingId}'.`
            );
          }
        }
      }
    }

    const hasBlocksSetting = (sectionSpec.markup.sectionItems || []).some((item) => item.kind === "blocks");
    if (sectionSpec.blocks.length > 0 && !hasBlocksSetting) {
      warnings.push("section.blocks is gedefinieerd maar markup.sectionItems bevat geen 'blocks' placeholder.");
    }
  }

  return {
    errors,
    warnings,
    sectionSettingIds: sectionIds,
  };
};

const renderSectionItem = (item) => {
  if (item.kind === "literal") {
    return item.liquid;
  }

  if (item.kind === "heading") {
    const classAttr = item.className ? ` class="${escapeAttr(item.className)}"` : "";
    return `<${item.tag}${classAttr}>{{ section.settings.${item.settingId} | escape }}</${item.tag}>`;
  }

  if (item.kind === "text") {
    const tag = item.tag || "p";
    const classAttr = item.className ? ` class="${escapeAttr(item.className)}"` : "";
    return `<${tag}${classAttr}>{{ section.settings.${item.settingId} | escape }}</${tag}>`;
  }

  if (item.kind === "richtext") {
    const className = uniqueStrings([item.className, "rte"]).join(" ");
    const classAttr = className ? ` class="${escapeAttr(className)}"` : "";
    return `<div${classAttr}>{{ section.settings.${item.settingId} }}</div>`;
  }

  if (item.kind === "image") {
    const classAttr = item.className ? ` class="${escapeAttr(item.className)}"` : "";
    const altValue = item.altSettingId
      ? `{{ section.settings.${item.altSettingId} | escape }}`
      : `{{ section.settings.${item.settingId}.alt | escape }}`;

    return [
      `{% if section.settings.${item.settingId} != blank %}`,
      `  <img${classAttr} src="{{ section.settings.${item.settingId} | image_url: width: ${item.width} }}" alt="${altValue}" loading="lazy">`,
      `{% endif %}`,
    ].join("\n");
  }

  if (item.kind === "button") {
    const className = uniqueStrings([item.className, "button"]).join(" ");
    const classAttr = className ? ` class="${escapeAttr(className)}"` : "";
    return [
      `{% if section.settings.${item.urlSettingId} != blank and section.settings.${item.labelSettingId} != blank %}`,
      `  <a href="{{ section.settings.${item.urlSettingId} }}"${classAttr}>{{ section.settings.${item.labelSettingId} | escape }}</a>`,
      `{% endif %}`,
    ].join("\n");
  }

  return "";
};

const renderBlockItem = (item) => {
  if (item.kind === "literal") {
    return item.liquid;
  }

  if (item.kind === "heading") {
    const classAttr = item.className ? ` class="${escapeAttr(item.className)}"` : "";
    return `<${item.tag}${classAttr}>{{ block.settings.${item.settingId} | escape }}</${item.tag}>`;
  }

  if (item.kind === "text") {
    const tag = item.tag || "p";
    const classAttr = item.className ? ` class="${escapeAttr(item.className)}"` : "";
    return `<${tag}${classAttr}>{{ block.settings.${item.settingId} | escape }}</${tag}>`;
  }

  if (item.kind === "richtext") {
    const className = uniqueStrings([item.className, "rte"]).join(" ");
    const classAttr = className ? ` class="${escapeAttr(className)}"` : "";
    return `<div${classAttr}>{{ block.settings.${item.settingId} }}</div>`;
  }

  if (item.kind === "image") {
    const classAttr = item.className ? ` class="${escapeAttr(item.className)}"` : "";
    const altValue = item.altSettingId
      ? `{{ block.settings.${item.altSettingId} | escape }}`
      : `{{ block.settings.${item.settingId}.alt | escape }}`;

    return [
      `{% if block.settings.${item.settingId} != blank %}`,
      `  <img${classAttr} src="{{ block.settings.${item.settingId} | image_url: width: ${item.width} }}" alt="${altValue}" loading="lazy">`,
      `{% endif %}`,
    ].join("\n");
  }

  if (item.kind === "button") {
    const className = uniqueStrings([item.className, "button"]).join(" ");
    const classAttr = className ? ` class="${escapeAttr(className)}"` : "";
    return [
      `{% if block.settings.${item.urlSettingId} != blank and block.settings.${item.labelSettingId} != blank %}`,
      `  <a href="{{ block.settings.${item.urlSettingId} }}"${classAttr}>{{ block.settings.${item.labelSettingId} | escape }}</a>`,
      `{% endif %}`,
    ].join("\n");
  }

  return "";
};

const buildStructuredMarkup = (sectionSpec, sectionHandle) => {
  const wrapperTag = sectionSpec.tag || "section";
  const wrapperClass = uniqueStrings([sectionSpec.className, `section-${sectionHandle}`]).join(" ");
  const wrapperClassAttr = wrapperClass ? ` class="${escapeAttr(wrapperClass)}"` : "";

  const lines = [];
  lines.push(`<${wrapperTag}${wrapperClassAttr}>`);

  for (const item of sectionSpec.markup.sectionItems || []) {
    if (item.kind === "blocks") {
      const className = uniqueStrings([item.className, `section-${sectionHandle}__blocks`]).join(" ");
      const classAttr = className ? ` class="${escapeAttr(className)}"` : "";
      const blockLayouts = sectionSpec.markup.blockLayouts || [];

      lines.push(`<div${classAttr}>`);
      lines.push("{% for block in section.blocks %}");
      lines.push("  {% case block.type %}");

      for (const layout of blockLayouts) {
        const wrapper = layout.wrapperTag || "div";
        const layoutClass = uniqueStrings([layout.className, `${sectionHandle}__block`, `${sectionHandle}__block--${layout.blockType}`]).join(" ");
        const layoutClassAttr = layoutClass ? ` class=\"${escapeAttr(layoutClass)}\"` : "";

        lines.push(`    {% when '${layout.blockType}' %}`);
        lines.push(`      <${wrapper}${layoutClassAttr} {{ block.shopify_attributes }}>`);
        for (const layoutItem of layout.items || []) {
          const rendered = renderBlockItem(layoutItem);
          const renderedLines = String(rendered || "").split("\n").map((line) => line ? `        ${line}` : "");
          lines.push(...renderedLines);
        }
        lines.push(`      </${wrapper}>`);
      }

      lines.push("    {% else %}");
      lines.push("      <div class=\"section-block section-block--unknown\" {{ block.shopify_attributes }}>{{ block.type }}</div>");
      lines.push("  {% endcase %}");
      lines.push("{% endfor %}");

      if (item.emptyText) {
        lines.push("{% if section.blocks.size == 0 %}");
        lines.push(`  <p class=\"section-block-empty\">${escapeAttr(item.emptyText)}</p>`);
        lines.push("{% endif %}");
      }

      lines.push("</div>");
      continue;
    }

    const rendered = renderSectionItem(item);
    lines.push(...String(rendered || "").split("\n"));
  }

  lines.push(`</${wrapperTag}>`);

  return `${lines.join("\n")}\n`;
};

const buildShopifySchemaJson = (sectionSpec) => {
  const schema = {
    name: sectionSpec.name,
    settings: sectionSpec.settings || [],
    blocks: sectionSpec.blocks || [],
    presets: sectionSpec.presets || [],
  };

  if (sectionSpec.tag) {
    schema.tag = sectionSpec.tag;
  }

  if (sectionSpec.className) {
    schema.class = sectionSpec.className;
  }

  if (sectionSpec.limit !== undefined) {
    schema.limit = sectionSpec.limit;
  }

  if (sectionSpec.maxBlocks !== undefined) {
    schema.max_blocks = sectionSpec.maxBlocks;
  }

  return schema;
};

const assertAllowedAdditionalKey = (key) => {
  const normalized = String(key || "").trim().toLowerCase();
  const allowed = ALLOWED_ADDITIONAL_PREFIXES.some((prefix) => normalized.startsWith(prefix));

  if (!allowed) {
    throw new Error(
      `additionalFiles key '${key}' is niet toegestaan. Gebruik alleen: ${ALLOWED_ADDITIONAL_PREFIXES.join(", ")}`
    );
  }

  if (normalized.startsWith("sections/") || normalized.startsWith("templates/")) {
    throw new Error(
      `Gebruik section/template velden van de section-replica flow voor '${key}', niet additionalFiles.`
    );
  }
};

const compileSectionReplicaFiles = ({ sectionHandle, sectionSpec, additionalFiles }) => {
  const lint = lintSectionSpec(sectionSpec);

  const sectionBody =
    sectionSpec.markup.mode === "liquid"
      ? `${String(sectionSpec.markup.liquid || "").trim()}\n`
      : buildStructuredMarkup(sectionSpec, sectionHandle);

  const schemaJson = buildShopifySchemaJson(sectionSpec);
  const schemaBlock = `{% schema %}\n${JSON.stringify(schemaJson, null, 2)}\n{% endschema %}\n`;

  const cssAssetName = `section-${sectionHandle}.css`;
  const jsAssetName = `section-${sectionHandle}.js`;

  const includeCss = typeof sectionSpec.assets?.css === "string" && sectionSpec.assets.css.trim();
  const includeJs = typeof sectionSpec.assets?.js === "string" && sectionSpec.assets.js.trim();

  const headerLines = [];
  if (includeCss) {
    headerLines.push(`{{ '${cssAssetName}' | asset_url | stylesheet_tag }}`);
  }
  if (includeJs) {
    headerLines.push(`<script src=\"{{ '${jsAssetName}' | asset_url }}\" defer=\"defer\"></script>`);
  }

  const sectionLiquid = [
    ...headerLines,
    sectionBody.trimEnd(),
    schemaBlock.trimEnd(),
    "",
  ]
    .filter((line, index, all) => !(line === "" && index > 0 && all[index - 1] === ""))
    .join("\n");

  const extraFiles = [];

  if (includeCss) {
    extraFiles.push({
      key: `assets/${cssAssetName}`,
      value: `${String(sectionSpec.assets.css || "").trim()}\n`,
    });
  }

  if (includeJs) {
    extraFiles.push({
      key: `assets/${jsAssetName}`,
      value: `${String(sectionSpec.assets.js || "").trim()}\n`,
    });
  }

  for (const snippet of sectionSpec.assets?.snippets || []) {
    const snippetKey = String(snippet.key || "").includes("/")
      ? String(snippet.key || "")
      : `snippets/${snippet.key}`;
    extraFiles.push({ key: snippetKey, value: `${snippet.content}\n` });
  }

  for (const file of sectionSpec.assets?.files || []) {
    extraFiles.push({ key: file.key, value: `${file.content}\n` });
  }

  for (const mobileRule of sectionSpec.mobileRules || []) {
    if (!includeCss) {
      lint.warnings.push("mobileRules is opgegeven maar assets.css is leeg; media rules zijn genegeerd.");
      continue;
    }

    const cssKey = `assets/${cssAssetName}`;
    const cssFile = extraFiles.find((entry) => entry.key === cssKey);
    if (cssFile && typeof cssFile.value === "string") {
      cssFile.value += `\n@media screen and (max-width: ${mobileRule.breakpointPx}px) {\n${mobileRule.css}\n}\n`;
    }
  }

  for (const legacyFile of additionalFiles || []) {
    if (typeof legacyFile.value === "string") {
      extraFiles.push({ key: legacyFile.key, value: legacyFile.value, checksum: legacyFile.checksum });
    } else {
      extraFiles.push({
        key: legacyFile.key,
        attachment: legacyFile.attachment,
        checksum: legacyFile.checksum,
      });
    }
  }

  for (const file of extraFiles) {
    assertAllowedAdditionalKey(file.key);
  }

  return {
    sectionLiquid,
    additionalFiles: extraFiles,
    lint,
    schemaSummary: {
      name: sectionSpec.name,
      presetsCount: Array.isArray(sectionSpec.presets) ? sectionSpec.presets.length : 0,
      settingsCount: Array.isArray(sectionSpec.settings) ? sectionSpec.settings.length : 0,
      blocksCount: Array.isArray(sectionSpec.blocks) ? sectionSpec.blocks.length : 0,
    },
  };
};

const hasIssueSeverity = (issues, severity) => issues.some((issue) => issue.severity === severity);

const deriveStatusFromIssues = (issues) => {
  if (hasIssueSeverity(issues, "error")) {
    return "fail";
  }
  if (hasIssueSeverity(issues, "warn")) {
    return "warn";
  }
  return "pass";
};

const summarizeAssetRead = (asset) => ({
  key: asset?.key || null,
  checksum: asset?.checksum || null,
  valueBytes: typeof asset?.value === "string" ? Buffer.byteLength(asset.value, "utf8") : null,
  hasAttachment: Boolean(asset?.attachment),
  attachmentLength: typeof asset?.attachment === "string" ? asset.attachment.length : null,
});

const createPlanId = () => `secplan_${crypto.randomUUID().replace(/-/g, "")}`;

const purgeExpiredPlans = () => {
  const now = Date.now();
  for (const [id, entry] of sectionReplicaPlanStore.entries()) {
    if (entry.expiresAtMs <= now) {
      sectionReplicaPlanStore.delete(id);
    }
  }
};

const putPlan = (plan) => {
  purgeExpiredPlans();
  sectionReplicaPlanStore.set(plan.planId, plan);
};

const getPlan = (planId) => {
  purgeExpiredPlans();
  return sectionReplicaPlanStore.get(planId) || null;
};

const buildFilePlan = ({ sectionKey, sectionLiquid, additionalFiles, templateKey, addToTemplate, sectionIdCandidate }) => ({
  section: {
    key: sectionKey,
    valueBytes: byteLength(sectionLiquid),
  },
  template: addToTemplate
    ? {
        key: templateKey,
        sectionIdCandidate,
      }
    : null,
  additionalFiles: additionalFiles.map((file) => ({
    key: file.key,
    mode: typeof file.value === "string" ? "value" : "attachment",
    valueBytes: typeof file.value === "string" ? byteLength(file.value) : null,
    attachmentLength: typeof file.attachment === "string" ? file.attachment.length : null,
  })),
});

const fetchReferenceTarget = async (referenceUrl, userAgent) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);

  try {
    const response = await fetch(referenceUrl, {
      method: "GET",
      headers: {
        "user-agent": userAgent,
        accept: "text/html,application/xhtml+xml",
      },
      signal: controller.signal,
    });

    const html = await response.text();
    const normalizedText = cleanHtmlForTokenizing(html);
    const textHash = crypto.createHash("sha256").update(normalizedText).digest("hex");

    return {
      ok: response.ok,
      statusCode: response.status,
      contentBytes: byteLength(html),
      title: (String(html).match(/<title>([\s\S]*?)<\/title>/i)?.[1] || "").trim().slice(0, 200),
      textHash,
      textTokens: tokenize(normalizedText),
      fetchError: null,
    };
  } catch (error) {
    return {
      ok: false,
      statusCode: null,
      contentBytes: 0,
      title: "",
      textHash: null,
      textTokens: [],
      fetchError: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timeout);
  }
};

const evaluatePreviewGate = ({ referenceSnapshots, sectionSpec, imageUrls, previewRequired }) => {
  const issues = [];

  const tokenPool = [];
  tokenPool.push(sectionSpec.name || "");
  tokenPool.push(sectionSpec.description || "");
  tokenPool.push(...(sectionSpec.presets || []).map((preset) => preset.name || ""));
  tokenPool.push(...(sectionSpec.settings || []).map((setting) => setting.label || setting.id || ""));
  const specTokens = tokenize(tokenPool.join(" "));

  let overlapScore = 0;
  for (const snapshot of referenceSnapshots) {
    if (!snapshot.ok) {
      continue;
    }

    if (!snapshot.textTokens.length || !specTokens.length) {
      continue;
    }

    const overlap = specTokens.filter((token) => snapshot.textTokens.includes(token));
    const score = overlap.length / specTokens.length;
    if (score > overlapScore) {
      overlapScore = score;
    }
  }

  const successfulSnapshots = referenceSnapshots.filter((snapshot) => snapshot.ok);
  if (successfulSnapshots.length === 0) {
    issues.push({
      severity: previewRequired ? "error" : "warn",
      code: previewRequired ? "preview_reference_unreachable" : "preview_reference_unreachable_optional",
      message: previewRequired
        ? "Preview snapshot-gate faalde: referenceUrl kon niet worden opgehaald voor desktop/mobile."
        : "Preview snapshot-gate kon referenceUrl niet ophalen; status is als warning vastgelegd omdat previewRequired=false.",
    });
  } else {
    if (overlapScore < 0.04) {
      issues.push({
        severity: imageUrls.length > 0 ? "warn" : "warn",
        code: "preview_low_keyword_overlap",
        message:
          "Preview snapshot-gate: lage semantische overlap tussen sectionSpec en referentiecontent. Controleer naming/settings/blocks.",
      });
    }

    const smallSnapshot = successfulSnapshots.find((snapshot) => snapshot.contentBytes < 1200);
    if (smallSnapshot) {
      issues.push({
        severity: "warn",
        code: "preview_small_reference_payload",
        message: "Preview snapshot-gate: reference response is klein; visuele vergelijking kan beperkt zijn.",
      });
    }
  }

  return {
    overlapScore,
    issues,
  };
};

const sectionSpecToKeywordString = (sectionSpec) => {
  const chunks = [
    sectionSpec.name,
    sectionSpec.description,
    ...(sectionSpec.presets || []).map((preset) => preset.name),
    ...(sectionSpec.settings || []).map((setting) => setting.label || setting.id),
    ...(sectionSpec.blocks || []).map((block) => block.name || block.type),
  ];

  return chunks.filter(Boolean).join(" ");
};

const runThemeContextPreflight = async ({
  shopifyClient,
  apiVersion,
  sectionHandle,
  themeId,
  themeRole,
  templateKey,
  addToTemplate,
  insertPosition,
  referenceSectionId,
  sectionInstanceId,
  overwriteSection,
}) => {
  const issues = [];

  const theme = await resolveTheme(shopifyClient, apiVersion, { themeId, themeRole });

  const sectionKey = `sections/${sectionHandle}.liquid`;
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
    issues.push({
      severity: "error",
      code: "section_exists_overwrite_false",
      message: `Section '${sectionKey}' bestaat al en overwriteSection=false.`,
    });
  }

  let templateInfo = null;
  if (addToTemplate) {
    const templateFile = await getThemeFile(shopifyClient, apiVersion, {
      themeId: theme.id,
      key: templateKey,
    });

    if (typeof templateFile?.asset?.value !== "string" || !templateFile.asset.value.trim()) {
      issues.push({
        severity: "error",
        code: "template_missing_json",
        message: `Template '${templateKey}' bevat geen leesbare JSON tekst (asset.value ontbreekt).`,
      });
    } else {
      const templateJson = ensureJsonTemplateStructure(templateFile.asset.value, templateKey);
      const sectionIdCandidate = pickSectionInstanceId(sectionHandle, sectionInstanceId, templateJson);

      if ((insertPosition === "before" || insertPosition === "after") && !referenceSectionId) {
        issues.push({
          severity: "error",
          code: "template_missing_reference_section",
          message: `referenceSectionId is verplicht bij insertPosition='${insertPosition}'.`,
        });
      }

      if ((insertPosition === "before" || insertPosition === "after") && referenceSectionId) {
        const exists = Array.isArray(templateJson.order) && templateJson.order.includes(referenceSectionId);
        if (!exists) {
          issues.push({
            severity: "error",
            code: "template_reference_section_missing",
            message: `referenceSectionId '${referenceSectionId}' niet gevonden in template.order.`,
          });
        }
      }

      templateInfo = {
        key: templateKey,
        sectionIdCandidate,
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
    template: templateInfo,
    issues,
  };
};

const mergeIssues = (...parts) => {
  const merged = [];
  for (const part of parts) {
    if (!Array.isArray(part)) {
      continue;
    }
    merged.push(...part);
  }
  return merged;
};

const toValidationCheck = (name, issues) => {
  const status = deriveStatusFromIssues(issues);
  return {
    status,
    issues,
    name,
  };
};

export const parseLegacySectionLiquid = ({ liquid, sectionHandle, validateSchema, requirePresets }) => {
  const normalizedHandle = normalizeSectionHandle(sectionHandle);
  const match = String(liquid || "").match(SCHEMA_BLOCK_REGEX);

  let schema = null;
  let markupLiquid = String(liquid || "");

  if (match) {
    try {
      schema = JSON.parse(String(match[1] || "").trim());
    } catch (_error) {
      if (validateSchema) {
        throw new Error("Section schema bevat ongeldige JSON.");
      }
    }

    markupLiquid = String(liquid || "").replace(SCHEMA_BLOCK_REGEX, "").trim();
  } else if (validateSchema) {
    throw new Error(
      "Section Liquid mist een {% schema %} ... {% endschema %} blok. Zonder schema is Theme Editor-configuratie niet mogelijk."
    );
  }

  const fallbackName = humanizeHandle(normalizedHandle);
  const schemaName = typeof schema?.name === "string" && schema.name.trim() ? schema.name.trim() : fallbackName;
  const presets = Array.isArray(schema?.presets) ? schema.presets : [];

  if (validateSchema && requirePresets && presets.length === 0) {
    throw new Error(
      "Section schema mist 'presets'. Voeg minimaal 1 preset toe zodat de section in Theme Editor > Add section verschijnt."
    );
  }

  const normalizedPresets = presets.length > 0 ? presets : [{ name: schemaName }];

  return {
    version: "v2",
    handle: normalizedHandle,
    name: schemaName,
    description: typeof schema?.description === "string" ? schema.description : undefined,
    tag: typeof schema?.tag === "string" && schema.tag.trim() ? schema.tag.trim() : "section",
    className: typeof schema?.class === "string" && schema.class.trim() ? schema.class.trim() : undefined,
    limit: Number.isInteger(schema?.limit) ? schema.limit : undefined,
    maxBlocks: Number.isInteger(schema?.max_blocks) ? schema.max_blocks : undefined,
    settings: Array.isArray(schema?.settings) ? schema.settings : [],
    blocks: Array.isArray(schema?.blocks) ? schema.blocks : [],
    presets: normalizedPresets,
    markup: {
      mode: "liquid",
      liquid: markupLiquid || "<div></div>",
      sectionItems: [],
      blockLayouts: [],
    },
    mobileRules: [],
    assets: {
      css: "",
      snippets: [],
      files: [],
    },
  };
};

export const prepareSectionReplicaPlan = async ({ shopifyClient, apiVersion, input }) => {
  const parsedInput = PrepareSectionReplicaInputSchema.parse(input);

  const desiredHandle = parsedInput.sectionHandle || parsedInput.sectionSpec.handle || parsedInput.sectionSpec.name;
  const sectionHandle = normalizeSectionHandle(desiredHandle);
  const normalizedSectionSpec = {
    ...parsedInput.sectionSpec,
    handle: sectionHandle,
  };

  const compiled = compileSectionReplicaFiles({
    sectionHandle,
    sectionSpec: normalizedSectionSpec,
    additionalFiles: parsedInput.additionalFiles,
  });

  const schemaIssues = [
    ...compiled.lint.errors.map((message) => ({ severity: "error", code: "schema_lint_error", message })),
    ...compiled.lint.warnings.map((message) => ({ severity: "warn", code: "schema_lint_warning", message })),
  ];

  const bundleIssues = [];
  for (const file of compiled.additionalFiles) {
    try {
      assertAllowedAdditionalKey(file.key);
    } catch (error) {
      bundleIssues.push({
        severity: "error",
        code: "bundle_invalid_path",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const themePreflight = await runThemeContextPreflight({
    shopifyClient,
    apiVersion,
    sectionHandle,
    themeId: parsedInput.themeId,
    themeRole: parsedInput.themeRole,
    templateKey: parsedInput.templateKey,
    addToTemplate: parsedInput.addToTemplate,
    insertPosition: parsedInput.insertPosition,
    referenceSectionId: parsedInput.referenceSectionId,
    sectionInstanceId: parsedInput.sectionInstanceId,
    overwriteSection: parsedInput.overwriteSection,
  });

  const desktopSnapshot = await fetchReferenceTarget(parsedInput.referenceUrl, PREVIEW_USER_AGENTS.desktop);
  const mobileSnapshot = await fetchReferenceTarget(parsedInput.referenceUrl, PREVIEW_USER_AGENTS.mobile);
  const previewEval = evaluatePreviewGate({
    referenceSnapshots: [desktopSnapshot, mobileSnapshot],
    sectionSpec: normalizedSectionSpec,
    imageUrls: parsedInput.imageUrls,
    previewRequired: parsedInput.previewRequired,
  });

  const previewIssues = previewEval.issues;

  const validationIssues = mergeIssues(themePreflight.issues, schemaIssues, bundleIssues, previewIssues);

  const checks = {
    themeContext: toValidationCheck("themeContext", themePreflight.issues),
    schema: toValidationCheck("schema", schemaIssues),
    bundle: toValidationCheck("bundle", bundleIssues),
    preview: toValidationCheck("preview", previewIssues),
  };

  const preflightStatus = deriveStatusFromIssues(validationIssues);

  const planId = createPlanId();
  const createdAtMs = Date.now();
  const ttl = Number.isFinite(SECTION_PLAN_TTL_MS) && SECTION_PLAN_TTL_MS > 0 ? SECTION_PLAN_TTL_MS : 60 * 60 * 1000;
  const expiresAtMs = createdAtMs + ttl;

  const filePlan = buildFilePlan({
    sectionKey: themePreflight.sectionKey,
    sectionLiquid: compiled.sectionLiquid,
    additionalFiles: compiled.additionalFiles,
    templateKey: parsedInput.templateKey,
    addToTemplate: parsedInput.addToTemplate,
    sectionIdCandidate: themePreflight.template?.sectionIdCandidate || null,
  });

  const previewTargets = [
    {
      id: "desktop",
      viewport: "1440x900",
      referenceUrl: parsedInput.referenceUrl,
      userAgent: PREVIEW_USER_AGENTS.desktop,
      snapshot: {
        ok: desktopSnapshot.ok,
        statusCode: desktopSnapshot.statusCode,
        contentBytes: desktopSnapshot.contentBytes,
        title: desktopSnapshot.title,
        textHash: desktopSnapshot.textHash,
        fetchError: desktopSnapshot.fetchError,
      },
    },
    {
      id: "mobile",
      viewport: "390x844",
      referenceUrl: parsedInput.referenceUrl,
      userAgent: PREVIEW_USER_AGENTS.mobile,
      snapshot: {
        ok: mobileSnapshot.ok,
        statusCode: mobileSnapshot.statusCode,
        contentBytes: mobileSnapshot.contentBytes,
        title: mobileSnapshot.title,
        textHash: mobileSnapshot.textHash,
        fetchError: mobileSnapshot.fetchError,
      },
    },
  ];

  const plan = {
    planId,
    createdAt: new Date(createdAtMs).toISOString(),
    expiresAt: new Date(expiresAtMs).toISOString(),
    createdAtMs,
    expiresAtMs,
    input: {
      ...parsedInput,
      sectionHandle,
      sectionSpec: normalizedSectionSpec,
    },
    compiled,
    themeContext: themePreflight,
    validation: {
      preflight: {
        status: preflightStatus,
        checks,
        issues: validationIssues,
      },
    },
    previewTargets,
    keywordContext: sectionSpecToKeywordString(normalizedSectionSpec),
  };

  putPlan(plan);

  return {
    action: "prepared_section_replica",
    planId,
    createdAt: plan.createdAt,
    expiresAt: plan.expiresAt,
    theme: themePreflight.theme,
    sectionHandle,
    sectionSpec: normalizedSectionSpec,
    filePlan,
    validation: {
      preflight: {
        status: preflightStatus,
        checks,
        issues: validationIssues,
      },
    },
    previewTargets,
    telemetry: {
      pipeline: "section-replica-v2",
      sourceTool: parsedInput.sourceTool || "prepare-section-replica",
      generatedAt: asIsoNow(),
      applyOn: parsedInput.applyOn,
      overlapScore: previewEval.overlapScore,
    },
  };
};

export const applySectionReplicaPlan = async ({ shopifyClient, apiVersion, input }) => {
  const parsedInput = ApplySectionReplicaInputSchema.parse(input);
  const plan = getPlan(parsedInput.planId);

  if (!plan) {
    throw new Error(`Section plan '${parsedInput.planId}' niet gevonden of verlopen. Run prepare-section-replica opnieuw.`);
  }

  const preflight = plan.validation?.preflight || { status: "fail", issues: [] };

  if (preflight.status === "fail") {
    const firstError = Array.isArray(preflight.issues)
      ? preflight.issues.find((issue) => issue?.severity === "error")
      : null;
    const suffix =
      firstError && typeof firstError.message === "string"
        ? ` Details: ${firstError.message}`
        : "";
    throw new Error(
      `Section plan heeft preflight status 'fail'. Los de fouten op en run prepare-section-replica opnieuw.${suffix}`
    );
  }

  if (preflight.status === "warn" && !parsedInput.allowWarn) {
    throw new Error("Section plan bevat warnings. Zet allowWarn=true of corrigeer de warnings via prepare-section-replica.");
  }

  if (plan.input.applyOn === "pass" && preflight.status !== "pass") {
    throw new Error("Deze section plan vereist preflight status 'pass' voor apply.");
  }

  const sectionHandle = plan.input.sectionHandle;
  const sectionKey = plan.themeContext.sectionKey;

  const resolvedTheme = await resolveTheme(shopifyClient, apiVersion, {
    themeId: plan.input.themeId,
    themeRole: plan.input.themeRole,
  });

  if (!plan.input.overwriteSection) {
    try {
      await getThemeFile(shopifyClient, apiVersion, {
        themeId: resolvedTheme.id,
        key: sectionKey,
      });
      throw new Error(`Section '${sectionKey}' bestaat al. Zet overwriteSection=true in prepare-section-replica.`);
    } catch (error) {
      if (error?.status !== 404) {
        throw error;
      }
    }
  }

  const sectionWrite = await upsertThemeFile(shopifyClient, apiVersion, {
    themeId: resolvedTheme.id,
    key: sectionKey,
    value: plan.compiled.sectionLiquid,
  });

  let templateUpdate = null;
  if (plan.input.addToTemplate) {
    const templateFile = await getThemeFile(shopifyClient, apiVersion, {
      themeId: resolvedTheme.id,
      key: plan.input.templateKey,
    });

    const templateJson = ensureJsonTemplateStructure(templateFile.asset?.value || "", plan.input.templateKey);
    const sectionId = pickSectionInstanceId(sectionHandle, plan.input.sectionInstanceId, templateJson);

    templateJson.sections[sectionId] = {
      type: sectionHandle,
      settings:
        plan.input.sectionSettings && typeof plan.input.sectionSettings === "object"
          ? plan.input.sectionSettings
          : {},
    };

    templateJson.order = insertSectionOrder(
      templateJson.order,
      sectionId,
      plan.input.insertPosition,
      plan.input.referenceSectionId
    );

    const templateValue = `${JSON.stringify(templateJson, null, 2)}\n`;
    const templateWrite = await upsertThemeFile(shopifyClient, apiVersion, {
      themeId: resolvedTheme.id,
      key: plan.input.templateKey,
      value: templateValue,
    });

    templateUpdate = {
      key: plan.input.templateKey,
      sectionId,
      position: plan.input.insertPosition,
      referenceSectionId: plan.input.referenceSectionId || null,
      orderLength: Array.isArray(templateJson.order) ? templateJson.order.length : null,
      checksum: templateWrite.asset?.checksum || null,
    };
  }

  const additionalWrites = [];
  for (const file of plan.compiled.additionalFiles) {
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
    additionalFiles: [],
  };

  if (parsedInput.verify) {
    const sectionRead = await getThemeFile(shopifyClient, apiVersion, {
      themeId: resolvedTheme.id,
      key: sectionKey,
    });
    verification.section = summarizeAssetRead(sectionRead.asset);

    if (plan.input.addToTemplate) {
      const templateRead = await getThemeFile(shopifyClient, apiVersion, {
        themeId: resolvedTheme.id,
        key: plan.input.templateKey,
      });
      verification.template = summarizeAssetRead(templateRead.asset);
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
    action: "applied_section_replica",
    planId: plan.planId,
    theme: {
      id: resolvedTheme.id,
      name: resolvedTheme.name,
      role: resolvedTheme.role,
    },
    section: {
      handle: sectionHandle,
      key: sectionKey,
      overwritten: plan.input.overwriteSection,
      checksum: sectionWrite.asset?.checksum || null,
      schema: plan.compiled.schemaSummary,
    },
    template: templateUpdate,
    additionalFiles: additionalWrites,
    verification,
    validation: {
      preflight: plan.validation.preflight,
      appliedWithWarnings: plan.validation.preflight.status === "warn",
    },
    previewTargets: plan.previewTargets,
    telemetry: {
      pipeline: "section-replica-v2",
      sourceTool: plan.input.sourceTool || "apply-section-replica",
      appliedAt: asIsoNow(),
      keywordContextHash: crypto.createHash("sha256").update(plan.keywordContext || "").digest("hex"),
    },
  };
};

export const getSectionReplicaPlan = (planId) => getPlan(planId);
