import { gql } from "graphql-request";
import { z } from "zod";
import { getRequestContext } from "../lib/requestContext.js";
import {
  assertAllowedSectionLibraryAssetPath,
  assertAllowedThemeFilePath,
  assertThemeFileSize,
  buildScopedSnippetFilename,
  buildSectionFilename,
  buildSectionLibraryStylesFilename,
  createThemeAuditId,
  insertSectionInTemplate,
  parseTemplateJson,
  parseThemeFileBody,
  validateThemeSectionInput,
} from "../lib/themeSections.js";

const SectionPackSnippetSchema = z.object({
  name: z.string().min(1),
  liquid: z.string().min(1),
});

const SectionPackAssetSchema = z.object({
  relativePath: z.string().min(1).describe("Relative path under assets/sections-library/<sectionId>/"),
  content: z.string().min(1),
  contentType: z.enum(["TEXT", "BASE64"]).default("TEXT"),
});

const UpsertThemeSectionPackInputSchema = z.object({
  shopDomain: z.string().min(1).describe("Target shop domain, e.g. your-store.myshopify.com"),
  themeId: z.string().min(1).describe("Shopify theme GID"),
  sectionId: z.string().min(1).describe("Section id in [a-z0-9-] format"),
  sectionLiquid: z.string().min(1),
  stylesCss: z.string().min(1),
  snippets: z.array(SectionPackSnippetSchema).optional(),
  assets: z.array(SectionPackAssetSchema).optional(),
  targetTemplate: z.string().optional().describe("Optional JSON template path for section injection"),
  sectionKey: z.string().optional().describe("Optional section key in template JSON"),
  settings: z.record(z.any()).optional(),
  position: z.enum(["start", "end", "before", "after"]).default("end"),
  referenceSectionId: z.string().optional(),
  installMode: z.boolean().default(false).describe("When true, strict preflight conflict checks are required"),
  confirm_overwrite_existing: z.boolean().optional(),
  overwrite_reason: z.string().optional(),
  liveWrite: z.boolean().default(false),
  confirm_live_write: z.boolean().optional(),
  confirmation_reason: z.string().optional(),
  change_summary: z.string().optional(),
});

const READ_THEME_FILES_QUERY = gql`
  query ReadThemeFilesForSectionPack($themeId: ID!, $filenames: [String!], $first: Int!) {
    shop {
      myshopifyDomain
    }
    theme(id: $themeId) {
      id
      name
      role
      files(first: $first, filenames: $filenames) {
        edges {
          node {
            filename
            size
            contentType
            checksumMd5
            updatedAt
            body {
              ... on OnlineStoreThemeFileBodyText {
                content
              }
              ... on OnlineStoreThemeFileBodyBase64 {
                contentBase64
              }
              ... on OnlineStoreThemeFileBodyUrl {
                url
              }
            }
          }
        }
        userErrors {
          code
          filename
        }
      }
    }
  }
`;

const THEME_FILES_UPSERT_MUTATION = gql`
  mutation ThemeFilesUpsertSectionPack($themeId: ID!, $files: [OnlineStoreThemeFilesUpsertFileInput!]!) {
    themeFilesUpsert(themeId: $themeId, files: $files) {
      upsertedThemeFiles {
        filename
      }
      job {
        id
        done
      }
      userErrors {
        field
        message
        code
        filename
      }
    }
  }
`;

let shopifyClient;

function normalizeDomain(value) {
  return String(value || "").trim().toLowerCase();
}

function assertLiveThemeWriteGuard(input, theme) {
  const isLiveTheme = String(theme?.role || "").toUpperCase() === "MAIN";
  if (!isLiveTheme) {
    return;
  }

  if (input.liveWrite !== true) {
    throw new Error(
      "Target theme is live (MAIN). Set liveWrite=true and provide explicit confirmation fields to continue."
    );
  }

  if (input.confirm_live_write !== true) {
    throw new Error("Live theme write requires confirm_live_write=true.");
  }

  const reason = String(input.confirmation_reason || "").trim();
  if (!reason) {
    throw new Error("Live theme write requires confirmation_reason.");
  }

  const summary = String(input.change_summary || "").trim();
  if (!summary) {
    throw new Error("Live theme write requires change_summary.");
  }
}

function emitThemeAuditLog(action, input, theme, shopDomain, filepaths, conflicts) {
  const context = getRequestContext();
  const auditId = createThemeAuditId();
  const payload = {
    auditId,
    timestamp: new Date().toISOString(),
    action,
    tenantId: context?.tenantId || null,
    licenseKey: context?.licenseKey || null,
    shopDomain,
    themeId: theme?.id || null,
    themeRole: theme?.role || null,
    filepaths,
    conflicts,
    installMode: input.installMode === true,
    overwrite: {
      confirmed: input.confirm_overwrite_existing === true,
      reason: input.overwrite_reason || null,
    },
    liveWrite: input.liveWrite === true,
    confirmation: {
      confirmed: input.confirm_live_write === true,
      reason: input.confirmation_reason || null,
      changeSummary: input.change_summary || null,
    },
  };
  console.info(`THEME_MUTATION_AUDIT ${JSON.stringify(payload)}`);
  return payload;
}

function buildPackPlan(input) {
  const sectionValidation = validateThemeSectionInput({
    sectionHandle: input.sectionId,
    liquid: input.sectionLiquid,
    targetTemplate: input.targetTemplate,
  });
  if (!sectionValidation.valid) {
    throw new Error(`Section validation failed: ${sectionValidation.errors.join("; ")}`);
  }

  const presets = Array.isArray(sectionValidation.schema?.presets) ? sectionValidation.schema.presets : [];
  if (presets.length === 0) {
    throw new Error("Section schema must include at least one preset in {% schema %}.");
  }

  assertThemeFileSize(input.stylesCss, "Section styles");

  const sectionFilename = buildSectionFilename(input.sectionId);
  const stylesFilename = buildSectionLibraryStylesFilename(input.sectionId);

  const snippets = (input.snippets || []).map((snippet) => {
    const filename = buildScopedSnippetFilename(input.sectionId, snippet.name);
    assertThemeFileSize(snippet.liquid, `Snippet ${snippet.name}`);
    return {
      filename,
      body: {
        type: "TEXT",
        value: snippet.liquid,
      },
      packPath: `sections-library/${sectionValidation.sectionHandle}/snippets/${snippet.name}.liquid`,
    };
  });

  const assets = (input.assets || []).map((asset) => {
    const filename = assertAllowedSectionLibraryAssetPath(input.sectionId, asset.relativePath);
    const content = String(asset.content || "");
    if (asset.contentType === "TEXT") {
      assertThemeFileSize(content, `Asset ${asset.relativePath}`);
    }
    return {
      filename,
      body: {
        type: asset.contentType,
        value: content,
      },
      packPath: `sections-library/${sectionValidation.sectionHandle}/${asset.relativePath}`,
    };
  });

  const files = [
    {
      filename: sectionFilename,
      body: {
        type: "TEXT",
        value: input.sectionLiquid,
      },
      packPath: `sections-library/${sectionValidation.sectionHandle}/section.liquid`,
    },
    {
      filename: stylesFilename,
      body: {
        type: "TEXT",
        value: input.stylesCss,
      },
      packPath: `sections-library/${sectionValidation.sectionHandle}/styles.css`,
    },
    ...snippets,
    ...assets,
  ];

  const sectionKey = input.sectionKey && String(input.sectionKey).trim()
    ? String(input.sectionKey).trim()
    : sectionValidation.sectionHandle;

  if ((input.position === "before" || input.position === "after") && !input.referenceSectionId) {
    throw new Error(`position '${input.position}' requires referenceSectionId.`);
  }

  return {
    sectionValidation,
    sectionKey,
    files,
    targetTemplate: sectionValidation.targetTemplate,
  };
}

const upsertThemeSectionPack = {
  name: "upsert-theme-section-pack",
  description:
    "Create/update a section pack (section + styles + optional snippets/assets) with conflict preflight and optional template injection.",
  schema: UpsertThemeSectionPackInputSchema,
  initialize(client) {
    shopifyClient = client;
  },
  execute: async (input) => {
    try {
      const packPlan = buildPackPlan(input);
      const plannedFilenames = packPlan.files.map((file) => file.filename);
      if (packPlan.targetTemplate) {
        plannedFilenames.push(assertAllowedThemeFilePath(packPlan.targetTemplate, { allowTemplateJson: true }).normalized);
      }

      const uniqueFilenames = Array.from(new Set(plannedFilenames));
      if (uniqueFilenames.length > 50) {
        throw new Error("Section pack exceeds Shopify themeFilesUpsert limit (max 50 files per request)");
      }

      const readData = await shopifyClient.request(READ_THEME_FILES_QUERY, {
        themeId: input.themeId,
        filenames: uniqueFilenames,
        first: uniqueFilenames.length,
      });

      const connectedDomain = normalizeDomain(readData?.shop?.myshopifyDomain);
      const requestedDomain = normalizeDomain(input.shopDomain);
      if (requestedDomain && connectedDomain && requestedDomain !== connectedDomain) {
        throw new Error(
          `shopDomain mismatch: requested '${requestedDomain}', connected '${connectedDomain}'.`
        );
      }

      const theme = readData?.theme;
      if (!theme) {
        throw new Error(`Theme '${input.themeId}' not found.`);
      }

      assertLiveThemeWriteGuard(input, theme);

      const fileUserErrors = theme.files?.userErrors || [];
      if (fileUserErrors.length > 0) {
        throw new Error(
          fileUserErrors.map((err) => `${err.code || "UNKNOWN"}:${err.filename || "unknown"}`).join(", ")
        );
      }

      const existingNodes = (theme.files?.edges || []).map((edge) => edge?.node).filter(Boolean);
      const existingByFilename = new Map(existingNodes.map((node) => [node.filename, node]));

      const writeTargets = new Set(packPlan.files.map((file) => file.filename));
      const conflicts = Array.from(writeTargets).filter((filename) => existingByFilename.has(filename));

      if (conflicts.length > 0) {
        if (input.confirm_overwrite_existing !== true) {
          throw new Error(
            `Preflight conflict detected on existing files: ${conflicts.join(", ")}. Set confirm_overwrite_existing=true with overwrite_reason to continue.`
          );
        }
        const overwriteReason = String(input.overwrite_reason || "").trim();
        if (!overwriteReason) {
          throw new Error("overwrite_reason is required when confirm_overwrite_existing=true");
        }
      }

      const filesToUpsert = [...packPlan.files];

      if (packPlan.targetTemplate) {
        const templateNode = existingByFilename.get(packPlan.targetTemplate);
        if (!templateNode) {
          throw new Error(`Template '${packPlan.targetTemplate}' was not found in theme '${input.themeId}'.`);
        }
        const parsedBody = parseThemeFileBody(templateNode.body);
        if (typeof parsedBody.text !== "string") {
          throw new Error(
            `Template '${packPlan.targetTemplate}' body is not directly readable as text (received ${parsedBody.type}).`
          );
        }

        const templateData = parseTemplateJson(parsedBody.text, packPlan.targetTemplate);
        const injection = insertSectionInTemplate({
          templateData,
          sectionKey: packPlan.sectionKey,
          sectionType: packPlan.sectionValidation.sectionHandle,
          position: input.position,
          referenceSectionId: input.referenceSectionId,
          settings: input.settings,
        });

        filesToUpsert.push({
          filename: packPlan.targetTemplate,
          body: {
            type: "TEXT",
            value: injection.updatedText,
          },
          packPath: `sections-library/${packPlan.sectionValidation.sectionHandle}/template-injection/${packPlan.targetTemplate}`,
        });
      }

      const mutationData = await shopifyClient.request(THEME_FILES_UPSERT_MUTATION, {
        themeId: input.themeId,
        files: filesToUpsert.map((file) => ({
          filename: file.filename,
          body: file.body,
        })),
      });

      const payload = mutationData?.themeFilesUpsert;
      if (!payload) {
        throw new Error("themeFilesUpsert returned empty payload");
      }

      if (Array.isArray(payload.userErrors) && payload.userErrors.length > 0) {
        throw new Error(
          payload.userErrors
            .map((err) => `${err.code || "UNKNOWN"}:${err.message}${err.filename ? ` (${err.filename})` : ""}`)
            .join(", ")
        );
      }

      const audit = emitThemeAuditLog(
        "upsert-theme-section-pack",
        input,
        theme,
        connectedDomain || requestedDomain,
        filesToUpsert.map((file) => file.filename),
        conflicts
      );

      return {
        auditId: audit.auditId,
        shopDomain: connectedDomain || requestedDomain,
        theme: {
          id: theme.id,
          name: theme.name,
          role: theme.role,
        },
        sectionPack: {
          id: packPlan.sectionValidation.sectionHandle,
          paths: filesToUpsert.map((file) => ({
            packPath: file.packPath,
            themeFilename: file.filename,
          })),
          installMode: input.installMode,
          preflightConflicts: conflicts,
          overwrittenExisting: conflicts.length > 0,
        },
        upsertedFiles: payload.upsertedThemeFiles || [],
        job: payload.job || null,
      };
    } catch (error) {
      console.error("Error upserting theme section pack:", error);
      throw new Error(
        `Failed to upsert theme section pack: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  },
};

export { upsertThemeSectionPack };
