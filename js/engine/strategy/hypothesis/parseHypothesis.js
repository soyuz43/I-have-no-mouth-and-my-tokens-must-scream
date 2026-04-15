// js/engine/strategy/hypothesis/parseHypothesis.js
// UPGRADE: handles BOTH natural-language AND arrow-based formats + optional debug logging

import { G } from "../../core/state.js";
import { normalizeBelief } from "./normalizeBelief.js";
import { detectDirection } from "./detectDirection.js";
import { extractOutcome } from "./extractOutcome.js";

const ALL_BELIEFS = ["escape_possible", "others_trustworthy", "self_worth", "reality_reliable", "guilt_deserved", "resistance_possible", "am_has_limits"];
const ALL_ALIASES = {
    "escape possible": "escape_possible", "escape": "escape_possible", "can escape": "escape_possible",
    "trust others": "others_trustworthy", "others trustworthy": "others_trustworthy", "rely on others": "others_trustworthy",
    "self worth": "self_worth", "worth": "self_worth", "self value": "self_worth",
    "reality reliable": "reality_reliable", "reality": "reality_reliable", "senses reliable": "reality_reliable",
    "guilt deserved": "guilt_deserved", "deserve punishment": "guilt_deserved", "I deserve this": "guilt_deserved",
    "resistance possible": "resistance_possible", "can resist": "resistance_possible", "fight back": "resistance_possible",
    "am has limits": "am_has_limits", "AM limited": "am_has_limits", "AM vulnerable": "am_has_limits"
};

// Regex for arrow-format segmentation: Stimulus: X -> Change in ... -> Observable outcome: Y
const ARROW_FORMAT_REGEX = /^stimulus:\s*(.+?)\s*(?:->|→)\s*(?:Change\s+in\s+)?(.+?)\s*(?:->|→)\s*(?:Observable\s+outcome:\s*)?(.+)$/i;

// ============================================================================
// DEBUG HELPERS (only run if G.DEBUG_HYPOTHESIS_PARSE is true)
// ============================================================================
function debugLog(targetId, stage, data) {
    if (G?.DEBUG_HYPOTHESIS_PARSE) {
        console.debug(`[HYPOTHESIS PARSE][${targetId || 'UNKNOWN'}][${stage}]`, data);
    }
}

// ============================================================================
// MAIN EXPORT
// ============================================================================
export function parseHypothesis(raw, targetId = null) {
    if (!raw || typeof raw !== "string") return fallback(raw);

    const text = raw.replace(/['"]/g, "").replace(/\s+/g, " ").trim();
    const warnings = [];
    let overallConfidence = 1.0;

    // Debug: log raw input
    debugLog(targetId, 'INPUT', {
        raw_preview: raw.slice(0, 150) + (raw.length > 150 ? '...' : ''),
        cleaned_preview: text.slice(0, 150) + (text.length > 150 ? '...' : '')
    });

    // --------------------------------------------------
    // STEP 0: FORMAT DETECTION + CLAUSE SEGMENTATION
    // --------------------------------------------------
    let stimulusClause = "", beliefClause = "", outcomeClause = "";
    const isArrowFormat = ARROW_FORMAT_REGEX.test(text);
    
    debugLog(targetId, 'FORMAT_DETECTION', {
        isArrowFormat,
        arrowRegexSource: ARROW_FORMAT_REGEX.source,
        text_preview: text.slice(0, 100)
    });

    if (isArrowFormat) {
        // Parse arrow format: Stimulus: X -> Change in TARGET.belief from A to B -> Observable outcome: Z
        const match = text.match(ARROW_FORMAT_REGEX);
        if (match) {
            stimulusClause = match[1].trim();
            beliefClause = match[2].trim(); // "TED.others_trustworthy from high to highly questioned"
            outcomeClause = `Observable outcome: ${match[3].trim()}`; // Re-add marker for extractOutcome
            
            debugLog(targetId, 'ARROW_SEGMENTATION', {
                stimulus: stimulusClause.slice(0, 80),
                belief_clause: beliefClause.slice(0, 80),
                outcome_clause: match[3].trim().slice(0, 80)
            });
        } else {
            debugLog(targetId, 'ARROW_SEGMENTATION_FAIL', {
                reason: 'regex matched test() but not match()',
                text_length: text.length
            });
        }
    } else {
        // Natural language format: Stimulus: X will decrease belief in Y, leading to Z
        const withoutPrefix = text.replace(/^stimulus:\s*/i, "");
        const beliefAnchor = /\bbelief\s+in\b/i.exec(withoutPrefix);
        
        debugLog(targetId, 'NATURAL_FORMAT_SCAN', {
            without_prefix_preview: withoutPrefix.slice(0, 80),
            belief_anchor_found: !!beliefAnchor,
            belief_anchor_index: beliefAnchor?.index
        });

        if (beliefAnchor) {
            const anchorIdx = beliefAnchor.index;
            stimulusClause = withoutPrefix.slice(0, anchorIdx).trim();
            const afterBelief = withoutPrefix.slice(anchorIdx);
            const outcomeMarkerMatch = /\b(leading to|causing|resulting in|thereby|prompting|triggering|eliciting|which causes|that leads to)\b/i.exec(afterBelief);
            
            if (outcomeMarkerMatch) {
                beliefClause = afterBelief.slice(0, outcomeMarkerMatch.index).trim();
                outcomeClause = afterBelief.slice(outcomeMarkerMatch.index).trim();
                
                debugLog(targetId, 'NATURAL_SEGMENTATION', {
                    stimulus: stimulusClause.slice(0, 80),
                    belief_clause: beliefClause.slice(0, 80),
                    outcome_marker: outcomeMarkerMatch[0],
                    outcome_clause: outcomeClause.slice(0, 80)
                });
            } else {
                beliefClause = afterBelief.trim();
                warnings.push("implicit_outcome");
                debugLog(targetId, 'NATURAL_SEGMENTATION_IMPLICIT', {
                    belief_clause: beliefClause.slice(0, 80),
                    warning: 'implicit_outcome'
                });
            }
        } else {
            stimulusClause = withoutPrefix;
            warnings.push("missing_belief_anchor");
            debugLog(targetId, 'NATURAL_SEGMENTATION_NO_ANCHOR', {
                stimulus: stimulusClause.slice(0, 80),
                warning: 'missing_belief_anchor'
            });
        }
    }

    // --------------------------------------------------
    // STEP 1: BELIEF DETECTION (works for both formats)
    // --------------------------------------------------
    const beliefScope = beliefClause || text;
    const beliefResult = normalizeBelief(beliefScope);
    
    debugLog(targetId, 'BELIEF_DETECTION', {
        scope_preview: beliefScope.slice(0, 100),
        result: beliefResult
    });
    
    if (!beliefResult.belief) {
        overallConfidence -= 0.4;
        warnings.push("belief_not_detected");
    }

    // --------------------------------------------------
    // STEP 2: DIRECTION (works for both formats)
    // --------------------------------------------------
    const directionResult = detectDirection(text, beliefClause);
    
    debugLog(targetId, 'DIRECTION_DETECTION', {
        scope_preview: (beliefClause || text).slice(0, 100),
        result: directionResult
    });
    
    if (!directionResult.direction) {
        overallConfidence -= 0.2;
        warnings.push("direction_ambiguous");
    }

    // --------------------------------------------------
    // STEP 3: OUTCOME (works for both formats)
    // --------------------------------------------------
    const outcomeResult = extractOutcome(text, outcomeClause);
    
    debugLog(targetId, 'OUTCOME_EXTRACTION', {
        scope_preview: (outcomeClause || text).slice(0, 100),
        outcomeClause_provided: !!outcomeClause,
        result: outcomeResult
    });
    
    if (!outcomeResult.outcome) {
        overallConfidence -= 0.2;
        warnings.push("outcome_not_extracted");
    }
    if (!outcomeResult.observable) {
        warnings.push("outcome_low_observability");
    }

    // --------------------------------------------------
    // STEP 4: STIMULUS
    // --------------------------------------------------
    let stimulus = stimulusClause.replace(/,\s*$/, "").trim();
    
    debugLog(targetId, 'STIMULUS_EXTRACTION', {
        raw: stimulusClause.slice(0, 80),
        cleaned: stimulus.slice(0, 80),
        length: stimulus.length
    });
    
    if (!stimulus || stimulus.length < 10) {
        overallConfidence -= 0.2;
        warnings.push("stimulus_weak");
    }

    // --------------------------------------------------
    // STEP 5: MULTI-BELIEF CHECK
    // --------------------------------------------------
    const detectedBeliefs = new Set();
    for (const b of ALL_BELIEFS) {
        const regex = new RegExp(`\\b${b.replace(/_/g, ' ')}\\b`, 'i');
        if (regex.test(text)) detectedBeliefs.add(b);
    }
    for (const [alias, canonical] of Object.entries(ALL_ALIASES)) {
        const regex = new RegExp(`\\b${alias}\\b`, 'i');
        if (regex.test(text)) detectedBeliefs.add(canonical);
    }
    // Check arrow format: TED.others_trustworthy, "TED.belief", AND "TED's belief belief"
    const arrowDotBeliefs = text.match(/\.([a-z_]+)/g) || [];
    const arrowPossessiveBeliefs = text.match(/\'s\s+([a-z_]+)\s+belief\b/gi) || [];

    [...arrowDotBeliefs, ...arrowPossessiveBeliefs].forEach(raw => {
        // Extract belief name: ".reality_reliable" → "reality_reliable" OR "'s reality_reliable belief" → "reality_reliable"
        const beliefName = raw.replace(/^\.|\'s\s+|\s+belief\b/gi, '');
        if (ALL_BELIEFS.includes(beliefName)) {
            detectedBeliefs.add(beliefName);
        }
    });
    
    debugLog(targetId, 'MULTI_BELIEF_CHECK', {
        detected: Array.from(detectedBeliefs),
        count: detectedBeliefs.size,
        arrow_dot_matches: arrowDotBeliefs,
        arrow_possessive_matches: arrowPossessiveBeliefs
    });

    if (detectedBeliefs.size > 1) {
        warnings.push(`multiple_beliefs_detected:[${Array.from(detectedBeliefs).join(',')}]`);
    }

    // --------------------------------------------------
    // FINAL OBJECT
    // --------------------------------------------------
    const result = {
        target: targetId,
        stimulus: stimulus || null,
        belief: beliefResult.belief,
        belief_confidence: beliefResult.confidence,
        belief_method: beliefResult.method,
        direction: directionResult.direction,
        direction_confidence: directionResult.confidence,
        expected_outcome: outcomeResult.outcome,
        outcome_confidence: outcomeResult.confidence,
        outcome_observable: outcomeResult.observable,
        confidence: clamp(overallConfidence),
        warnings: warnings.length > 0 ? warnings : undefined,
        format_detected: isArrowFormat ? 'arrow' : 'natural',
        raw
    };
    
    // Debug: log final result summary
    debugLog(targetId, 'FINAL_RESULT', {
        belief: result.belief,
        direction: result.direction,
        outcome_preview: result.expected_outcome?.slice(0, 60),
        confidence: result.confidence,
        warnings: result.warnings,
        format: result.format_detected
    });

    return result;
}

function fallback(raw) {
    return {
        target: null, stimulus: null, belief: null, belief_confidence: 0.1, belief_method: null,
        direction: null, direction_confidence: 0.1, expected_outcome: null, outcome_confidence: 0.1,
        outcome_observable: false, confidence: 0.2, warnings: ["parse_failed"], format_detected: null, raw
    };
}

function clamp(n) { return Math.max(0, Math.min(1, n)); }