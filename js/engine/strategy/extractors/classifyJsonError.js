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
  
  // foreign structured token (e.g. GroupLayout)
  if (/^[A-Za-z_]+\s*:\s*\[[^\]]*\]/m.test(str)) {
    return "foreign_structure";
  }
  // truncation (unbalanced braces)
  const openBraces = (str.match(/{/g) || []).length;
  const closeBraces = (str.match(/}/g) || []).length;

  if (openBraces !== closeBraces) {
    return "truncated";
  }

  return "unknown";
}