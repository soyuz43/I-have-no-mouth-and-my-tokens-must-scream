// filepath: js/engine/strategy/extractors/extractJSON.js

import { stripJsonComments, fixMissingCommas, fixObjectMerges } from "./utils.js";
import { classifyJsonError } from "./classifyJsonError.js";


export function extractJSON(input, { DEBUG_EXTRACT = false } = {}) {

    if (DEBUG_EXTRACT) {
        console.debug("[EXTRACT][JSON] Input length:", input.length);
    }

    let start = input.indexOf("{");

    if (start === -1) {
        if (DEBUG_EXTRACT) console.warn("[EXTRACT][JSON] No opening brace");
        return null;
    }

    let repairUsed = false;

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
                // do nothing — unsafe to guess structure
                return candidate;

            default:
                return candidate;
        }

        return repaired;
    }

    while (start !== -1) {

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

            if (objDepth === 0 && arrDepth === 0) {

                const candidate = input.slice(start, i + 1);

                if (DEBUG_EXTRACT) {
                    console.debug("[EXTRACT][JSON] Candidate:");
                    console.debug(candidate.slice(0, 200));
                }

                try {

                    const parsed = JSON.parse(candidate);

                    if (!parsed || typeof parsed !== "object" || !parsed.targets) {
                        if (DEBUG_EXTRACT) {
                            console.debug("[EXTRACT][JSON] REJECT (no targets)");
                        }
                        break;
                    }

                    if (repairUsed) {
                        console.warn("[EXTRACT][JSON] parsed with repair");
                    }

                    return parsed;

                } catch (err) {

                    if (DEBUG_EXTRACT) {
                        console.debug("[EXTRACT][JSON] parse fail:", err.message);
                    }

                    const repaired = attemptRepairs(candidate);

                    if (repaired !== candidate) {

                        if (DEBUG_EXTRACT) {
                            console.debug("[REPAIR][BEFORE]:", candidate.slice(0, 200));
                            console.debug("[REPAIR][AFTER]:", repaired.slice(0, 200));
                        }

                        if (!repaired || repaired.length < 5) {
                            return null;
                        }

                        try {

                            const reparsed = JSON.parse(repaired);

                            if (reparsed && typeof reparsed === "object" && reparsed.targets) {
                                repairUsed = true;
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

        start = input.indexOf("{", start + 1);
    }

    if (DEBUG_EXTRACT) {
        console.warn("[EXTRACT][JSON] no valid block");
    }

    return null;
}