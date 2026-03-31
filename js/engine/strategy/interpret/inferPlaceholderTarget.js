// js/engine/strategy/interpret/inferPlaceholderTarget.js

/* ============================================================
   PLACEHOLDER TARGET INFERENCE

   PURPOSE:
   Resolve placeholder IDs (e.g. <TARGET>, UNKNOWN, etc.)
   by inferring the most likely SIM_ID from surrounding fields.

   DESIGN PRINCIPLES:
   - Behavior must match legacy parser EXACTLY
   - Weighted scoring (objective > evidence > hypothesis > why_now)
   - Strict thresholds (reject weak or ambiguous signals)
   - No mutation — returns result only
   ============================================================ */

export function inferPlaceholderTarget({
  rawId,
  objective,
  evidence,
  hypothesis,
  why_now,
  SIM_IDS,
  DEBUG = false
}) {

  /* ------------------------------------------------------------
     PLACEHOLDER DETECTION
  ------------------------------------------------------------ */

  const TOKENS = [
    "NAME", "PRISONER", "SIM", "TARGET",
    "SUBJECT", "ID", "UNKNOWN", "HOLDER",
    "PERSON", "INDIVIDUAL", "AGENT", "ENTITY"
  ];

  const placeholderPatterns = TOKENS.flatMap(t => ([
    new RegExp(`^<\\s*${t}\\s*>$`, "i"),
    new RegExp(`^${t}$`, "i"),
    new RegExp(`^\\[\\s*${t}\\s*\\]$`, "i"),
    new RegExp(`^\\(\\s*${t}\\s*\\)$`, "i"),
    new RegExp(`^${t}[_\\d]*$`, "i"),
  ]));

  const isPlaceholder = placeholderPatterns.some(pattern =>
    pattern.test((rawId || "").trim())
  );

  if (!isPlaceholder) return null;

  console.warn(`[PARSER] Placeholder ID detected: "${rawId}" – attempting weighted inference.`);

  /* ------------------------------------------------------------
     NORMALIZATION (FOR TEXT FIELDS ONLY)
  ------------------------------------------------------------ */

  const norm = (s) => (s || "")
    .toUpperCase()
    .replace(/'S\b/g, "")
    .replace(/[^A-Z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const fields = {
    objective: norm(objective),
    evidence: norm(evidence),
    hypothesis: norm(hypothesis),
    why_now: norm(why_now),
  };

  /* ------------------------------------------------------------
     PRECOMPILE NAME REGEX
  ------------------------------------------------------------ */

  const NAME_REGEX = {};
  SIM_IDS.forEach(name => {
    NAME_REGEX[name] = new RegExp(`\\b${name}\\b`, "g");
  });

  const count = (str, name) =>
    (str.match(NAME_REGEX[name]) || []).length;

  /* ------------------------------------------------------------
     WEIGHTED SCORING
  ------------------------------------------------------------ */

  const score = {};
  SIM_IDS.forEach(name => { score[name] = 0; });

  SIM_IDS.forEach(name => {
    score[name] += count(fields.objective, name) * 3;
    score[name] += count(fields.evidence, name) * 2;
    score[name] += count(fields.hypothesis, name) * 1;
    score[name] += count(fields.why_now, name) * 1;
  });

  if (DEBUG) {
    console.debug("[PARSER][SCORES]", score);
  }

  /* ------------------------------------------------------------
     RANKING
  ------------------------------------------------------------ */

  const ranked = Object.entries(score)
    .filter(([_, v]) => v > 0)
    .sort((a, b) => b[1] - a[1]);

  if (ranked.length === 0) {
    console.warn(`[PARSER] No valid target found in fields – skipping target.`);
    return null;
  }

  const [topName, topScore] = ranked[0];
  const secondScore = ranked[1]?.[1] || 0;

  /* ------------------------------------------------------------
     THRESHOLDS
  ------------------------------------------------------------ */

  const MIN_SCORE = 2;
  const DOMINANCE_RATIO = 1.5;

  /* ------------------------------------------------------------
     CONFIDENCE CALCULATION
  ------------------------------------------------------------ */

  const dominance = secondScore === 0 ? 1 : (topScore / secondScore);
  const strength = Math.min(1, topScore / 6);
  const confidence = Math.min(1, dominance * strength);

  /* ------------------------------------------------------------
     DECISION LOGIC
  ------------------------------------------------------------ */

  if (topScore < MIN_SCORE) {
    console.warn(`[PARSER] Weak signal (score=${topScore}) – skipping target.`);
    return null;
  }

  if (dominance < DOMINANCE_RATIO) {
    console.warn(
      `[PARSER] Ambiguous targets: ${ranked
        .map(([n, v]) => `${n}:${v}`)
        .join(", ")} – skipping target.`
    );
    return null;
  }

  /* ------------------------------------------------------------
     SUCCESS
  ------------------------------------------------------------ */

  console.warn(
    `[PARSER] Inferred target: ${topName} (score=${topScore}, confidence=${confidence.toFixed(2)})`
  );

  return {
    id: topName,
    confidence
  };
}