import { gql } from "graphql-request";
import { z } from "zod";
import { getRequestContext } from "../lib/requestContext.js";
import {
  assertAllowedThemeFilePath,
  createThemeAuditId,
  insertSectionInTemplate,
  normalizeSectionHandle,
  parseTemplateJson,
  parseThemeFileBody,
} from "../lib/themeSections.js";

const InjectSectionIntoTemplateInputSchema = z.object({
  shopDomain: z.string().min(1).describe("Target shop domain, e.g. your-store.myshopify.com"),
  themeId: z.string().min(1).describe("Shopify theme GID"),
  templatePath: z.string().min(1).describe("JSON template path, e.g. templates/product.json"),
  sectionHandle: z.string().min(1).describe("Section filename handle, e.g. hero-banner"),
  sectionId: z.string().min(1).optional().describe("Optional section key in template JSON"),
  settings: z.record(z.any()).optional().describe("Section settings object for template JSON"),
  position: z.enum(["start", "end", "before", "after"]).default("end"),
  referenceSectionId: z.string().optional(),
  liveWrite: z.boolean().default(false),
  confirm_live_write: z.boolean().optional(),
  confirmation_reason: z.string().optional(),
  change_summary: z.string().optional(),
});

const READ_TEMPLATE_QUERY = gql`
  query ReadTemplateFile($themeId: ID!, $filenames: [String!], $first: Int!) {
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
  mutation ThemeFilesUpsert($themeId: ID!, $files: [OnlineStoreThemeFilesUpsertFileInput!]!) {
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

function emitThemeAuditLog(action, input, theme, shopDomain, filepaths) {
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

const injectSectionIntoTemplate = {
  name: "inject-section-into-template",
  description:
    "Inject a section reference into a JSON template with collision checks and live-theme confirmation guard.",
  schema: InjectSectionIntoTemplateInputSchema,
  initialize(client) {
    shopifyClient = client;
  },
  execute: async (input) => {
    try {
      const templatePath = assertAllowedThemeFilePath(input.templatePath, {
        allowTemplateJson: true,
      }).normalized;
      const sectionHandle = normalizeSectionHandle(input.sectionHandle);
      const sectionKey = input.sectionId ? String(input.sectionId).trim() : sectionHandle;

      if ((input.position === "before" || input.position === "after") && !input.referenceSectionId) {
        throw new Error(`position '${input.position}' requires referenceSectionId.`);
      }

      const readData = await shopifyClient.request(READ_TEMPLATE_QUERY, {
        themeId: input.themeId,
        filenames: [templatePath],
        first: 1,
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

      const templateFile = (theme.files?.edges || []).map((edge) => edge?.node).find(Boolean);
      if (!templateFile) {
        throw new Error(`Template '${templatePath}' was not found in theme '${input.themeId}'.`);
      }

      const parsedBody = parseThemeFileBody(templateFile.body);
      if (typeof parsedBody.text !== "string") {
        throw new Error(
          `Template '${templatePath}' body is not directly readable as text (received ${parsedBody.type}).`
        );
      }

      const templateData = parseTemplateJson(parsedBody.text, templatePath);
      const injection = insertSectionInTemplate({
        templateData,
        sectionKey,
        sectionType: sectionHandle,
        position: input.position,
        referenceSectionId: input.referenceSectionId,
        settings: input.settings,
      });

      const mutationData = await shopifyClient.request(THEME_FILES_UPSERT_MUTATION, {
        themeId: input.themeId,
        files: [
          {
            filename: templatePath,
            body: {
              type: "TEXT",
              value: injection.updatedText,
            },
          },
        ],
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
        "inject-section-into-template",
        input,
        theme,
        connectedDomain || requestedDomain,
        [templatePath]
      );

      return {
        auditId: audit.auditId,
        shopDomain: connectedDomain || requestedDomain,
        theme: {
          id: theme.id,
          name: theme.name,
          role: theme.role,
        },
        template: {
          filename: templatePath,
          sizeBytes: injection.sizeBytes,
        },
        injectedSection: {
          sectionId: sectionKey,
          sectionType: sectionHandle,
          position: input.position,
          referenceSectionId: input.referenceSectionId || null,
        },
        upsertedFiles: payload.upsertedThemeFiles || [],
        job: payload.job || null,
      };
    } catch (error) {
      console.error("Error injecting section into template:", error);
      throw new Error(
        `Failed to inject section into template: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  },
};

export { injectSectionIntoTemplate };
