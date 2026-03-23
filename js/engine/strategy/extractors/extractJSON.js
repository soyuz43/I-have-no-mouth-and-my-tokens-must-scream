// js/engine/strategy/extractors/extractJSON.js

import { stripJsonComments, fixMissingCommas, fixObjectMerges } from "./utils.js";
import { classifyJsonError } from "./classifyJsonError.js";


export function extractJSON(input, { DEBUG_EXTRACT = false } = {}) {

    if (DEBUG_EXTRACT) {
        console.debug("[EXTRACT][JSON] Input length:", input.length);
    }

    // collect all possible JSON starts
    const starts = [];
    for (let i = 0; i < input.length; i++) {
        if (input[i] === "{") {
            starts.push(i);
        }
        if (input[i] === "[") {
            starts.push(i);
        }
    }

    if (starts.length === 0) {
        if (DEBUG_EXTRACT) console.warn("[EXTRACT][JSON] No JSON start found");
        return null;
    }

    function attemptRepairs(candidate) {

        const errorType = classifyJsonError(candidate);

        let repaired = candidate;

        if (DEBUG_EXTRACT) {
            console.debug("[REPAIR] classified as:", errorType);
        }

        // always safe
        repaired = stripJsonComments(repaired);

        switch (errorType) {

            case "missing_comma":
                repaired = fixMissingCommas(repaired);
                break;

            case "structural_merge":
                repaired = fixObjectMerges(repaired);
                break;

            case "truncated":
                return candidate;

            default:
                return candidate;
        }

        return repaired;
    }

    // scan each possible start
    for (const start of starts) {

        let objDepth = 0;
        let arrDepth = 0;
        let inString = false;
        let escape = false;

        for (let i = start; i < input.length; i++) {

            const ch = input[i];

            if (escape) {
                escape = false;
                continue;
            }

            if (ch === "\\") {
                escape = true;
                continue;
            }

            if (ch === '"') {
                inString = !inString;
                continue;
            }

            if (inString) continue;

            if (ch === "{") objDepth++;
            if (ch === "}") objDepth--;

            if (ch === "[") arrDepth++;
            if (ch === "]") arrDepth--;

            // candidate complete
            if (objDepth === 0 && arrDepth === 0) {

                const candidate = input.slice(start, i + 1).trim();

                if (DEBUG_EXTRACT) {
                    console.debug("[EXTRACT][JSON] Candidate:");
                    console.debug(candidate.slice(0, 200));
                }

                // sanity check
                if (!candidate.endsWith("}") && !candidate.endsWith("]")) {
                    if (DEBUG_EXTRACT) {
                        console.debug("[EXTRACT][JSON] reject (not properly closed)");
                    }
                    break;
                }

                // --------------------------
                // PARSE ATTEMPT
                // --------------------------
                try {

                    const parsed = JSON.parse(candidate);

                    // ARRAY ROOT → normalize
                    if (Array.isArray(parsed)) {
                        return { targets: parsed };
                    }

                    // OBJECT ROOT → expected
                    if (parsed && typeof parsed === "object" && parsed.targets) {
                        return parsed;
                    }

                    // valid JSON but not usable
                    break;

                } catch (err) {

                    if (DEBUG_EXTRACT) {
                        console.debug("[EXTRACT][JSON] parse fail:", err.message);
                    }

                    // --------------------------
                    // REPAIR ATTEMPT
                    // --------------------------
                    const repaired = attemptRepairs(candidate);

                    if (repaired !== candidate) {

                        if (DEBUG_EXTRACT) {
                            console.debug("[REPAIR][BEFORE]:", candidate.slice(0, 200));
                            console.debug("[REPAIR][AFTER]:", repaired.slice(0, 200));
                        }

                        try {

                            const reparsed = JSON.parse(repaired);

                            if (Array.isArray(reparsed)) {
                                if (DEBUG_EXTRACT) {
                                    console.warn("[EXTRACT][JSON] parsed with repair (array root)");
                                }
                                return { targets: reparsed };
                            }

                            if (reparsed && typeof reparsed === "object" && reparsed.targets) {
                                if (DEBUG_EXTRACT) {
                                    console.warn("[EXTRACT][JSON] parsed with repair (object root)");
                                }
                                return reparsed;
                            }

                        } catch (e2) {
                            if (DEBUG_EXTRACT) {
                                console.debug("[REPAIR] failed:", e2.message);
                            }
                        }
                    }

                    break;
                }
            }
        }
    }

    if (DEBUG_EXTRACT) {
        console.warn("[EXTRACT][JSON] no valid block");
    }

    return null;
}