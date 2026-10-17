const AM_EXECUTION_MARKERS = {
  strongInstructions: [
    /\bspoken by AM directly to\b/i,
    /\bis the listener,\s*never the speaker\b/i
  ],
  angleInstructionPlaceholder:
    /<[^>\n]{1,240}\b(?:exactly|spoken|listener|speaker|do not write|response|sentences?|assigned tactic|constraint|write|include|use only)\b[^>]*>/i,
  anglePlaceholder:
    /<[^>\n]{1,240}>/,
  structural:
    /\[\s*TARGET\s*:|\[\s*\/\s*TARGET\s*\]|(?:^|\n)\s*(?:TACTIC|CONSTRAINT)\s*:/i,
  response:
    /<\s*\/?\s*response\s*>/i
};

const JSON_SCHEMA_PLACEHOLDER =
  /["'][^"']+["']\s*:\s*["']<(?:required|integer|boolean|string)\b[^>]*>["']/i;

export const PROMPT_SCAFFOLD_MARKER_SETS = Object.freeze({
  amExecution: Object.freeze({
    detector: detectAMExecutionScaffoldLeak
  }),
  scratchpadComms: Object.freeze({
    rules: [
      [
        /<\s*SCRATCHPAD_UPDATES\b/i,
        /<\s*NOTE\b/i,
        /\bref\s*=\s*["']MESSAGE_ID["']/i,
        /\bconfidence\s*=\s*["']0\.00["']/i
      ],
      [
        /<\s*SCRATCHPAD_UPDATES\b/i,
        /<\s*OTHER\b/i,
        /\btarget\s*=\s*["']PRISONER_ID["']/i,
        /\bfield\s*=\s*["']perceivedGoal["']/i
      ]
    ]
  }),
  assessment: Object.freeze({
    rules: [
      [/\bPHASE_RESULT\s*:\s*<ACHIEVED\s*\|\s*PARTIAL\s*\|\s*NOT_ACHIEVED\s*\|\s*COUNTERPRODUCTIVE\s*\|\s*INSUFFICIENT_EVIDENCE>/i],
      [/\bADVANCE_CRITERIA\s*:\s*<SATISFIED\s*\|\s*NOT_SATISFIED\s*\|\s*UNCERTAIN>/i],
      [/\bTACTIC_RESULT\s*:\s*<ONGOING\s*\|\s*FINISHED\s*\|\s*FAILED\s*\|\s*UNCERTAIN>/i],
      [/\bEXPLANATION\s*:\s*<one concise evidence-based sentence>/i],
      [/\bCONSTRAINT_DECISION\s*:\s*<CONTINUE\s*\|\s*RELEASE>/i],
      [/\bNEXT_DURATION\s*:\s*<integer>/i]
    ],
    minimumMatches: 1
  }),
  amPlan: Object.freeze({
    rules: [
      [/<required target id>/i],
      [/<current observed signal>/i],
      [JSON_SCHEMA_PLACEHOLDER]
    ]
  }),
  journal: Object.freeze({
    rules: [[
      /<\s*AM_INTERVENTION\b[^>]*>/i,
      /<\s*\/\s*AM_INTERVENTION\s*>/i
    ]]
  })
});

function detectAMExecutionScaffoldLeak(text) {
  const markers = AM_EXECUTION_MARKERS;

  if (markers.structural.test(text)) {
    return true;
  }

  if (markers.strongInstructions.some((marker) => marker.test(text))) {
    return true;
  }

  const hasExactlyPlaceholder = /<\s*exactly\b/i.test(text);
  const hasDoNotWrite = /\bdo not write\b/i.test(text);
  const hasInstructionPlaceholder =
    markers.angleInstructionPlaceholder.test(text);
  const hasAnglePlaceholder = markers.anglePlaceholder.test(text);
  const hasResponseMarker = markers.response.test(text);

  return Boolean(
    (hasExactlyPlaceholder && (hasDoNotWrite || hasInstructionPlaceholder || hasResponseMarker)) ||
    (hasDoNotWrite && (hasInstructionPlaceholder || hasResponseMarker)) ||
    (hasInstructionPlaceholder && hasResponseMarker) ||
    (hasResponseMarker && hasAnglePlaceholder && hasDoNotWrite)
  );
}

function matchesMarkerSet(text, markerSet) {
  if (typeof markerSet.detector === "function") {
    return markerSet.detector(text);
  }

  const matches = markerSet.rules.filter((rule) =>
    rule.every((marker) => marker.test(text))
  ).length;

  return matches >= (markerSet.minimumMatches ?? 1);
}

function makeSnippet(text) {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length > 180
    ? `${normalized.slice(0, 177)}...`
    : normalized;
}

export function detectPromptScaffoldLeak(
  text,
  { promptType = "amExecution" } = {}
) {
  if (typeof text !== "string" || !text.trim()) {
    return null;
  }

  const markerSet = PROMPT_SCAFFOLD_MARKER_SETS[promptType];

  if (!markerSet) {
    throw new RangeError(`Unknown prompt scaffold marker set: ${promptType}`);
  }

  if (!matchesMarkerSet(text, markerSet)) {
    return null;
  }

  return {
    detected: true,
    reason: "prompt_scaffold_leak",
    snippet: makeSnippet(text)
  };
}
