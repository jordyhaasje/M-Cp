import { z } from "zod";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { check } from "@shopify/theme-check-node";
import { getDbPool } from "../lib/db.js";
import { requireShopifyClient } from "./_context.js";
import { getShopDomainFromClient, upsertThemeFiles } from "../lib/themeFiles.js";

export const toolName = "draft-theme-artifact";
export const description = `DIT IS DE ENIGE TOOL OM THEME FILES AAN TE MAKEN OF TE UPDATEN. Scaffoldt en lints code wijzigingen lokaal via een virtuele gatekeeper. Naast een strenge theme-check-node security pass worden bestanden veilig in PostgreSQL gelogd, waarna ze (bij 100% goedkeuring) weggeschreven worden naar de live winkel (of op te snorren preview thema's).

⚠️ EXTREMELY CRITICAL STRICT CODE GENERATION RULES ⚠️
Rule 1 (UI/UX): Code MUST represent modern, premium Shopify 2.0 UI. NEVER use visible native scrollbars (::-webkit-scrollbar { display: none; }). Use modern CSS (scroll-snap-type, display: grid, gap, aspect-ratio).
Rule 2 (Dynamic Schema): NEVER hardcode texts, colors, or image URLs in the HTML. EVERY visual element MUST be bound to a setting in the {% schema %} (using color_picker, image_picker, text, richtext, range for padding/margins).
Rule 3 (Blocks): Sliders, grids, and galleries MUST use the blocks architecture so merchants can add/remove items in the editor.
Rule 4 (Presets): Every section MUST have a complete presets array with default blocks so it appears in the Theme Editor.
Rule 5 (Mobile First): Always include responsive CSS (media queries) so the layout adapts flawlessly to mobile.`;

export const inputSchema = z.object({
  files: z.array(
    z.object({
      key: z.string().describe("De exacte filelocatie (bijv. sections/feature-sandbox.liquid)"),
      value: z.string().describe("De volledige inhoud / broncode voor deze sandbox preview. Strict Enforcement: Payload will fail if not Shopify OS 2.0 compliant. 1. Must use scoped CSS (#shopify-section-{{ section.id }}). 2. Must use 'image_tag' liquid filters for images. 3. Schema must contain comprehensive settings (Colors, Layout ranges) and a valid 'presets' array for Theme Editor visibility. Strict Building Inspection Active: Your code payload WILL BE REJECTED if it does not explicitly contain @media queries (for mobile responsiveness), rich schema settings (range and color types), and a presets array. Do not submit lazy or generic code.")
    })
  ).max(10).describe("Maximale file batch is 10 items conform veiligheidsregels"),
  themeId: z.string().or(z.number()).optional().describe("Doel thema ID. Gebruik themeRole='main' als je rechtstreeks de live store wilt aanpassen (default)."),
  themeRole: z.enum(["main", "unpublished", "development"]).optional().default("main").describe("De target rol. Standaard op 'main' voor productie publicaties."),
  isStandalone: z.boolean().optional().describe("Mark as standalone workflow")
});

export const draftThemeArtifact = {
  name: toolName,
  description,
  schema: inputSchema,
  execute: async (args, context = {}) => {
    const shopifyClient = requireShopifyClient(context);
    
    let shopDomain = "unknown_shop";
    try {
      shopDomain = getShopDomainFromClient(shopifyClient);
    } catch(e) {
      if (context.shopifyDomain) shopDomain = context.shopifyDomain;
    }

    const dbPool = getDbPool();
    const { files, themeId, themeRole } = args;

    // Stap 0 (Bouwinspectie): Pre-validatie tegen passieve LLM code output
    for (const file of files) {
      if (file.key.endsWith(".liquid") && file.key.startsWith("sections/")) {
        const val = file.value;
        const hasMedia = val.includes("@media");
        const hasRange = val.includes('"type": "range"') || val.includes("'type': 'range'") || val.includes('"type":"range"');
        const hasColor = val.includes('"type": "color"') || val.includes("'type': 'color'") || val.includes('"type":"color"') || val.includes("color_background");
        const hasPresets = val.includes('"presets":') || val.includes("'presets':") || val.includes('"presets":');

        if (!hasMedia || !hasRange || !hasColor || !hasPresets) {
          return {
            success: false,
            status: "inspection_failed",
            message: "Building Inspection Failed: Your code was rejected because it is too generic. It is missing mobile responsiveness (@media queries) AND/OR rich schema settings (range, color). Rewrite the code to match a premium 1-to-1 Shopify OS 2.0 section."
          };
        }
      }
    }

    // Stap 1 (Database): Opslaan in theme_drafts met status pending
    let draftId = `mock-${Date.now()}`;
    if (dbPool && process.env.DATABASE_URL) {
      const res = await dbPool.query(
        `INSERT INTO theme_drafts (shop_domain, status, files_json) VALUES ($1, $2, $3) RETURNING id`,
        [shopDomain, "pending", JSON.stringify(files)]
      );
      draftId = res.rows[0].id;
    }

    // Stap 2 (Linting): Wegschrijven naar /tmp en checken
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "hazify-sandbox-"));
    let linterError = null;

    try {
      await fs.mkdir(path.join(tmpDir, "locales"), { recursive: true });
      for (const f of files) {
        const fullPath = path.join(tmpDir, f.key);
        await fs.mkdir(path.dirname(fullPath), { recursive: true });
        await fs.writeFile(fullPath, f.value, "utf8");
      }

      const offenses = await check(tmpDir); // Draai @shopify/theme-check-node pass

      // 0 = ERROR, 1 = WARNING
      const criticalErrors = offenses.filter((o) => o.severity === 0);

      if (criticalErrors.length > 0) {
        linterError = criticalErrors;
      }
    } catch (err) {
      // Fallback als de linter zelf crasht
      linterError = [{ message: `Linter runtime error: ${err.message}` }];
    }

    // Stap 3 (Error Handling): Als de linter fouten vindt
    if (linterError) {
      if (dbPool && process.env.DATABASE_URL) {
        await dbPool.query(
          `UPDATE theme_drafts SET status = $1, updated_at = NOW() WHERE id = $2`,
          ["lint_failed", draftId]
        );
      }
      try {
        await fs.rm(tmpDir, { recursive: true, force: true });
      } catch (rmErr) {}

      return {
        success: false,
        status: "lint_failed",
        draftId,
        message: "Linter heeft syntax fouten gevonden in de Liquid code. Fix deze bestanden voordat ze naar Sandbox worden gepushed.",
        errors: linterError.map(e => ({
          file: e.uri ? e.uri.replace(`file://${tmpDir}/`, "") : "root",
          check: e.check || "Unknown",
          message: e.message,
          severity: "error",
          start: e.start || null
        }))
      };
    }

    // Schoon de temp dir op als lint slaagt
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch (rmErr) {}

    // Stap 4 (Target Push)
    try {
      const API_VERSION = process.env.SHOPIFY_API_VERSION || "2026-01";
      
      const upsertResult = await upsertThemeFiles(shopifyClient, API_VERSION, {
        themeId: themeId ? String(themeId) : undefined,
        themeRole,
        files: files.map(f => ({ key: f.key, value: f.value })),
        verifyAfterWrite: false
      });

      if (dbPool && process.env.DATABASE_URL) {
        await dbPool.query(
          `UPDATE theme_drafts SET status = $1, updated_at = NOW() WHERE id = $2`,
          ["preview_ready", draftId]
        );
      }
      
      const appliedThemeId = upsertResult.theme?.id || themeId;

      return {
        success: true,
        status: "preview_ready",
        draftId,
        themeId: appliedThemeId,
        editorUrl: `https://${shopDomain}/admin/themes/${appliedThemeId}/editor`,
        message: "Code is Succesvol geverifieerd (0 errors) en gepusht naar het gekozen theme."
      };
    } catch (err) {
      if (dbPool && process.env.DATABASE_URL) {
        await dbPool.query(
          `UPDATE theme_drafts SET status = $1, updated_at = NOW() WHERE id = $2`,
          ["push_failed", draftId]
        );
      }
      throw new Error(`Na de linter faalde de Shopify API upload: ${err.message}`);
    }
  }
};
