import { z } from "zod";
import { requireShopifyClient } from "./_context.js";
import { getThemeFiles } from "../lib/themeFiles.js";
import {
  getThemeEditMemory,
  rememberThemeRead,
  themeTargetsCompatible,
} from "../lib/themeEditMemory.js";

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
    themeId: rawInput.themeId,
    themeRole: rawInput.themeRole ?? rawInput.role,
    keys: rawInput.keys ?? rawInput.filenames,
    includeContent: rawInput.includeContent,
  };
};

const GetThemeFilesPublicObjectSchema = z
  .object({
    themeId: z.coerce.number().int().positive().optional().describe("Optional explicit Shopify theme ID"),
    themeRole: ThemeRoleSchema
      .optional()
      .describe("Optionele theme role. Geef deze in editflows expliciet mee zodat je read-context overeenkomt met plan-theme-edit en je write-call."),
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
    })
    .superRefine((input, ctx) => {
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
    "Read EXACT files from a Shopify theme. GEEN GLOBBING. Geef in editflows bij voorkeur altijd expliciet themeId of themeRole mee zodat je read-context overeenkomt met plan-theme-edit en je write-call. Alleen voor backwards compatibility valt deze read-tool terug op main als themeId/themeRole ontbreekt; dat levert dan ook een warning op. Gebruik altijd search-theme-files als je niet 100% zeker bent van de file path. Gebruik dit bij voorkeur na plan-theme-edit, zodat je alleen de exact voorgestelde files leest. Wanneer een planner-read content nodig heeft en includeContent ontbreekt, zet deze tool dat nu automatisch op true met een warning.",
  inputSchema: GetThemeFilesPublicObjectSchema,
  schema: GetThemeFilesInputSchema,
  execute: async (input, context = {}) => {
    const shopifyClient = requireShopifyClient(context);
    const usedMainFallback = !input.themeId && !input.themeRole;
    const effectiveThemeRole = input.themeId ? undefined : input.themeRole || "main";
    const themeEditState = getThemeEditMemory(context);
    const plannedReadKeys = Array.isArray(themeEditState?.lastPlan?.nextReadKeys)
      ? themeEditState.lastPlan.nextReadKeys.filter(Boolean)
      : [];
    const shouldAutoIncludeContent =
      input.includeContent === undefined &&
      plannedReadKeys.length > 0 &&
      themeTargetsCompatible(themeEditState?.themeTarget, {
        themeId: input.themeId,
        themeRole: input.themeRole,
      }) &&
      input.keys.every((key) => plannedReadKeys.includes(key));
    const includeContent = shouldAutoIncludeContent
      ? true
      : input.includeContent === undefined
        ? false
        : input.includeContent;
    try {
      const result = await getThemeFiles(shopifyClient, API_VERSION, {
        themeId: input.themeId,
        themeRole: effectiveThemeRole,
        keys: input.keys,
        includeContent,
      });

      rememberThemeRead(context, {
        themeId: result.theme.id,
        themeRole: result.theme.role?.toLowerCase?.() || input.themeRole || effectiveThemeRole,
        files: (result.files || []).map((file) => ({
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
      const missingKeys = (result.files || [])
        .filter((file) => file?.missing === true || file?.found === false)
        .map((file) => String(file.key || "").trim())
        .filter(Boolean);
      if (usedMainFallback) {
        warnings.push(
          "⚠️ themeId/themeRole ontbrak; deze read-call viel voor backwards compatibility terug op het LIVE main theme."
        );
      }
      if (shouldAutoIncludeContent) {
        warnings.push(
          "Planner-required read gedetecteerd: includeContent is automatisch op true gezet zodat de volgende write-flow genoeg echte filecontext heeft."
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
        files: result.files,
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
