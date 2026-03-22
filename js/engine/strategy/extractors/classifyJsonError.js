// filepath: js/engine/strategy/extractors/classifyJsonError.js

export function classifyJsonError(str) {

  // missing comma between properties
  if (/":\s*"[^"]*"\s*\n\s*"/.test(str)) {
    return "missing_comma";
  }

  // object merge
  if (/}\s*{/.test(str)) {
    return "structural_merge";
  }

  // truncation (unbalanced braces)
  const openBraces = (str.match(/{/g) || []).length;
  const closeBraces = (str.match(/}/g) || []).length;

  if (openBraces !== closeBraces) {
    return "truncated";
  }

  return "unknown";
}