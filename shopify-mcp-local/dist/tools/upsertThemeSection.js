import crypto from "crypto";
import { gql } from "graphql-request";
import { z } from "zod";
import { getRequestContext } from "../lib/requestContext.js";
import { createThemeAuditId, validateThemeSectionInput } from "../lib/themeSections.js";

const UpsertThemeSectionInputSchema = z.object({
  shopDomain: z.string().min(1).describe("Target shop domain, e.g. your-store.myshopify.com"),
  themeId: z.string().min(1).describe("Shopify theme GID"),
  sectionHandle: z.string().min(1),
  liquid: z.string().min(1),
  liveWrite: z.boolean().default(false),
  confirm_live_write: z.boolean().optional(),
  confirmation_reason: z.string().optional(),
  change_summary: z.string().optional(),
});

const READ_THEME_META_QUERY = gql`
  query ReadThemeMeta($themeId: ID!) {
    shop {
      myshopifyDomain
    }
    theme(id: $themeId) {
      id
      name
      role
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

const upsertThemeSection = {
  name: "upsert-theme-section",
  description: "Create or update a Shopify section file with strict live-theme confirmation and audit logging.",
  schema: UpsertThemeSectionInputSchema,
  initialize(client) {
    shopifyClient = client;
  },
  execute: async (input) => {
    try {
      const validation = validateThemeSectionInput({
        sectionHandle: input.sectionHandle,
        liquid: input.liquid,
      });

      if (!validation.valid) {
        throw new Error(`Section validation failed: ${validation.errors.join("; ")}`);
      }

      const meta = await shopifyClient.request(READ_THEME_META_QUERY, {
        themeId: input.themeId,
      });
      const theme = meta?.theme;
      if (!theme) {
        throw new Error(`Theme '${input.themeId}' not found.`);
      }

      const connectedDomain = normalizeDomain(meta?.shop?.myshopifyDomain);
      const requestedDomain = normalizeDomain(input.shopDomain);
      if (requestedDomain && connectedDomain && requestedDomain !== connectedDomain) {
        throw new Error(
          `shopDomain mismatch: requested '${requestedDomain}', connected '${connectedDomain}'.`
        );
      }

      assertLiveThemeWriteGuard(input, theme);

      const mutationData = await shopifyClient.request(THEME_FILES_UPSERT_MUTATION, {
        themeId: input.themeId,
        files: [
          {
            filename: validation.sectionFilename,
            body: {
              type: "TEXT",
              value: input.liquid,
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

      const checksumSha256 = crypto
        .createHash("sha256")
        .update(input.liquid, "utf8")
        .digest("hex");

      const audit = emitThemeAuditLog(
        "upsert-theme-section",
        input,
        theme,
        connectedDomain || requestedDomain,
        [validation.sectionFilename]
      );

      return {
        auditId: audit.auditId,
        shopDomain: connectedDomain || requestedDomain,
        theme: {
          id: theme.id,
          name: theme.name,
          role: theme.role,
        },
        file: {
          filename: validation.sectionFilename,
          checksumSha256,
          sizeBytes: validation.sizeBytes,
        },
        validation: {
          valid: validation.valid,
          warnings: validation.warnings,
        },
        upsertedFiles: payload.upsertedThemeFiles || [],
        job: payload.job || null,
      };
    } catch (error) {
      console.error("Error upserting theme section:", error);
      throw new Error(
        `Failed to upsert theme section: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  },
};

export { upsertThemeSection };
