// filepath: js/engine/strategy/extractors/classifyJsonError.js

export function classifyJsonError(str) {
  if (typeof str !== "string") {
    return "invalid_input";
  }

  // 1. Unescaped newlines inside strings (Very common LLM error)
  // Causes: "Bad control character in string literal"
  if (/:\s*"[^"]*\n[^"]*"/.test(str) || /:\s*'[^']*\n[^']*'/.test(str)) {
    return "unescaped_newline_in_string";
  }

  // 2. Trailing commas before closing braces/brackets
  // Causes: "expected double-quoted property name" (it expects a new key after the comma)
  if (/,\s*[}\]]/.test(str)) {
    return "trailing_comma";
  }

  // 3. Byte Order Mark (BOM) or zero-width chars at the very start
  // Causes: "unexpected token  in JSON at position 0"
  if (/^[\uFEFF\u200B\u200C\u200D]/.test(str)) {
    return "invisible_leading_characters";
  }

  // 4. Single quotes used as JSON delimiters (Keys or Values)
  // Causes: "expected double-quoted property name"
  if (/^\s*{\s*'/.test(str) || /,\s*'/.test(str)) {
    return "single_quoted_delimiter";
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

  // Unicode “smart quotes” used as JSON string/property delimiters
  // causes: "expected double-quoted property name"
  if (/[\u201C\u201D]/.test(str)) {
    return "unicode_quotes";
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

