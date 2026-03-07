import { gql } from "graphql-request";
import { z } from "zod";
import { assertAllowedThemeFilePath, parseThemeFileBody } from "../lib/themeSections.js";

const ReadThemeFilesInputSchema = z.object({
  shopDomain: z.string().min(1).describe("Target shop domain, e.g. your-store.myshopify.com"),
  themeId: z.string().min(1).describe("Shopify theme GID, e.g. gid://shopify/OnlineStoreTheme/123"),
  filenames: z.array(z.string().min(1)).min(1).max(50),
});

const READ_THEME_FILES_QUERY = gql`
  query ReadThemeFiles($themeId: ID!, $filenames: [String!], $first: Int!) {
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

let shopifyClient;

function normalizeDomain(value) {
  return String(value || "").trim().toLowerCase();
}

const readThemeFiles = {
  name: "read-theme-files",
  description: "Read selected Shopify theme files for section/template context and verification.",
  schema: ReadThemeFilesInputSchema,
  initialize(client) {
    shopifyClient = client;
  },
  execute: async (input) => {
    try {
      const requestedFiles = input.filenames.map((filename) =>
        assertAllowedThemeFilePath(filename, { allowTemplateJson: true }).normalized
      );
      const data = await shopifyClient.request(READ_THEME_FILES_QUERY, {
        themeId: input.themeId,
        filenames: requestedFiles,
        first: Math.min(Math.max(requestedFiles.length, 1), 50),
      });

      const connectedDomain = normalizeDomain(data?.shop?.myshopifyDomain);
      const requestedDomain = normalizeDomain(input.shopDomain);
      if (requestedDomain && connectedDomain && requestedDomain !== connectedDomain) {
        throw new Error(
          `shopDomain mismatch: requested '${requestedDomain}', connected '${connectedDomain}'.`
        );
      }

      const theme = data?.theme;
      if (!theme) {
        throw new Error(`Theme '${input.themeId}' not found.`);
      }

      const fileUserErrors = theme.files?.userErrors || [];
      if (fileUserErrors.length > 0) {
        throw new Error(
          fileUserErrors.map((err) => `${err.code || "UNKNOWN"}:${err.filename || "unknown"}`).join(", ")
        );
      }

      const files = (theme.files?.edges || [])
        .map((edge) => edge?.node)
        .filter(Boolean)
        .map((file) => {
          const body = parseThemeFileBody(file.body);
          return {
            filename: file.filename,
            contentType: file.contentType,
            size: file.size,
            checksumMd5: file.checksumMd5,
            updatedAt: file.updatedAt,
            body,
          };
        });

      return {
        shopDomain: connectedDomain || requestedDomain,
        theme: {
          id: theme.id,
          name: theme.name,
          role: theme.role,
        },
        files,
        requested: {
          filenames: requestedFiles,
          requestedCount: requestedFiles.length,
          returnedCount: files.length,
        },
      };
    } catch (error) {
      console.error("Error reading theme files:", error);
      throw new Error(
        `Failed to read theme files: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  },
};

export { readThemeFiles };
