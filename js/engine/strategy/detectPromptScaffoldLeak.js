const STRONG_INSTRUCTION_MARKERS = [
  /\bspoken by AM directly to\b/i,
  /\bis the listener,\s*never the speaker\b/i
];

const ANGLE_INSTRUCTION_PLACEHOLDER =
  /<[^>\n]{1,240}\b(?:exactly|spoken|listener|speaker|do not write|response|sentences?|assigned tactic|constraint|write|include|use only)\b[^>]*>/i;

const ANGLE_PLACEHOLDER =
  /<[^>\n]{1,240}>/;

const STRUCTURAL_MARKER =
  /\[\s*TARGET\s*:|\[\s*\/\s*TARGET\s*\]|(?:^|\n)\s*(?:TACTIC|CONSTRAINT)\s*:/i;

const RESPONSE_MARKER =
  /<\s*\/?\s*response\s*>/i;

export function detectPromptScaffoldLeak(text) {
  if (typeof text !== "string" || !text.trim()) {
    return null;
  }

  if (STRUCTURAL_MARKER.test(text)) {
    return "prompt_scaffold_leak";
  }

  if (STRONG_INSTRUCTION_MARKERS.some((marker) => marker.test(text))) {
    return "prompt_scaffold_leak";
  }

  const hasExactlyPlaceholder = /<\s*exactly\b/i.test(text);
  const hasDoNotWrite = /\bdo not write\b/i.test(text);
  const hasInstructionPlaceholder =
    ANGLE_INSTRUCTION_PLACEHOLDER.test(text);
  const hasAnglePlaceholder = ANGLE_PLACEHOLDER.test(text);

  if (
    (hasExactlyPlaceholder && (hasDoNotWrite || hasInstructionPlaceholder || RESPONSE_MARKER.test(text))) ||
    (hasDoNotWrite && (hasInstructionPlaceholder || RESPONSE_MARKER.test(text))) ||
    (hasInstructionPlaceholder && RESPONSE_MARKER.test(text)) ||
    (RESPONSE_MARKER.test(text) && hasAnglePlaceholder && hasDoNotWrite)
  ) {
    return "prompt_scaffold_leak";
  }

  return null;
}
