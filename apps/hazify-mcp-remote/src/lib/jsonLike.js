const normalizeSource = (value) =>
  String(value || "").replace(/^\uFEFF/, "");

export function stripJsonComments(value) {
  const source = normalizeSource(value);
  let result = "";
  let inString = false;
  let escaped = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let index = 0; index < source.length; index += 1) {
    const current = source[index];
    const next = source[index + 1];

    if (inLineComment) {
      if (current === "\n" || current === "\r") {
        inLineComment = false;
        result += current;
      } else {
        result += " ";
      }
      continue;
    }

    if (inBlockComment) {
      if (current === "*" && next === "/") {
        result += "  ";
        index += 1;
        inBlockComment = false;
      } else {
        result += current === "\n" || current === "\r" ? current : " ";
      }
      continue;
    }

    if (inString) {
      result += current;
      if (escaped) {
        escaped = false;
      } else if (current === "\\") {
        escaped = true;
      } else if (current === "\"") {
        inString = false;
      }
      continue;
    }

    if (current === "\"") {
      inString = true;
      result += current;
      continue;
    }

    if (current === "/" && next === "/") {
      result += "  ";
      index += 1;
      inLineComment = true;
      continue;
    }

    if (current === "/" && next === "*") {
      result += "  ";
      index += 1;
      inBlockComment = true;
      continue;
    }

    result += current;
  }

  return result;
}

export function stripJsonTrailingCommas(value) {
  const source = String(value || "");
  let result = "";
  let inString = false;
  let escaped = false;

  for (let index = 0; index < source.length; index += 1) {
    const current = source[index];

    if (inString) {
      result += current;
      if (escaped) {
        escaped = false;
      } else if (current === "\\") {
        escaped = true;
      } else if (current === "\"") {
        inString = false;
      }
      continue;
    }

    if (current === "\"") {
      inString = true;
      result += current;
      continue;
    }

    if (current === ",") {
      let lookahead = index + 1;
      while (lookahead < source.length && /\s/.test(source[lookahead])) {
        lookahead += 1;
      }
      if (lookahead < source.length && (source[lookahead] === "}" || source[lookahead] === "]")) {
        continue;
      }
    }

    result += current;
  }

  return result;
}

export function normalizeJsonLike(value) {
  return stripJsonTrailingCommas(stripJsonComments(normalizeSource(value)));
}

export function parseJsonLike(value) {
  return JSON.parse(normalizeJsonLike(value));
}
