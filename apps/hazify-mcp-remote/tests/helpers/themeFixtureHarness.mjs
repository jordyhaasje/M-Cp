import crypto from "node:crypto";

export const defaultThemeNode = {
  id: "gid://shopify/OnlineStoreTheme/123",
  name: "Fixture theme",
  role: "MAIN",
  processing: false,
  createdAt: "2026-03-10T10:00:00Z",
  updatedAt: "2026-03-11T10:00:00Z",
};

export function checksumMd5Base64(value) {
  return crypto.createHash("md5").update(Buffer.from(value, "utf8")).digest("base64");
}

export function inferFixtureContentType(key) {
  return key.endsWith(".json") ? "JSON" : "TEXT";
}

export function makeTextAsset(key, content, contentType = inferFixtureContentType(key)) {
  return {
    checksumMd5: checksumMd5Base64(content),
    contentType,
    createdAt: "2026-03-10T10:00:00Z",
    updatedAt: "2026-03-11T10:00:00Z",
    size: Buffer.byteLength(content, "utf8"),
    body: {
      content,
    },
  };
}

function patternMatches(filename, pattern) {
  if (!pattern.includes("*")) {
    return filename === pattern;
  }
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`).test(filename);
}

function decodeUpsertBody(fileBody = {}) {
  if (fileBody.type === "BASE64" && typeof fileBody.value === "string") {
    return Buffer.from(fileBody.value, "base64").toString("utf8");
  }
  return String(fileBody.value || "");
}

export function createThemeFixtureFetch(initialFiles, themeOverrides = {}) {
  const themeNode = {
    ...defaultThemeNode,
    ...themeOverrides,
    id:
      typeof themeOverrides.id === "string" && themeOverrides.id
        ? themeOverrides.id
        : `gid://shopify/OnlineStoreTheme/${themeOverrides.themeId || 123}`,
  };
  const themeNumericId =
    Number.parseInt(String(themeNode.id).match(/(\d+)$/)?.[1] || "123", 10) || 123;
  const files = new Map(
    Object.entries(initialFiles).map(([key, content]) => [
      key,
      makeTextAsset(key, String(content)),
    ])
  );

  const handler = async (_url, init = {}) => {
    const payload = JSON.parse(init.body || "{}");
    const query = String(payload.query || "");
    const variables = payload.variables || {};

    if (query.includes("query ThemeById")) {
      return new Response(
        JSON.stringify({
          data: {
            theme: themeNode,
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }

    if (query.includes("query ThemeList")) {
      return new Response(
        JSON.stringify({
          data: {
            themes: {
              nodes: [themeNode],
            },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }

    if (
      query.includes("ThemeFilesByIdWithContent") ||
      query.includes("ThemeFilesByIdMetadata") ||
      query.includes("ThemeFileById")
    ) {
      const filenames = Array.isArray(variables.filenames) ? variables.filenames : [];
      const first = Number(variables.first || filenames.length || 50);
      const includeContent =
        query.includes("ThemeFilesByIdWithContent") || query.includes("ThemeFileById");
      const matched = Array.from(files.entries())
        .filter(([filename]) => filenames.some((pattern) => patternMatches(filename, pattern)))
        .slice(0, first)
        .map(([filename, file]) => ({
          filename,
          checksumMd5: file.checksumMd5,
          contentType: file.contentType,
          createdAt: file.createdAt,
          updatedAt: file.updatedAt,
          size: file.size,
          ...(includeContent ? { body: { content: file.body.content } } : {}),
        }));

      return new Response(
        JSON.stringify({
          data: {
            theme: {
              ...themeNode,
              files: {
                nodes: matched,
                userErrors: [],
              },
            },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }

    if (query.includes("mutation ThemeFilesUpsert")) {
      const payloadFiles = Array.isArray(variables.files) ? variables.files : [];
      for (const file of payloadFiles) {
        const key = String(file?.filename || "").trim();
        if (!key) {
          continue;
        }
        const content = decodeUpsertBody(file?.body || {});
        files.set(key, makeTextAsset(key, content));
      }

      return new Response(
        JSON.stringify({
          data: {
            themeFilesUpsert: {
              upsertedThemeFiles: payloadFiles
                .map((file) => String(file?.filename || "").trim())
                .filter(Boolean)
                .map((filename) => ({ filename })),
              job: {
                id: "gid://shopify/Job/fixture-upsert",
              },
              userErrors: [],
            },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }

    if (query.includes("mutation ThemeFilesDelete")) {
      const deleteKeys = Array.isArray(variables.files) ? variables.files : [];
      for (const key of deleteKeys) {
        files.delete(String(key));
      }

      return new Response(
        JSON.stringify({
          data: {
            themeFilesDelete: {
              deletedThemeFiles: deleteKeys.map((filename) => ({ filename })),
              userErrors: [],
            },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }

    throw new Error(`Unexpected GraphQL query in theme fixture harness: ${query.slice(0, 100)}`);
  };

  return {
    themeNode: {
      ...themeNode,
      themeId: themeNumericId,
    },
    handler,
    getFileValue(key) {
      return files.get(key)?.body?.content || null;
    },
    hasFile(key) {
      return files.has(key);
    },
    listKeys() {
      return Array.from(files.keys()).sort();
    },
  };
}
