import { z } from "zod";
import { requireShopifyClient } from "./_context.js";
import { getThemeFiles } from "../lib/themeFiles.js";
import {
  rememberThemeRead,
  shouldAutoIncludePlannerReadContent,
} from "../lib/themeEditMemory.js";
import {
  buildExplicitThemeTargetRequiredResponse,
  resolveThemeTargetFromInputOrMemory,
} from "./_themeTargeting.js";

const API_VERSION = process.env.SHOPIFY_API_VERSION || "2026-01";
const ThemeRoleSchema = z.enum(["main", "unpublished", "demo", "development"]);

const buildNormalizedBatchKeys = (input = {}) => {
  const source = Array.isArray(input.keys)
    ? input.keys
    : Array.isArray(input.filenames)
      ? input.filenames
      : [];
  return source.map((key) => String(key).trim()).filter(Boolean);
};

const normalizeGetThemeFilesInput = (rawInput) => {
  if (!rawInput || typeof rawInput !== "object" || Array.isArray(rawInput)) {
    return rawInput;
  }

  return {
    themeId: rawInput.themeId ?? rawInput.theme_id,
    themeRole:
      rawInput.themeRole ?? rawInput.theme_role ?? rawInput.role,
    keys: rawInput.keys ?? rawInput.filenames,
    includeContent:
      rawInput.includeContent ?? rawInput.include_content,
    limit: rawInput.limit,
  };
};

const GetThemeFilesPublicObjectSchema = z
  .object({
    themeId: z.coerce.number().int().positive().optional().describe("Optional explicit Shopify theme ID"),
    theme_id: z.coerce.number().int().positive().optional().describe("Compat alias van themeId voor generieke wrappers."),
    themeRole: ThemeRoleSchema
      .optional()
      .describe("Expliciete theme role. Vereist tenzij dezelfde flow al eerder expliciet een theme target bevestigde."),
    theme_role: ThemeRoleSchema
      .optional()
      .describe("Compat alias van themeRole voor generieke wrappers."),
    role: ThemeRoleSchema
      .optional()
      .describe("Compat alias van themeRole voor generieke clients."),
    keys: z
      .array(z.string().min(1))
      .min(1)
      .max(10)
      .optional()
      .describe("EXACTE file paths, bijvoorbeeld ['sections/hero.liquid']. GEEN GLOBBING OF WILDCARDS (*)."),
    filenames: z
      .array(z.string().min(1))
      .min(1)
      .max(10)
      .optional()
      .describe("Compat alias van keys voor generieke clients die filenames gebruiken."),
    includeContent: z
      .boolean()
      .optional()
      .describe("Include file content (value/attachment) in response. Laat dit voor planner-required reads bij voorkeur op true of leeg."),
    include_content: z
      .boolean()
      .optional()
      .describe("Compat alias van includeContent voor generieke wrappers."),
  })
  .strict();

const GetThemeFilesInputSchema = z.preprocess(
  normalizeGetThemeFilesInput,
  z
    .object({
      themeId: z.coerce.number().int().positive().optional(),
      themeRole: ThemeRoleSchema.optional(),
      keys: z.array(z.string().min(1)).min(1).max(10),
      includeContent: z.boolean().optional(),
      limit: z.number().int().positive().optional(),
    })
    .superRefine((input, ctx) => {
      if (input.themeId && input.themeRole) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["themeId"],
          message: "Gebruik themeId of themeRole, niet allebei tegelijk.",
        });
      }

      if (input.limit !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["limit"],
          message:
            "get-theme-files ondersteunt geen limit. Gebruik exact keys[] met maximaal 10 bestanden, of gebruik search-theme-files voor zoeken.",
        });
      }

      const normalized = input.keys.map((key) => String(key).trim());
      if (new Set(normalized).size !== normalized.length) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["keys"],
          message: "Duplicate keys are not allowed.",
        });
      }

      const wildcardKey = normalized.find((key) => /[*?]/.test(key));
      if (wildcardKey) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["keys"],
          message: `Gebruik alleen exacte keys. Wildcards zoals '${wildcardKey}' horen bij search-theme-files, niet bij get-theme-files.`,
        });
      }
    })
);

const getThemeFilesTool = {
  name: "get-theme-files",
  title: "Get Theme Files",
  description:
    "Read EXACT files from a Shopify theme. GEEN GLOBBING. Geef in editflows expliciet themeId of themeRole mee zodat je read-context overeenkomt met plan-theme-edit en je write-call. Als dezelfde flow al eerder een theme target bevestigde, mag die sticky worden hergebruikt; anders blokkeert deze tool met een repair response. Gebruik altijd search-theme-files als je niet 100% zeker bent van de file path. Gebruik dit bij voorkeur na plan-theme-edit, zodat je alleen de exact voorgestelde files leest. Wanneer includeContent ontbreekt blijft deze tool metadata-first, behalve wanneer de gevraagde keys exact overeenkomen met de planner nextReadKeys; dan wordt content automatisch gehydrateerd met een warning.",
  inputSchema: GetThemeFilesPublicObjectSchema,
  schema: GetThemeFilesInputSchema,
  execute: async (rawInput, context = {}) => {
    const normalizedParse = GetThemeFilesInputSchema.safeParse(rawInput);
    if (!normalizedParse.success) {
      throw new Error(normalizedParse.error.issues.map((issue) => issue.message).join(" | "));
    }
    const input = normalizedParse.data;
    const shopifyClient = requireShopifyClient(context);
    const resolvedThemeTarget = resolveThemeTargetFromInputOrMemory(input, context);
    if (!resolvedThemeTarget) {
      return buildExplicitThemeTargetRequiredResponse({
        toolName: "get-theme-files",
        normalizedArgs: {
          keys: input.keys,
          includeContent: input.includeContent,
        },
        nextArgsTemplate: {
          keys: input.keys,
          includeContent: input.includeContent,
        },
      });
    }
    const shouldAutoIncludeContent =
      input.includeContent === undefined &&
      shouldAutoIncludePlannerReadContent(context, {
        keys: input.keys,
        themeId: resolvedThemeTarget.themeId ?? undefined,
        themeRole: resolvedThemeTarget.themeRole ?? undefined,
        requireExactMatch: true,
      });
    const includeContent = shouldAutoIncludeContent
      ? true
      : input.includeContent === undefined
        ? false
        : input.includeContent;
    try {
      const result = await getThemeFiles(shopifyClient, API_VERSION, {
        themeId: resolvedThemeTarget.themeId ?? undefined,
        themeRole: resolvedThemeTarget.themeId ? undefined : resolvedThemeTarget.themeRole,
        keys: input.keys,
        includeContent,
      });
      const files = (result.files || []).map((file) => {
        if (includeContent) {
          return file;
        }
        const sanitized = { ...file };
        delete sanitized.value;
        delete sanitized.attachment;
        delete sanitized.url;
        return sanitized;
      });

      rememberThemeRead(context, {
        themeId: result.theme.id,
        themeRole:
          result.theme.role?.toLowerCase?.() ||
          resolvedThemeTarget.themeRole ||
          undefined,
        files: files.map((file) => ({
          key: file.key,
          checksumMd5: file.checksumMd5 || file.checksum || null,
          found:
            file?.found === false || file?.missing === true
              ? false
              : file?.found === true
                ? true
                : undefined,
          hasContent: includeContent === true,
          value: includeContent === true ? file.value : undefined,
          attachment: includeContent === true ? file.attachment : undefined,
        })),
      });

      const warnings = [];
      const missingKeys = files
        .filter((file) => file?.missing === true || file?.found === false)
        .map((file) => String(file.key || "").trim())
        .filter(Boolean);
      warnings.push(...(resolvedThemeTarget.warnings || []));
      if (shouldAutoIncludeContent) {
        warnings.push(
          "Planner-required batch-read gedetecteerd: includeContent is automatisch op true gezet omdat deze keys exact overeenkomen met de planner nextReadKeys."
        );
      }
      if (missingKeys.length > 0) {
        warnings.push(
          `Niet alle gevraagde files bestaan in dit theme: ${missingKeys.join(", ")}. Deze missende paths tellen niet als geldige content-reads voor vervolg-writes.`
        );
      }

      return {
        theme: {
          id: result.theme.id,
          name: result.theme.name,
          role: result.theme.role,
        },
        files,
        ...(missingKeys.length > 0 ? { missingKeys } : {}),
        ...(warnings.length > 0 ? { warnings } : {}),
      };
    } catch (error) {
      console.error("Error reading theme files:", error);
      throw new Error(`Failed to read theme files: ${error instanceof Error ? error.message : String(error)}`);
    }
  },
};

export { getThemeFilesTool };
