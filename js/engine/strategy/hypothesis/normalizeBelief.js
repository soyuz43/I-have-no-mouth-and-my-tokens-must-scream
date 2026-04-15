// js/engine/strategy/hypothesis/normalizeBelief.js
// UPGRADE: supports BOTH natural-language AND arrow-based hypothesis formats

const BELIEFS = [
    "escape_possible", "others_trustworthy", "self_worth",
    "reality_reliable", "guilt_deserved", "resistance_possible", "am_has_limits"
];

const ALIASES = {
    "escape possible": "escape_possible", "escape": "escape_possible", "can escape": "escape_possible",
    "trust others": "others_trustworthy", "others trustworthy": "others_trustworthy", "rely on others": "others_trustworthy",
    "self worth": "self_worth", "worth": "self_worth", "self value": "self_worth",
    "reality reliable": "reality_reliable", "reality": "reality_reliable", "senses reliable": "reality_reliable",
    "guilt deserved": "guilt_deserved", "deserve punishment": "guilt_deserved", "I deserve this": "guilt_deserved",
    "resistance possible": "resistance_possible", "can resist": "resistance_possible", "fight back": "resistance_possible",
    "am has limits": "am_has_limits", "AM limited": "am_has_limits", "AM vulnerable": "am_has_limits"
};

// Arrow-format belief patterns: TED.others_trustworthy, BENNY.reality_reliable, etc.
const ARROW_BELIEF_REGEX = /(?:\.([a-z_]+)\b|\'s\s+([a-z_]+)\s+belief\b)/i;

function levenshtein(a, b) {
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;
    const matrix = [];
    for (let i = 0; i <= b.length; i++) matrix[i] = [i];
    for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
    for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
            if (b.charAt(i - 1) === a.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(matrix[i - 1][j - 1] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j] + 1);
            }
        }
    }
    return matrix[b.length][a.length];
}

export function normalizeBelief(text) {
    const lower = text.toLowerCase();

    // --- FORMAT 1: Arrow-based (TED.others_trustworthy OR TED's others_trustworthy belief) ---
    const arrowMatch = text.match(ARROW_BELIEF_REGEX);
    if (arrowMatch) {
        // Match group 1: "TED.belief_name" | Match group 2: "TED's belief_name belief"
        const rawBelief = arrowMatch[1] || arrowMatch[2];

        if (rawBelief && BELIEFS.includes(rawBelief)) {
            return { belief: rawBelief, matchIndex: arrowMatch.index, confidence: 1.0, method: 'arrow_exact' };
        }
        // Check aliases for arrow format
        for (const [alias, canonical] of Object.entries(ALIASES)) {
            if (alias.replace(/\s+/g, '_') === rawBelief) {
                return { belief: canonical, matchIndex: arrowMatch.index, confidence: 0.9, method: 'arrow_alias' };
            }
        }
    }

    // --- FORMAT 2: Natural language (belief in Y) ---
    for (const key of BELIEFS) {
        const normalizedKey = key.replace(/_/g, ' ');
        const regex = new RegExp(`\\b${normalizedKey}\\b`, 'i');
        const match = lower.match(regex);
        if (match) {
            return { belief: key, matchIndex: match.index, confidence: 1.0, method: 'exact' };
        }
    }

    for (const [alias, canonical] of Object.entries(ALIASES)) {
        const regex = new RegExp(`\\b${alias}\\b`, 'i');
        const match = lower.match(regex);
        if (match) {
            return { belief: canonical, matchIndex: match.index, confidence: 0.9, method: 'alias' };
        }
    }

    // Fuzzy fallback (for both formats)
    for (const key of BELIEFS) {
        const normalizedKey = key.replace(/_/g, ' ');
        for (let i = 0; i <= lower.length - normalizedKey.length + 2; i++) {
            const window = lower.slice(i, i + normalizedKey.length + 2);
            const distance = levenshtein(window.trim(), normalizedKey);
            if (distance <= 2 && distance < normalizedKey.length * 0.4) {
                return { belief: key, matchIndex: i, confidence: 0.6, method: 'fuzzy' };
            }
        }
    }

    return { belief: null, matchIndex: -1, confidence: 0.1, method: null };
}