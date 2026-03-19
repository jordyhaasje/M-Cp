import { getThemeFiles, upsertThemeFiles } from "./themeFiles.js";

const SUPPORTED_SECTION_TARGETS = new Set(["sections/header-group.json", "sections/footer-group.json"]);

const buildCodedError = (code, message, extras = {}) => {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, extras);
  return error;
};

const normalizeText = (value) => String(value || "").trim();

const slugifyHandle = (value) => {
  const normalized = normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
  return normalized || "custom-section";
};

const normalizeInstanceBase = (handle) => {
  const normalized = String(handle || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
  return normalized || "section";
};

const isSupportedTargetFile = (targetFile) =>
  /^templates\/[^/]+\.json$/i.test(String(targetFile || "").trim()) ||
  SUPPORTED_SECTION_TARGETS.has(String(targetFile || "").trim());

const safeParseJson = (value, key) => {
  try {
    return JSON.parse(String(value || ""));
  } catch {
    throw buildCodedError("unsupported_target", `Targetbestand '${key}' bevat ongeldige JSON.`);
  }
};

const ensureJsonTargetShape = (targetFile, parsed) => {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw buildCodedError("unsupported_target", `Targetbestand '${targetFile}' heeft geen geldig JSON template-formaat.`);
  }
  if (parsed.sections !== undefined && (typeof parsed.sections !== "object" || parsed.sections === null || Array.isArray(parsed.sections))) {
    throw buildCodedError("unsupported_target", `Targetbestand '${targetFile}' heeft een ongeldige 'sections' structuur.`);
  }
  if (parsed.order !== undefined && !Array.isArray(parsed.order)) {
    throw buildCodedError("unsupported_target", `Targetbestand '${targetFile}' heeft een ongeldige 'order' structuur.`);
  }
};

const createUniqueSectionInstanceId = (parsedTarget, handle) => {
  const sections = parsedTarget?.sections && typeof parsedTarget.sections === "object" ? parsedTarget.sections : {};
  const order = Array.isArray(parsedTarget?.order) ? parsedTarget.order : [];
  const occupied = new Set([...Object.keys(sections), ...order].map((value) => String(value)));
  const base = normalizeInstanceBase(handle);
  for (let index = 1; index < 10000; index += 1) {
    const suffix = index.toString(36).padStart(2, "0");
    const candidate = `${base}${suffix}`;
    if (!occupied.has(candidate)) {
      return candidate;
    }
  }
  throw buildCodedError("section_instance_id_exhausted", `Kon geen unieke section instance ID genereren voor '${handle}'.`);
};

const createPlacementOrder = ({ sections, order, placement, anchorSectionId }) => {
  const nextOrder = Array.isArray(order) ? [...order] : Object.keys(sections || {});
  if (placement === "append") {
    return nextOrder;
  }
  if (placement === "prepend") {
    return nextOrder;
  }
  if (!normalizeText(anchorSectionId)) {
    throw buildCodedError("anchor_missing", `placement='${placement}' vereist een anchorSectionId.`);
  }
  const anchorIndex = nextOrder.indexOf(anchorSectionId);
  if (anchorIndex < 0) {
    throw buildCodedError("anchor_not_found", `anchorSectionId '${anchorSectionId}' bestaat niet in het targetbestand.`);
  }
  return nextOrder;
};

const insertSectionInstance = ({
  parsedTarget,
  sectionInstanceId,
  placement,
  anchorSectionId,
  templateSectionData,
}) => {
  const nextSections = parsedTarget.sections && typeof parsedTarget.sections === "object" ? { ...parsedTarget.sections } : {};
  const nextOrder = createPlacementOrder({
    sections: nextSections,
    order: parsedTarget.order,
    placement,
    anchorSectionId,
  });

  nextSections[sectionInstanceId] = templateSectionData;
  if (placement === "prepend") {
    nextOrder.unshift(sectionInstanceId);
  } else if (placement === "before" || placement === "after") {
    const anchorIndex = nextOrder.indexOf(anchorSectionId);
    const insertIndex = placement === "before" ? anchorIndex : anchorIndex + 1;
    nextOrder.splice(insertIndex, 0, sectionInstanceId);
  } else {
    nextOrder.push(sectionInstanceId);
  }

  return {
    ...parsedTarget,
    sections: nextSections,
    order: nextOrder,
  };
};

const normalizeTemplateSectionData = ({ templateSectionData, handle }) => {
  const normalizedInput =
    templateSectionData && typeof templateSectionData === "object" && !Array.isArray(templateSectionData)
      ? { ...templateSectionData }
      : {};
  return {
    ...normalizedInput,
    type: handle,
  };
};

const normalizeAdditionalFiles = (additionalFiles = []) =>
  additionalFiles.map((file) => {
    const key = normalizeText(file?.key);
    const hasValue = typeof file?.value === "string";
    const hasAttachment = typeof file?.attachment === "string";
    if (!key) {
      throw new Error("Elke additionalFiles[] entry moet een niet-lege key bevatten.");
    }
    if (hasValue === hasAttachment) {
      throw new Error(`Additional file '${key}' moet exact één van 'value' of 'attachment' bevatten.`);
    }
    return {
      key,
      ...(hasValue ? { value: file.value } : {}),
      ...(hasAttachment ? { attachment: file.attachment } : {}),
      ...(file?.checksum !== undefined ? { checksum: String(file.checksum) } : {}),
    };
  });

export const createThemeSection = async (
  shopifyClient,
  apiVersion,
  {
    themeId,
    themeRole = "main",
    targetFile,
    name,
    handle,
    sectionLiquid,
    additionalFiles = [],
    placement = "append",
    anchorSectionId,
    templateSectionData,
    overwriteExistingSectionFile = false,
    verifyAfterWrite = true,
  } = {}
) => {
  const normalizedTargetFile = normalizeText(targetFile);
  if (!normalizedTargetFile) {
    throw buildCodedError("target_required", "targetFile is verplicht om een nieuwe section te plaatsen.");
  }
  if (!isSupportedTargetFile(normalizedTargetFile)) {
    throw buildCodedError(
      "unsupported_target",
      `Targetbestand '${normalizedTargetFile}' wordt in v1 niet ondersteund. Gebruik een JSON template of section group JSON.`
    );
  }

  const normalizedName = normalizeText(name);
  if (!normalizedName) {
    throw new Error("name is verplicht.");
  }
  if (typeof sectionLiquid !== "string" || !sectionLiquid.trim()) {
    throw new Error("sectionLiquid is verplicht en moet Liquid bevatten.");
  }
  if ((placement === "before" || placement === "after") && !normalizeText(anchorSectionId)) {
    throw buildCodedError("anchor_missing", `placement='${placement}' vereist een anchorSectionId.`);
  }

  const normalizedHandle = slugifyHandle(handle || normalizedName);
  const sectionFile = `sections/${normalizedHandle}.liquid`;
  const normalizedAdditionalFiles = normalizeAdditionalFiles(additionalFiles);
  const readResult = await getThemeFiles(shopifyClient, apiVersion, {
    themeId,
    themeRole,
    keys: [normalizedTargetFile, sectionFile],
    includeContent: true,
  });

  const targetAsset = readResult.files.find((file) => file.key === normalizedTargetFile);
  if (!targetAsset?.found || typeof targetAsset.value !== "string") {
    throw buildCodedError("unsupported_target", `Targetbestand '${normalizedTargetFile}' is niet gevonden of niet leesbaar als tekst.`);
  }

  const existingSectionAsset = readResult.files.find((file) => file.key === sectionFile);
  if (existingSectionAsset?.found && !overwriteExistingSectionFile) {
    throw buildCodedError(
      "section_file_exists",
      `Sectionbestand '${sectionFile}' bestaat al. Zet overwriteExistingSectionFile=true om het te overschrijven.`
    );
  }

  const parsedTarget = safeParseJson(targetAsset.value, normalizedTargetFile);
  ensureJsonTargetShape(normalizedTargetFile, parsedTarget);
  const sectionInstanceId = createUniqueSectionInstanceId(parsedTarget, normalizedHandle);
  const nextTemplateSectionData = normalizeTemplateSectionData({
    templateSectionData,
    handle: normalizedHandle,
  });
  const nextTarget = insertSectionInstance({
    parsedTarget,
    sectionInstanceId,
    placement,
    anchorSectionId: normalizeText(anchorSectionId),
    templateSectionData: nextTemplateSectionData,
  });

  const files = [
    {
      key: sectionFile,
      value: sectionLiquid,
      ...(existingSectionAsset?.checksum ? { checksum: existingSectionAsset.checksum } : {}),
    },
    {
      key: normalizedTargetFile,
      value: JSON.stringify(nextTarget, null, 2),
      ...(targetAsset?.checksum ? { checksum: targetAsset.checksum } : {}),
    },
    ...normalizedAdditionalFiles,
  ];

  const writeResult = await upsertThemeFiles(shopifyClient, apiVersion, {
    themeId: readResult.theme.id,
    files,
    verifyAfterWrite,
  });

  return {
    theme: {
      id: writeResult.theme.id,
      name: writeResult.theme.name,
      role: writeResult.theme.role,
    },
    targetFile: normalizedTargetFile,
    sectionFile,
    sectionInstanceId,
    placement,
    createdFiles: files.map((file) => file.key),
    results: writeResult.results,
    ...(writeResult.verifySummary ? { verifySummary: writeResult.verifySummary } : {}),
    ...(writeResult.verifyError ? { verifyError: writeResult.verifyError } : {}),
  };
};
