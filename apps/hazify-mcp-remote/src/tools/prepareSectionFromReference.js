import * as cheerio from "cheerio";
import { z } from "zod";
import { fetchWithSafeRedirects } from "../lib/urlSecurity.js";
import { analyzeReferenceUi } from "./analyzeReferenceUi.js";

export const toolName = "prepare-section-from-reference";
export const description =
  "Default preparation tool for new Shopify sections from a reference URL. It identifies the intended subsection using an optional sectionHint or targetHeading, enriches the reference via analyze-reference-ui, and returns a strict sectionBlueprint plus a direct nextAction for draft-theme-artifact. Image inputs remain hints or QA context only.";

const PrepareSectionInputSchema = z
  .object({
    url: z.string().url().optional().describe("De reference URL van de pagina waar de section op staat."),
    cssSelector: z
      .string()
      .optional()
      .describe("Optioneel: expliciete selector wanneer de subsection al bekend is."),
    imageUrls: z
      .array(z.string().url())
      .max(8)
      .optional()
      .describe("Optionele screenshots of referentiebeelden. Alleen als hint of QA-context, niet als zelfstandige bron."),
    sectionHint: z
      .string()
      .min(1)
      .optional()
      .describe("Aanbevolen: zichtbare sectietitel of korte hint om de juiste subsection op de pagina te kiezen."),
    targetHeading: z
      .string()
      .min(1)
      .optional()
      .describe("Alias van sectionHint. Gebruik een zichtbare headingtekst wanneer de pagina meerdere sections bevat."),
  })
  .superRefine((input, ctx) => {
    if (!input.url && (!Array.isArray(input.imageUrls) || input.imageUrls.length === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["url"],
        message: "Geef minimaal een url of imageUrls op.",
      });
    }
  });

function uniqueStrings(values) {
  return Array.from(new Set((values || []).filter(Boolean)));
}

function truncate(value, length = 180) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, length);
}

function slugify(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(value) {
  return normalizeText(value)
    .split(" ")
    .map((token) => token.trim())
    .filter(Boolean);
}

function scoreTextMatch(candidate, hint) {
  const normalizedCandidate = normalizeText(candidate);
  const normalizedHint = normalizeText(hint);

  if (!normalizedCandidate || !normalizedHint) {
    return 0;
  }

  if (normalizedCandidate === normalizedHint) {
    return 1;
  }

  if (normalizedCandidate.includes(normalizedHint) || normalizedHint.includes(normalizedCandidate)) {
    return 0.9;
  }

  const candidateTokens = tokenize(candidate);
  const hintTokens = tokenize(hint);
  const overlap = hintTokens.filter((token) => candidateTokens.includes(token)).length;
  if (!hintTokens.length || !candidateTokens.length) {
    return 0;
  }

  return overlap / Math.max(candidateTokens.length, hintTokens.length);
}

function isSafeCssToken(value) {
  return /^[a-zA-Z][a-zA-Z0-9_-]*$/.test(String(value || ""));
}

function buildNodeSelector($, node) {
  const element = $(node);
  if (!element.length) {
    return "body";
  }

  const id = element.attr("id");
  if (isSafeCssToken(id) && $(`#${id}`).length === 1) {
    return `#${id}`;
  }

  const parts = [];
  let current = element;
  let depth = 0;

  while (current.length && depth < 6) {
    const tag = String(current.prop("tagName") || "").toLowerCase();
    if (!tag || tag === "html") {
      break;
    }

    if (tag === "body") {
      parts.unshift("body");
      break;
    }

    let selector = tag;
    const classNames = (current.attr("class") || "")
      .split(/\s+/)
      .filter(Boolean)
      .filter(isSafeCssToken)
      .slice(0, 2);
    if (classNames.length > 0) {
      selector += `.${classNames.join(".")}`;
    }

    const parent = current.parent();
    if (parent.length) {
      const siblings = parent.children(tag);
      if (siblings.length > 1) {
        const index = siblings.toArray().findIndex((entry) => entry === current[0]) + 1;
        selector += `:nth-of-type(${index})`;
      }
    }

    parts.unshift(selector);
    const candidate = parts.join(" > ");
    if ($(candidate).length === 1) {
      return candidate;
    }

    current = current.parent();
    depth += 1;
  }

  return parts.length ? parts.join(" > ") : "body";
}

function isBroadSectionContainer($, node) {
  const element = $(node);
  if (!element.length) {
    return false;
  }

  const tag = String(element.prop("tagName") || "").toLowerCase();
  if (["body", "html"].includes(tag)) {
    return false;
  }

  if (["section", "article", "aside"].includes(tag)) {
    return true;
  }

  const textLength = truncate(element.text(), 2000).length;
  const childCount = element.children().length;
  const signature = `${element.attr("id") || ""} ${element.attr("class") || ""}`;
  return (
    /(section|collection|grid|slider|carousel|card|tile|feature|module|block|wrapper|container)/i.test(signature) &&
    textLength >= 40 &&
    childCount >= 2
  );
}

function findSectionRoot($, node) {
  let current = $(node);
  let fallback = current.parent();
  const candidates = [];

  while (current.length && !current.is("body")) {
    if (isBroadSectionContainer($, current[0])) {
      const textLength = truncate(current.text(), 2000).length;
      if (textLength <= 1800) {
        candidates.push(current);
      }
    }
    fallback = current;
    current = current.parent();
  }

  const explicitSection = candidates
    .slice()
    .reverse()
    .find((candidate) => ["section", "article", "aside"].includes(String(candidate.prop("tagName") || "").toLowerCase()));
  if (explicitSection) {
    return explicitSection;
  }

  if (candidates.length > 0) {
    return candidates[candidates.length - 1];
  }

  if (fallback?.length && !fallback.is("body")) {
    return fallback;
  }

  return $(node);
}

function collectHeadingCandidates($) {
  return $("h1, h2, h3, h4, h5, h6")
    .toArray()
    .map((node) => {
      const element = $(node);
      const text = truncate(element.text(), 180);
      return text
        ? {
            node,
            text,
          }
        : null;
    })
    .filter(Boolean);
}

function selectRootFromHint($, hint) {
  const scored = collectHeadingCandidates($)
    .map((candidate) => ({
      ...candidate,
      score: scoreTextMatch(candidate.text, hint),
    }))
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score);

  const best = scored[0] || null;
  if (!best || best.score < 0.45) {
    return {
      ok: false,
      errorCode: "section_hint_not_found",
      retryable: true,
      message: `Kon geen subsection vinden die sterk genoeg overeenkomt met de hint '${hint}'.`,
      selectionEvidence: {
        strategy: "section_hint",
        hint,
        candidateHeadings: scored.slice(0, 5).map((entry) => ({
          text: entry.text,
          score: Number(entry.score.toFixed(2)),
        })),
      },
      requiredInputs: ["sectionHint"],
    };
  }

  const root = findSectionRoot($, best.node);
  return {
    ok: true,
    root,
    selectionEvidence: {
      strategy: "section_hint",
      hint,
      matchedHeading: best.text,
      matchScore: Number(best.score.toFixed(2)),
      selector: buildNodeSelector($, root[0]),
      candidateHeadings: scored.slice(0, 5).map((entry) => ({
        text: entry.text,
        score: Number(entry.score.toFixed(2)),
      })),
    },
  };
}

function selectSingleSection($) {
  const candidates = uniqueStrings(
    collectHeadingCandidates($)
      .map((candidate) => {
        const root = findSectionRoot($, candidate.node);
        if (!root.length || root.is("body")) {
          return null;
        }
        return buildNodeSelector($, root[0]);
      })
      .filter(Boolean)
  );

  if (candidates.length === 1) {
    const root = $(candidates[0]).first();
    const matchedHeading = truncate(root.find("h1, h2, h3, h4, h5, h6").first().text(), 180) || null;
    return {
      ok: true,
      root,
      selectionEvidence: {
        strategy: "single_section_autoselect",
        matchedHeading,
        selector: candidates[0],
      },
    };
  }

  const availableHeadings = collectHeadingCandidates($).slice(0, 8).map((entry) => entry.text);
  return {
    ok: false,
    errorCode: "section_hint_required",
    retryable: true,
    message:
      "Deze pagina bevat meerdere mogelijke sections. Geef een sectionHint of targetHeading mee zodat de juiste subsection geselecteerd kan worden.",
    selectionEvidence: {
      strategy: "ambiguous_page",
      availableHeadings,
      candidateCount: candidates.length,
    },
    requiredInputs: ["sectionHint"],
  };
}

function fetchSubsectionHtmlContext(html) {
  return async () => html;
}

function inferArchetype({ sectionHint, referenceSpec, root, $ }) {
  const hint = normalizeText(sectionHint || "");
  const images = root.find("img").length;
  const links = root.find("a[href]").toArray();
  const shortLinks = links.filter((node) => {
    const text = truncate($(node).text(), 60);
    return text && text.split(/\s+/).length <= 5;
  }).length;
  const listItems = root.find("ul li, ol li").length;
  const comparisonRows = root.find("table tr").length;
  const cardLike = root.find("[class*='card'], [class*='tile'], [class*='item']").length;
  const textPreview = normalizeText(referenceSpec?.structure?.textPreview || "");

  if (comparisonRows >= 2 || /comparison|vergelijk/i.test(textPreview)) {
    return "comparison-table";
  }

  if (hint.includes("collect") || textPreview.includes("collect")) {
    if (images >= 2) {
      return "collection-card-grid";
    }
    if (shortLinks >= 3 || links.length >= 3) {
      return "collection-link-grid";
    }
  }

  if (images >= 2 && cardLike >= 2) {
    return "card-grid";
  }

  if (listItems >= 3) {
    return "feature-list";
  }

  if (images >= 1 && links.length >= 1) {
    return "hero";
  }

  return "generic-section";
}

function createCommonSettings() {
  return [
    { id: "heading", type: "text", reason: "Primaire sectietitel." },
    { id: "subheading", type: "richtext", reason: "Korte ondersteunende tekst of intro." },
    { id: "section_background", type: "color", reason: "Merchant-editable achtergrondkleur." },
    { id: "text_color", type: "color", reason: "Primaire tekstkleur." },
    { id: "accent_color", type: "color", reason: "Accentkleur voor borders, pills of highlights." },
    { id: "section_padding_top", type: "range", reason: "Top spacing control." },
    { id: "section_padding_bottom", type: "range", reason: "Bottom spacing control." },
  ];
}

function createBlueprint({ archetype, sectionHint, selectionEvidence, referenceSpec }) {
  const handleSeed =
    selectionEvidence?.matchedHeading || sectionHint || referenceSpec?.structure?.textPreview || "reference-section";
  const handle = slugify(handleSeed) || "reference-section";
  const primaryFileKey = `sections/${handle}.liquid`;
  const settings = createCommonSettings();
  const blocks = [];
  const generationHints = [
    "Gebruik voor een nieuwe reference-based section geen search-theme-files, get-theme-file of get-themes tenzij de gebruiker expliciet een bestaand bestand wil aanpassen.",
    `Beperk de output standaard tot \`${primaryFileKey}\`.`,
    "Gebruik presets zodat de section direct zichtbaar is in de Theme Editor.",
    "Gebruik geen Liquid binnen {% stylesheet %} of {% javascript %}.",
    "Gebruik Shopify image_url en image_tag voor media, niet een losse raw <img> zonder afmetingen.",
  ];
  const lintSafetyRules = [
    "Voorkom raw <img> tags zonder width/height; geef de voorkeur aan image_tag.",
    "Voeg minimaal één responsieve breakpoint of clamp()-hint toe wanneer de layout meerdere kolommen bevat.",
    "Houd merchant-editable kleuren en spacing in schema settings, niet hardcoded in de markup.",
  ];

  if (archetype === "collection-link-grid") {
    settings.push(
      { id: "columns_desktop", type: "range", reason: "Aantal kolommen op desktop." },
      { id: "pill_radius", type: "range", reason: "Afgeronde hoeken voor collectie-links of cards." }
    );
    blocks.push({
      type: "collection_link",
      label: "Collection link",
      requiredSettings: ["collection", "override_label"],
      schema: [
        { id: "collection", type: "collection", reason: "De gekoppelde collectie voor deze tile of link." },
        { id: "override_label", type: "text", reason: "Optionele overschreven titel wanneer de reference afwijkt." },
      ],
    });
    generationHints.push(
      "Modelleer de reference als een collectie-link grid of pill-layout, niet als losse productkaarten.",
      "Gebruik blocks voor de herhaalbare collectie-items zodat merchants eenvoudig kunnen reorderen."
    );
  } else if (archetype === "collection-card-grid") {
    settings.push(
      { id: "columns_desktop", type: "range", reason: "Aantal kolommen op desktop." },
      { id: "card_radius", type: "range", reason: "Rounded corners for collection cards." }
    );
    blocks.push({
      type: "collection_card",
      label: "Collection card",
      requiredSettings: ["collection", "custom_image", "override_label"],
      schema: [
        { id: "collection", type: "collection", reason: "De collectie achter deze card." },
        { id: "custom_image", type: "image_picker", reason: "Optionele image override als de reference niet de collectieafbeelding gebruikt." },
        { id: "override_label", type: "text", reason: "Optionele custom titel." },
      ],
    });
    generationHints.push(
      "Gebruik collection-based blocks en render de afbeelding via image_url en image_tag.",
      "Maak geen product grid wanneer de reference over collecties gaat."
    );
  } else if (archetype === "comparison-table") {
    settings.push({ id: "card_radius", type: "range", reason: "Rounded corners voor de comparison container." });
    blocks.push({
      type: "comparison_row",
      label: "Comparison row",
      requiredSettings: ["label", "primary_value", "secondary_value"],
      schema: [
        { id: "label", type: "text", reason: "Feature label per rij." },
        { id: "primary_value", type: "text", reason: "Waarde of icoonlabel voor het primaire merk." },
        { id: "secondary_value", type: "text", reason: "Waarde of icoonlabel voor de vergelijking." },
      ],
    });
  } else if (archetype === "feature-list") {
    blocks.push({
      type: "feature_item",
      label: "Feature item",
      requiredSettings: ["title", "body"],
      schema: [
        { id: "title", type: "text", reason: "Titel of label." },
        { id: "body", type: "richtext", reason: "Ondersteunende copy." },
        { id: "icon", type: "image_picker", reason: "Optioneel icoon of illustratie." },
      ],
    });
  }

  return {
    version: 1,
    archetype,
    sectionHandle: handle,
    recommendedPrimaryFile: primaryFileKey,
    recommendedFileStrategy: "single-section-file",
    suggestedFiles: [
      {
        key: primaryFileKey,
        required: true,
        role: "section",
        reason: "Standaard Shopify-conforme output voor nieuwe reference-based sections.",
      },
    ],
    selectionEvidence,
    settings,
    blocks,
    generationHints,
    lintSafetyRules,
    filePolicy: {
      sectionOnlyDefault: true,
      automaticTemplatePlacement: false,
      allowExtraFilesOnlyWhenJustified: true,
    },
    mediaPolicy: {
      preferImageTag: true,
      rawImgRequiresDimensions: true,
      imageHintsAreSupplemental: true,
    },
  };
}

function mergeNextAction(nextAction, { url, cssSelector, imageUrls, referenceSpec, sectionBlueprint }) {
  return {
    ...(nextAction || {}),
    kind: "call_tool",
    tool: "draft-theme-artifact",
    readyForDraft: true,
    reason: "De reference subsection is gekozen en omgezet naar een direct bruikbare blueprint.",
    minimalArguments: {
      themeRole: "development",
      referenceInput: {
        url,
        ...(cssSelector ? { cssSelector } : {}),
        ...(imageUrls.length ? { imageUrls } : {}),
      },
      referenceSpec,
      sectionBlueprint,
      files: [
        {
          key: sectionBlueprint.recommendedPrimaryFile,
          value: "<generate Shopify section code here>",
        },
      ],
    },
  };
}

async function fetchHtmlWithGuards(url, context = {}) {
  if (typeof context.fetchReferenceHtml === "function") {
    return context.fetchReferenceHtml(url);
  }

  const response = await fetchWithSafeRedirects(url, {
    timeoutMs: Number(process.env.HAZIFY_VISUAL_ANALYSIS_TIMEOUT_MS || 12000),
    headers: {
      "User-Agent": "HazifySectionPlanner/1.0 (+https://hazify.dev)",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.8",
    },
  });

  if (!response.ok) {
    throw new Error(`Fetch faalde met HTTP status ${response.status} ${response.statusText}`);
  }

  return response.text();
}

function buildBlockedResult({ url, selector = null, imageUrls = [], sectionPlan = null, selectionEvidence = null, message, errorCode, retryable, requiredInputs = [], nextAction = null }) {
  return {
    success: false,
    url: url || null,
    selector,
    contentLength: 0,
    markup: "",
    referenceSpec: null,
    analysisMode: "prepare-blocked",
    fidelityWarnings: [],
    sources: [
      ...(url ? [{ type: "url", url }] : []),
      ...imageUrls.map((imageUrl) => ({ type: "image", url: imageUrl })),
    ],
    sectionPlan,
    sectionBlueprint: null,
    selectionEvidence,
    error: message,
    message,
    errorCode,
    retryable,
    nextAction,
    suggestedFiles: sectionPlan?.suggestedFiles || [],
    requiredInputs,
    generationHints: [],
    fidelityRisks: [],
    usedVisualWorker: false,
    fidelityUpgradeApplied: false,
    workerWarnings: [],
  };
}

export const prepareSectionFromReference = {
  name: toolName,
  description,
  schema: PrepareSectionInputSchema,
  execute: async (args, context = {}) => {
    const { url, cssSelector, imageUrls = [] } = args;
    const sectionHint = String(args.sectionHint || args.targetHeading || "").trim();

    if (!url) {
      return buildBlockedResult({
        url: null,
        imageUrls,
        message: "Image-only cloning wordt nog niet ondersteund. Geef een reference URL mee en gebruik afbeeldingen alleen als extra hint.",
        errorCode: "image_only_not_supported",
        retryable: false,
        requiredInputs: ["url"],
        nextAction: {
          kind: "user_input_required",
          tool: null,
          readyForDraft: false,
          reason: "Een reference URL is nodig om de juiste subsection betrouwbaar te selecteren.",
          requestedInput: ["url"],
          guidance: "Vraag de gebruiker om de live URL van de pagina waar de section op staat.",
        },
      });
    }

    try {
      if (cssSelector) {
        const html = await fetchHtmlWithGuards(url, context);
        const $ = cheerio.load(html);
        const explicitRoot = $(cssSelector).first();
        const analysis = await analyzeReferenceUi.execute(
          {
            url,
            cssSelector,
            ...(imageUrls.length ? { imageUrls } : {}),
          },
          {
            ...context,
            fetchReferenceHtml: fetchSubsectionHtmlContext(html),
          }
        );

        if (!analysis.success) {
          return analysis;
        }

        const selectedRoot = explicitRoot.length ? explicitRoot : $("body").first();
        const archetype = inferArchetype({
          sectionHint,
          referenceSpec: analysis.referenceSpec,
          root: selectedRoot,
          $,
        });
        const sectionBlueprint = createBlueprint({
          archetype,
          sectionHint,
          selectionEvidence: {
            strategy: "css_selector",
            selector: cssSelector,
            matchedHeading:
              truncate(selectedRoot.find("h1, h2, h3, h4, h5, h6").first().text(), 180) || null,
          },
          referenceSpec: analysis.referenceSpec,
        });
        return {
          ...analysis,
          analysisMode: `${analysis.analysisMode}-prepared`,
          sectionBlueprint,
          selectionEvidence: sectionBlueprint.selectionEvidence,
          sectionPlan: {
            ...(analysis.sectionPlan || {}),
            status: "ready_for_draft",
            readyForDraft: true,
            recommendedPrimaryFile: sectionBlueprint.recommendedPrimaryFile,
            suggestedFiles: sectionBlueprint.suggestedFiles,
            recommendedFileStrategy: sectionBlueprint.recommendedFileStrategy,
            blockRecommendations: sectionBlueprint.blocks,
            recommendedSchemaSettings: sectionBlueprint.settings,
          },
          suggestedFiles: sectionBlueprint.suggestedFiles,
          generationHints: uniqueStrings([
            ...(analysis.generationHints || []),
            ...sectionBlueprint.generationHints,
          ]),
          fidelityRisks: uniqueStrings(analysis.referenceSpec?.fidelityGaps || []),
          nextAction: mergeNextAction(analysis.nextAction, {
            url,
            cssSelector,
            imageUrls,
            referenceSpec: analysis.referenceSpec,
            sectionBlueprint,
          }),
        };
      }

      const html = await fetchHtmlWithGuards(url, context);
      const $ = cheerio.load(html);
      const selection = sectionHint ? selectRootFromHint($, sectionHint) : selectSingleSection($);

      if (!selection.ok) {
        return buildBlockedResult({
          url,
          imageUrls,
          sectionPlan: {
            status: "blocked",
            readyForDraft: false,
            blockedReason: selection.errorCode,
            recommendedFileStrategy: "single-section-file",
            suggestedFiles: [],
          },
          selectionEvidence: selection.selectionEvidence,
          message: selection.message,
          errorCode: selection.errorCode,
          retryable: selection.retryable,
          requiredInputs: selection.requiredInputs || [],
          nextAction: {
            kind: "user_input_required",
            tool: null,
            readyForDraft: false,
            reason: selection.message,
            requestedInput: selection.requiredInputs || [],
            guidance:
              selection.errorCode === "section_hint_required"
                ? "Vraag de gebruiker om de zichtbare sectietitel of een korte hint van de bedoelde subsection."
                : "Vraag de gebruiker om een nauwkeurigere sectietitel of een expliciete cssSelector.",
          },
        });
      }

      const subsectionSelector = selection.selectionEvidence.selector;
      const analysis = await analyzeReferenceUi.execute(
        {
          url,
          cssSelector: subsectionSelector,
          ...(imageUrls.length ? { imageUrls } : {}),
        },
        {
          ...context,
          fetchReferenceHtml: fetchSubsectionHtmlContext(html),
        }
      );

      if (!analysis.success) {
        return {
          ...analysis,
          selectionEvidence: selection.selectionEvidence,
        };
      }

      const archetype = inferArchetype({
        sectionHint,
        referenceSpec: analysis.referenceSpec,
        root: selection.root,
        $,
      });
      const sectionBlueprint = createBlueprint({
        archetype,
        sectionHint,
        selectionEvidence: selection.selectionEvidence,
        referenceSpec: analysis.referenceSpec,
      });
      const generationHints = uniqueStrings([
        ...(analysis.generationHints || []),
        ...sectionBlueprint.generationHints,
        sectionHint
          ? `Gebruik de hint '${sectionHint}' om de contentstructuur en merchant settings op deze subsection afgestemd te houden.`
          : "Geen expliciete sectionHint meegegeven; baseer de section alleen op de geselecteerde subsection.",
      ]);

      return {
        ...analysis,
        analysisMode: `${analysis.analysisMode}-prepared`,
        sectionBlueprint,
        selectionEvidence: selection.selectionEvidence,
        sectionPlan: {
          ...(analysis.sectionPlan || {}),
          status: "ready_for_draft",
          readyForDraft: true,
          blockedReason: null,
          recommendedPrimaryFile: sectionBlueprint.recommendedPrimaryFile,
          suggestedFiles: sectionBlueprint.suggestedFiles,
          recommendedFileStrategy: sectionBlueprint.recommendedFileStrategy,
          blockRecommendations: sectionBlueprint.blocks,
          recommendedSchemaSettings: sectionBlueprint.settings,
          fidelityRisks: uniqueStrings([
            ...(analysis.sectionPlan?.fidelityRisks || []),
            ...(analysis.referenceSpec?.fidelityGaps || []),
          ]),
        },
        suggestedFiles: sectionBlueprint.suggestedFiles,
        generationHints,
        fidelityRisks: uniqueStrings([
          ...(analysis.sectionPlan?.fidelityRisks || []),
          ...(analysis.referenceSpec?.fidelityGaps || []),
        ]),
        nextAction: mergeNextAction(analysis.nextAction, {
          url,
          cssSelector: subsectionSelector,
          imageUrls,
          referenceSpec: analysis.referenceSpec,
          sectionBlueprint,
        }),
      };
    } catch (error) {
      return buildBlockedResult({
        url,
        imageUrls,
        message: `Kon reference section preparation niet afronden: ${error.message}`,
        errorCode: "reference_prepare_failed",
        retryable: true,
        nextAction: {
          kind: "retry",
          tool: toolName,
          readyForDraft: false,
          reason: "De subsection kon niet worden voorbereid uit de opgehaalde reference.",
          guidance: "Controleer de URL of geef een expliciete cssSelector of sectionHint mee.",
        },
      });
    }
  },
};
