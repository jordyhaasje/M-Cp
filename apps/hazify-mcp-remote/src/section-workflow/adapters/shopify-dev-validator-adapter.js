import { createIssue } from "../error-model.js";
import { toAdapterBridgeFailureIssue } from "./mcp-client-bridge.js";

const extractSchemaJsonFromLiquid = (liquidContent) => {
  const match = String(liquidContent || "").match(/\{\%\s*schema\s*\%\}([\s\S]*?)\{\%\s*endschema\s*\%\}/i);
  return match?.[1] ? String(match[1]).trim() : "";
};

const parseSchemaFromLiquid = (liquidContent) => {
  const schemaRaw = extractSchemaJsonFromLiquid(liquidContent);
  if (!schemaRaw) {
    throw new Error("Section liquid bevat geen {% schema %} blok.");
  }
  return JSON.parse(schemaRaw);
};

export class ShopifyDevValidatorAdapter {
  constructor({ bridge = null, provider = "shopify-dev-mcp" } = {}) {
    this.bridge = bridge;
    this.provider = provider;
  }

  async validateBundleSchema({ bundle, strict }) {
    if (this.bridge) {
      try {
        const bridged = await this.bridge.callTool({
          provider: this.provider,
          toolName: "validate-bundle-schema",
          args: { bundle, strict },
        });
        const payload = bridged.structuredContent || {};
        return {
          source: "shopify-dev-mcp",
          status: payload.status || "pass",
          schema: payload.schema || { status: "pass", issues: [] },
          template: payload.template || { status: "pass", issues: [] },
          issues: payload.issues || [],
        };
      } catch (error) {
        return {
          source: "shopify-dev-mcp",
          status: "fail",
          schema: { status: "fail", issues: [] },
          template: { status: "warn", issues: [] },
          issues: [toAdapterBridgeFailureIssue({ stage: "validation", source: "shopify-dev-mcp", error })],
        };
      }
    }

    const sectionFile = (bundle?.files || []).find(
      (entry) => String(entry?.path || "").startsWith("sections/") && String(entry?.path || "").endsWith(".liquid")
    );

    const issues = [];
    let schemaStatus = "pass";
    let parsedSchema = null;

    if (!sectionFile?.content) {
      issues.push(
        createIssue({
          code: "schema_invalid",
          stage: "validation",
          severity: "error",
          blocking: true,
          source: "shopify-dev-mcp",
          message: "Bundle mist sections/*.liquid content.",
        })
      );
      schemaStatus = "fail";
    } else {
      try {
        parsedSchema = parseSchemaFromLiquid(sectionFile.content);
        if (!parsedSchema?.name) {
          schemaStatus = "fail";
          issues.push(
            createIssue({
              code: "schema_invalid",
              stage: "validation",
              severity: "error",
              blocking: true,
              source: "shopify-dev-mcp",
              message: "Section schema mist verplicht veld 'name'.",
            })
          );
        }
        if (!Array.isArray(parsedSchema?.presets) || parsedSchema.presets.length === 0) {
          schemaStatus = "fail";
          issues.push(
            createIssue({
              code: "schema_invalid",
              stage: "validation",
              severity: "error",
              blocking: true,
              source: "shopify-dev-mcp",
              message: "Section schema moet minimaal één preset bevatten.",
            })
          );
        }
      } catch (error) {
        schemaStatus = "fail";
        issues.push(
          createIssue({
            code: "schema_invalid",
            stage: "validation",
            severity: "error",
            blocking: true,
            source: "shopify-dev-mcp",
            message: error instanceof Error ? error.message : String(error),
          })
        );
      }
    }

    issues.push(
      createIssue({
        code: "adapter_unavailable",
        stage: "validation",
        severity: "warn",
        blocking: false,
        source: "shopify-dev-mcp",
        message: "Shopify Dev MCP bridge niet geconfigureerd; schema-validatie gebruikt lokale fallback checks.",
      })
    );

    const templateIssues = [];
    const suggestedTemplate = String(bundle?.suggestedTemplateKey || "templates/index.json");
    if (!/\.json$/i.test(suggestedTemplate)) {
      templateIssues.push(
        createIssue({
          code: "template_insert_invalid",
          stage: "validation",
          severity: strict ? "error" : "warn",
          blocking: Boolean(strict),
          source: "shopify-dev-mcp",
          message: `Template key '${suggestedTemplate}' is niet JSON-gebaseerd.`,
        })
      );
    }

    const schemaIssues = issues.filter((entry) => entry.code === "schema_invalid");
    const templateErrorIssues = templateIssues.filter((entry) => entry.severity === "error");

    return {
      source: "shopify-dev-mcp",
      status: schemaIssues.length || templateErrorIssues.length ? "fail" : "pass",
      schema: {
        status: schemaStatus,
        issues: schemaIssues,
      },
      template: {
        status: templateErrorIssues.length ? "fail" : templateIssues.length ? "warn" : "pass",
        issues: templateIssues,
      },
      issues: [...issues, ...templateIssues],
      parsedSchema,
    };
  }

  async validateTemplateInstallability({ bundle, themeContext, strict }) {
    const issues = [];
    const templateKey = String(themeContext?.templateKey || bundle?.suggestedTemplateKey || "templates/index.json");

    if (!templateKey.startsWith("templates/")) {
      issues.push(
        createIssue({
          code: "template_insert_invalid",
          stage: "validation",
          severity: strict ? "error" : "warn",
          blocking: Boolean(strict),
          source: "shopify-dev-mcp",
          message: `Template key '${templateKey}' moet onder templates/ staan.`,
        })
      );
    }

    if (!/\.json$/i.test(templateKey)) {
      issues.push(
        createIssue({
          code: "template_insert_invalid",
          stage: "validation",
          severity: strict ? "error" : "warn",
          blocking: Boolean(strict),
          source: "shopify-dev-mcp",
          message: `Template key '${templateKey}' moet op .json eindigen.`,
        })
      );
    }

    return {
      source: "shopify-dev-mcp",
      status: issues.some((entry) => entry.severity === "error") ? "fail" : issues.length ? "warn" : "pass",
      template: {
        status: issues.some((entry) => entry.severity === "error") ? "fail" : issues.length ? "warn" : "pass",
        issues,
      },
      issues,
    };
  }
}
