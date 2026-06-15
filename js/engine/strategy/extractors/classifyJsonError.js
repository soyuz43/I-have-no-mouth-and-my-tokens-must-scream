// filepath: js/engine/strategy/extractors/classifyJsonError.js

export function classifyJsonError(str) {
  if (typeof str !== "string") {
    return "invalid_input";
  }

  // Known strategy fields using JavaScript-style single-quoted
  // values instead of valid JSON double-quoted values.
  //
  // Example:
  //   "hypothesis": 'This is not valid JSON'
  if (
    /"(?:id|objective|hypothesis|evidence|why_now)"\s*:\s*'/i.test(str)
  ) {
    return "single_quoted_value";
  }

  // Missing comma between properties.
  if (/":\s*"[^"]*"\s*\n\s*"/.test(str)) {
    return "missing_comma";
  }

  // Adjacent objects without a separating comma.
  if (/}\s*{/.test(str)) {
    return "structural_merge";
  }

  // Foreign structured token, such as:
  // GroupLayout: [...]
  if (/^[A-Za-z_]+\s*:\s*\[[^\]]*\]/m.test(str)) {
    return "foreign_structure";
  }

  // Truncation indicated by unbalanced object braces.
  const openBraces = (str.match(/{/g) || []).length;
  const closeBraces = (str.match(/}/g) || []).length;

  if (openBraces !== closeBraces) {
    return "truncated";
  }

  // Trailing comma after a final object.
  if (/},\s*$/.test(str)) {
    return "trailing_comma";
  }

  return "unknown";
}

