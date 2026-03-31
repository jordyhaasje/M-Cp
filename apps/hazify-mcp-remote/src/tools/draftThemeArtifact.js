import { z } from "zod";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { check } from "@shopify/theme-check-node";
import { getDbPool } from "../lib/db.js";
import { requireShopifyClient } from "./_context.js";
import { listThemes, getShopDomainFromClient, getAccessTokenFromClient, buildAdminRestUrl } from "../lib/themeFiles.js";
import { upsertThemeFilesTool } from "./upsertThemeFiles.js";

export const toolName = "draft-theme-artifact";
export const description = "Scaffoldt en lints veilige code wijzigingen lokaal en pusht deze naar een realtime Sandbox theme. Het elimineert syntax errors door een strenge theme-check-node validatie cycle en zorgt dat live shops nooit breken.";

export const inputSchema = z.object({
  files: z.array(
    z.object({
      key: z.string().describe("De exacte filelocatie (bijv. sections/feature-sandbox.liquid)"),
      value: z.string().describe("De volledige inhoud / broncode voor deze sandbox preview")
    })
  ).max(10).describe("Maximale file batch is 10 items conform veiligheidsregels"),
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
    const { files } = args;

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

    // Stap 4 (Sandbox Push)
    try {
      const API_VERSION = process.env.SHOPIFY_API_VERSION || "2026-01";
      const availableThemes = await listThemes(shopifyClient, API_VERSION);
      let sandboxTheme = availableThemes.find(t => t.name === "Hazify Sandbox");

      if (!sandboxTheme) {
        const token = getAccessTokenFromClient(shopifyClient);
        const url = buildAdminRestUrl({
          domain: getShopDomainFromClient(shopifyClient),
          apiVersion: API_VERSION,
          path: "themes.json"
        });

        const res = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Shopify-Access-Token": token
          },
          body: JSON.stringify({ theme: { name: "Hazify Sandbox", role: "unpublished" } })
        });
        
        if (!res.ok) {
           throw new Error(`REST API returned ${res.status} ${res.statusText}`);
        }
        const createCall = await res.json();
        
        if (createCall && createCall.theme) {
          sandboxTheme = createCall.theme;
        } else {
           throw new Error("Sandbox theme aanmaken faalde via JSON POST.");
        }
      }

      await upsertThemeFilesTool.execute({
        themeId: sandboxTheme.id,
        files: files.map(f => ({ key: f.key, value: f.value })),
        auditReason: `Hazify Sandbox automated pipeline lint & deploy (${draftId})`,
        confirmation: "UPSERT_THEME_FILES"
      }, context);

      if (dbPool && process.env.DATABASE_URL) {
        await dbPool.query(
          `UPDATE theme_drafts SET status = $1, updated_at = NOW() WHERE id = $2`,
          ["preview_ready", draftId]
        );
      }

      return {
        success: true,
        status: "preview_ready",
        draftId,
        sandboxThemeId: sandboxTheme.id,
        previewUrl: `https://${shopDomain}/?preview_theme_id=${sandboxTheme.id}`,
        message: "Code is Succesvol geverifieerd (0 errors) en gepusht naar de afgeschermde Hazify Sandbox."
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
