// js/prompts/utils/formatClaimDissonance.js
//
// Renders a prisoner's cognitive dissonance for their own scratchpad.
//
// WHAT THIS IS
// ------------
// When AM takes something without telling the prisoner, the
// prisoner's belief and the objective reality drift apart. The
// prisoner does not receive a system message saying "your cigarette
// was confiscated". They simply reach for it and it is not there.
//
// This renderer is how the engine surfaces that gap to the prisoner.
// It is the subjective counterpart to the exposure notice that
// capability degradation already produces.
//
// WHY IT IS WORDED AS DOUBT, NOT AS TRUTH
// ---------------------------------------
// The prisoner is NOT told what really happened. They are told what
// they expected to find and that it was not there. The engine knows
// the truth; the prisoner does not, and the whole point of the
// mechanism is that they cannot be told.
//
// A renderer that said "AM took your cigarette" would collapse the
// divergence the instant it was shown. The renderer therefore
// describes the MISSING THING and lets the prisoner supply their own
// explanation, which is what makes the moment psychologically
// usable rather than merely annoying.
//
// DETERMINISM
// -----------
// Pure function of its input. No clock, no randomness.

import {
  formatQuantityPhrase,
  getResourceLabel,
} from "./formatResourceLanguage.js";

/*
 * The dissonance block for one prisoner.
 *
 * Returns an empty string when the prisoner has no fresh divergence,
 * so the caller can drop the section entirely rather than showing an
 * empty heading.
 */
export function formatClaimDissonance(entries) {
  const list = Array.isArray(entries) ? entries : [];

  if (list.length === 0) return "";

  const lines = ["[COGNITIVE DISSONANCE]"];

  for (const entry of list) {
    const label = getResourceLabel(entry?.definitionId);
    const expected = formatQuantityPhrase(entry?.claimed, label);

    lines.push(
      `- You remember having ${expected}, but you cannot find it.`
    );
    lines.push(
      "  Your hand goes to the same place it always did. There is nothing there."
    );

    if (entry?.claimedResourceId) {
      lines.push(
        `  The last time you checked, you had it: ${entry.claimedResourceId}.`
      );
    }
  }

  lines.push(
    "Something happened that you were not told about. Decide what you believe, and let the doubt sit."
  );

  return lines.join("\n");
}
