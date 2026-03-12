import path from "node:path";
import {
  deleteThemeFile,
  getThemeFile,
  resolveTheme,
  upsertThemeFile,
} from "../../lib/themeFiles.js";
import { createIssue } from "../error-model.js";

const normalizeTemplateSectionId = (rawId) =>
  String(rawId || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "");

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

const summarizeAssetRead = (asset) => ({
  key: asset?.key || null,
  checksum: asset?.checksum || null,
  valueBytes: typeof asset?.value === "string" ? Buffer.byteLength(asset.value, "utf8") : null,
  hasAttachment: Boolean(asset?.attachment),
  attachmentLength: typeof asset?.attachment === "string" ? asset.attachment.length : null,
});

const deriveTemplateRenderPath = (templateKey) => {
  const normalized = String(templateKey || "").trim().toLowerCase();

  if (normalized === "templates/index.json" || normalized === "templates/index.liquid") {
    return "/";
  }
  if (normalized === "templates/cart.json" || normalized === "templates/cart.liquid") {
    return "/cart";
  }
  if (normalized === "templates/search.json" || normalized === "templates/search.liquid") {
    return "/search";
  }
  if (normalized === "templates/404.json" || normalized === "templates/404.liquid") {
    return "/404";
  }

  return null;
};

const getStorefrontDomainFromClient = (shopifyClient) => {
  const rawUrl = shopifyClient?.url;
  if (!rawUrl || typeof rawUrl !== "string") {
    throw new Error("Shopify client URL ontbreekt; kan storefront render URL niet bepalen.");
  }

  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch (_error) {
    throw new Error("Shopify client URL is ongeldig; kan storefront render URL niet bepalen.");
  }

  const domain = String(parsed.hostname || "").trim().toLowerCase();
  if (!domain || !domain.endsWith(".myshopify.com")) {
    throw new Error(`Shopify storefront domein '${domain}' is ongeldig voor section render verificatie.`);
  }

  return domain;
};

const renderThemeSectionInStorefront = async ({ shopifyClient, theme, pathName = "/", sectionId }) => {
  const domain = getStorefrontDomainFromClient(shopifyClient);
  const normalizedSectionId = String(sectionId || "").trim();
  const normalizedPath = String(pathName || "/").trim() || "/";
  const themeRole = String(theme?.role || "").trim().toLowerCase();

  if (!normalizedSectionId) {
    return {
      status: "warn",
      skipped: true,
      reason: "section_id_missing",
      httpStatus: null,
      path: normalizedPath,
      sectionId: null,
    };
  }

  if (themeRole !== "main") {
    return {
      status: "warn",
      skipped: true,
      reason: "non_main_theme",
      httpStatus: null,
      path: normalizedPath,
      sectionId: normalizedSectionId,
    };
  }

  const url = new URL(`https://${domain}${normalizedPath.startsWith("/") ? normalizedPath : `/${normalizedPath}`}`);
  url.searchParams.set("section_id", normalizedSectionId);

  const response = await fetch(url, {
    method: "GET",
    headers: {
      accept: "text/html",
    },
  });

  const html = await response.text();
  const trimmedHtml = String(html || "").trim();
  const hasLiquidError = /liquid(?:\s+syntax)?\s+error/i.test(trimmedHtml);
  const status = response.ok && trimmedHtml && !hasLiquidError ? "pass" : "fail";

  return {
    status,
    skipped: false,
    httpStatus: response.status,
    path: normalizedPath,
    sectionId: normalizedSectionId,
    hasLiquidError,
    preview: trimmedHtml.slice(0, 240),
  };
};

const readExistingThemeFileIfPresent = async ({ shopifyClient, apiVersion, themeId, key }) => {
  try {
    return await getThemeFile(shopifyClient, apiVersion, { themeId, key });
  } catch (error) {
    if (Number(error?.status || 0) === 404 || /bestaat niet/i.test(String(error?.message || ""))) {
      return null;
    }
    throw error;
  }
};

const restoreThemeFileSnapshot = async ({ shopifyClient, apiVersion, themeId, key, snapshot }) => {
  try {
    if (snapshot?.asset) {
      await upsertThemeFile(shopifyClient, apiVersion, {
        themeId,
        key,
        value: snapshot.asset.value,
        attachment: snapshot.asset.attachment,
      });
      return { key, action: "restore", status: "pass" };
    }

    await deleteThemeFile(shopifyClient, apiVersion, { themeId, key });
    return { key, action: "delete", status: "pass" };
  } catch (error) {
    if (!snapshot?.asset && Number(error?.status || 0) === 404) {
      return { key, action: "delete", status: "pass" };
    }
    return {
      key,
      action: snapshot?.asset ? "restore" : "delete",
      status: "fail",
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

export class ThemeImportAdapter {
  constructor({ apiVersion = process.env.SHOPIFY_API_VERSION || "2026-01" } = {}) {
    this.apiVersion = apiVersion;
  }

  async resolveThemeTarget({ shopifyClient, themeId, themeRole = "main" }) {
    const theme = await resolveTheme(shopifyClient, this.apiVersion, { themeId, themeRole });
    const normalizedRole = String(themeRole || "").trim().toLowerCase();
    const resolutionSource = themeId
      ? "themeId"
      : normalizedRole && normalizedRole !== "main"
        ? "themeRole"
        : "default-live";
    return {
      ...theme,
      resolutionSource,
    };
  }

  async applyBundle({ shopifyClient, bundle, themeTarget, importOptions }) {
    const files = Array.isArray(bundle?.files) ? bundle.files : [];
    const sectionFile = files.find(
      (entry) => String(entry?.path || "").startsWith("sections/") && String(entry?.path || "").endsWith(".liquid")
    );

    if (!sectionFile) {
      throw new Error("Bundle bevat geen sections/*.liquid bestand.");
    }

    const sectionKey = sectionFile.path;
    const sectionHandle = path.basename(sectionKey, ".liquid");
    const resolvedTheme = await this.resolveThemeTarget({
      shopifyClient,
      themeId: themeTarget?.themeId,
      themeRole: themeTarget?.themeRole,
    });

    const existingSection = await readExistingThemeFileIfPresent({
      shopifyClient,
      apiVersion: this.apiVersion,
      themeId: resolvedTheme.id,
      key: sectionKey,
    });

    if (existingSection && !importOptions?.overwriteSection) {
      throw new Error(`Section '${sectionKey}' bestaat al. Zet overwriteSection=true.`);
    }

    const snapshots = {
      section: existingSection,
      template: null,
      additional: [],
    };

    const sectionWrite = await upsertThemeFile(shopifyClient, this.apiVersion, {
      themeId: resolvedTheme.id,
      key: sectionKey,
      value: sectionFile.content,
    });

    const templateKey = importOptions?.templateKey || bundle?.suggestedTemplateKey || "templates/index.json";
    let templateUpdate = null;

    if (templateKey) {
      const templateFile = await getThemeFile(shopifyClient, this.apiVersion, {
        themeId: resolvedTheme.id,
        key: templateKey,
      });
      snapshots.template = templateFile;

      const templateJson = ensureJsonTemplateStructure(templateFile.asset?.value || "", templateKey);
      const sectionId = pickSectionInstanceId(sectionHandle, importOptions?.sectionInstanceId, templateJson);
      templateJson.sections[sectionId] = {
        type: sectionHandle,
        settings:
          importOptions?.sectionSettings && typeof importOptions.sectionSettings === "object"
            ? importOptions.sectionSettings
            : {},
      };
      templateJson.order = insertSectionOrder(
        templateJson.order,
        sectionId,
        importOptions?.insertPosition || "end",
        importOptions?.referenceSectionId
      );

      const templateValue = `${JSON.stringify(templateJson, null, 2)}\n`;
      const templateWrite = await upsertThemeFile(shopifyClient, this.apiVersion, {
        themeId: resolvedTheme.id,
        key: templateKey,
        value: templateValue,
      });

      templateUpdate = {
        key: templateKey,
        sectionId,
        checksum: templateWrite.asset?.checksum || null,
      };
    }

    const additionalWrites = [];
    for (const file of files) {
      if (file === sectionFile || file.path === sectionKey || file.path === templateKey) {
        continue;
      }

      const existing = await readExistingThemeFileIfPresent({
        shopifyClient,
        apiVersion: this.apiVersion,
        themeId: resolvedTheme.id,
        key: file.path,
      });
      snapshots.additional.push({ key: file.path, snapshot: existing });

      const writeResult = await upsertThemeFile(shopifyClient, this.apiVersion, {
        themeId: resolvedTheme.id,
        key: file.path,
        value: file.content,
        attachment: file.attachment,
      });

      additionalWrites.push({
        key: file.path,
        checksum: writeResult.asset?.checksum || null,
      });
    }

    return {
      resolvedTheme,
      sectionHandle,
      writes: {
        section: {
          key: sectionKey,
          checksum: sectionWrite.asset?.checksum || null,
        },
        template: templateUpdate,
        additionalFiles: additionalWrites,
      },
      snapshots,
    };
  }

  async verifyImport({ shopifyClient, resolvedTheme, sectionHandle, writes, importOptions }) {
    const issues = [];
    const readback = {
      status: "pass",
      issues: [],
    };
    const templateInstall = {
      status: "pass",
      issues: [],
    };

    const sectionRead = await getThemeFile(shopifyClient, this.apiVersion, {
      themeId: resolvedTheme.id,
      key: writes.section.key,
    });

    if (!sectionRead?.asset?.value && !sectionRead?.asset?.attachment) {
      readback.status = "fail";
      readback.issues.push(
        createIssue({
          code: "import_readback_failed",
          stage: "import",
          severity: "error",
          blocking: true,
          source: "shopify-admin",
          message: `Section '${writes.section.key}' kon niet worden teruggelezen.`,
        })
      );
    }

    if (writes.template?.key && writes.template?.sectionId) {
      const templateRead = await getThemeFile(shopifyClient, this.apiVersion, {
        themeId: resolvedTheme.id,
        key: writes.template.key,
      });

      try {
        const templateJson = ensureJsonTemplateStructure(templateRead.asset?.value || "", writes.template.key);
        if (!templateJson.sections?.[writes.template.sectionId]) {
          templateInstall.status = "fail";
          templateInstall.issues.push(
            createIssue({
              code: "template_insert_invalid",
              stage: "import",
              severity: "error",
              blocking: true,
              source: "shopify-admin",
              message: `Template '${writes.template.key}' mist section '${writes.template.sectionId}' na import.`,
            })
          );
        }
        if (!Array.isArray(templateJson.order) || !templateJson.order.includes(writes.template.sectionId)) {
          templateInstall.status = "fail";
          templateInstall.issues.push(
            createIssue({
              code: "template_insert_invalid",
              stage: "import",
              severity: "error",
              blocking: true,
              source: "shopify-admin",
              message: `Template '${writes.template.key}' bevat section '${writes.template.sectionId}' niet in order-array.`,
            })
          );
        }
      } catch (error) {
        templateInstall.status = "fail";
        templateInstall.issues.push(
          createIssue({
            code: "template_insert_invalid",
            stage: "import",
            severity: "error",
            blocking: true,
            source: "shopify-admin",
            message: error instanceof Error ? error.message : String(error),
          })
        );
      }
    }

    const renderIssues = [];
    let themeRender = {
      status: "warn",
      issues: [
        createIssue({
          code: "theme_context_render_failed",
          stage: "import",
          severity: "warn",
          blocking: false,
          source: "shopify-admin",
          message: "Theme render verificatie is overgeslagen.",
        }),
      ],
    };

    if (importOptions?.verify) {
      const staticRender = await renderThemeSectionInStorefront({
        shopifyClient,
        theme: resolvedTheme,
        pathName: "/",
        sectionId: sectionHandle,
      });

      let templateRender = null;
      if (writes.template?.sectionId) {
        const renderPath = deriveTemplateRenderPath(writes.template.key);
        if (renderPath) {
          templateRender = await renderThemeSectionInStorefront({
            shopifyClient,
            theme: resolvedTheme,
            pathName: renderPath,
            sectionId: writes.template.sectionId,
          });
        } else {
          renderIssues.push(
            createIssue({
              code: "theme_context_render_failed",
              stage: "import",
              severity: "warn",
              blocking: false,
              source: "shopify-admin",
              message: `Template '${writes.template.key}' heeft geen veilige route mapping voor render-verificatie.`,
            })
          );
        }
      }

      if (staticRender.status === "fail") {
        renderIssues.push(
          createIssue({
            code: "theme_context_render_failed",
            stage: "import",
            severity: "error",
            blocking: true,
            source: "shopify-admin",
            message: `Section render faalde op '/' (HTTP ${staticRender.httpStatus || "?"}).`,
          })
        );
      } else if (staticRender.status === "warn") {
        renderIssues.push(
          createIssue({
            code: "theme_context_render_failed",
            stage: "import",
            severity: "warn",
            blocking: false,
            source: "shopify-admin",
            message: `Static render-check overgeslagen: ${staticRender.reason}.`,
          })
        );
      }

      if (templateRender?.status === "fail") {
        renderIssues.push(
          createIssue({
            code: "theme_context_render_failed",
            stage: "import",
            severity: "error",
            blocking: true,
            source: "shopify-admin",
            message: `Template render faalde op '${templateRender.path}' (HTTP ${templateRender.httpStatus || "?"}).`,
          })
        );
      } else if (templateRender?.status === "warn") {
        renderIssues.push(
          createIssue({
            code: "theme_context_render_failed",
            stage: "import",
            severity: "warn",
            blocking: false,
            source: "shopify-admin",
            message: `Template render-check overgeslagen: ${templateRender.reason}.`,
          })
        );
      }

      const hasError = renderIssues.some((entry) => entry.severity === "error");
      themeRender = {
        status: hasError ? "fail" : renderIssues.length ? "warn" : "pass",
        staticSection: staticRender,
        templateInstance: templateRender,
        issues: renderIssues,
      };
    }

    issues.push(...readback.issues, ...templateInstall.issues, ...themeRender.issues);

    return {
      status: issues.some((entry) => entry.severity === "error") ? "fail" : "pass",
      readback: {
        ...readback,
        section: summarizeAssetRead(sectionRead.asset),
      },
      templateInstall,
      themeRender,
      issues,
    };
  }

  async rollback({ shopifyClient, resolvedTheme, snapshots, writes }) {
    const results = [];

    if (writes?.section?.key) {
      results.push(
        await restoreThemeFileSnapshot({
          shopifyClient,
          apiVersion: this.apiVersion,
          themeId: resolvedTheme.id,
          key: writes.section.key,
          snapshot: snapshots.section,
        })
      );
    }

    if (writes?.template?.key) {
      results.push(
        await restoreThemeFileSnapshot({
          shopifyClient,
          apiVersion: this.apiVersion,
          themeId: resolvedTheme.id,
          key: writes.template.key,
          snapshot: snapshots.template,
        })
      );
    }

    for (const snapshot of snapshots?.additional || []) {
      results.push(
        await restoreThemeFileSnapshot({
          shopifyClient,
          apiVersion: this.apiVersion,
          themeId: resolvedTheme.id,
          key: snapshot.key,
          snapshot: snapshot.snapshot,
        })
      );
    }

    return {
      attempted: true,
      status: results.every((entry) => entry.status === "pass") ? "pass" : "fail",
      results,
    };
  }
}
