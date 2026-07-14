// js/ui/cognitionModal.js

import { G } from "../core/state.js";
import { SIM_IDS } from "../core/constants.js";
import {
  formatScratchpadForDisplay,
  formatEvidenceMessage,
} from "./cognitionFormatter.js";
import {
  formatCognitionOverview,
} from "./cognitionOverview.js";

/* ============================================================
   CANONICAL COMMUNICATION MESSAGE LOOKUP
============================================================ */

const findCommMsg = (id) =>
  G.comms?.history?.find(
    (message) => message.messageId === id
  );

/* ============================================================
   SIM SELECTION
============================================================ */

function normalizeSimId(value) {
  return String(value ?? "")
    .trim()
    .toUpperCase();
}

function isAvailableSimId(simId) {
  return (
    SIM_IDS.includes(simId) &&
    Boolean(G.sims?.[simId])
  );
}

function resolveSelectedSimId(candidate) {
  const normalized =
    normalizeSimId(candidate);

  if (isAvailableSimId(normalized)) {
    return normalized;
  }

  const firstAvailable =
    SIM_IDS.find(
      (simId) =>
        Boolean(
          G.sims?.[simId]
        )
    );

  return firstAvailable ?? "TED";
}

function resolveView(value) {
  return value === "overview"
    ? "overview"
    : "sim";
}

function updateSelectedTab(
  simId,
  view
) {
  document
    .querySelectorAll(
      "#cognition-nav .cog-nav-btn"
    )
    .forEach((button) => {
      const selected =
        view === "overview"
          ? button.dataset.view ===
          "overview"
          : button.dataset.s ===
          simId;

      button.classList.toggle(
        "sel",
        selected
      );
    });
}

/* ============================================================
   UNREAD COGNITION ACKNOWLEDGEMENT
============================================================ */

const COGNITION_HIGHLIGHT_PRIORITY =
  Object.freeze({
    new: 2,
    updated: 1,
  });

function parseHighlightPrefixes(value) {
  return String(value ?? "")
    .split("|")
    .map(
      (prefix) =>
        prefix.trim()
    )
    .filter(Boolean);
}

function highlightPathMatchesPrefix(
  path,
  prefix
) {
  return (
    path === prefix ||
    path.startsWith(
      `${prefix}.`
    ) ||
    path.startsWith(
      `${prefix}[`
    )
  );
}

function strongestUnreadHighlight(
  highlightState,
  prefixes
) {
  const changes =
    Array.isArray(
      highlightState?.changes
    )
      ? highlightState.changes
      : [];

  let strongest = null;
  let strongestPriority = 0;

  for (const change of changes) {
    const path =
      String(
        change?.path ??
        ""
      );

    const matches =
      prefixes.some(
        (prefix) =>
          highlightPathMatchesPrefix(
            path,
            prefix
          )
      );

    if (!matches) {
      continue;
    }

    const kind =
      change?.kind === "new"
        ? "new"
        : "updated";

    const priority =
      COGNITION_HIGHLIGHT_PRIORITY[
        kind
      ] ?? 0;

    if (
      priority >
      strongestPriority
    ) {
      strongest =
        kind;

      strongestPriority =
        priority;
    }
  }

  return strongest;
}

function acknowledgeCognitionPrefixes(
  simId,
  prefixes
) {
  const highlightState =
    G.cognitionHighlights
      ?.[simId];

  if (
    !highlightState ||
    !Array.isArray(
      highlightState.changes
    )
  ) {
    return;
  }

  highlightState.changes =
    highlightState.changes.filter(
      (change) => {
        const path =
          String(
            change?.path ??
            ""
          );

        return !prefixes.some(
          (prefix) =>
            highlightPathMatchesPrefix(
              path,
              prefix
            )
        );
      }
    );
}

function updateHighlightElement(
  details,
  kind
) {
  details.classList.remove(
    "cog-highlight",
    "cog-highlight--new",
    "cog-highlight--updated"
  );

  const summary =
    details.firstElementChild
      ?.tagName === "SUMMARY"
      ? details.firstElementChild
      : null;

  const existingBadge =
    summary?.querySelector(
      ".cog-update-badge"
    ) ?? null;

  if (!kind) {
    existingBadge?.remove();
    return;
  }

  details.classList.add(
    "cog-highlight",
    `cog-highlight--${kind}`
  );

  const badge =
    existingBadge ??
    document.createElement(
      "span"
    );

  badge.className =
    `cog-update-badge ` +
    `cog-update-badge--${kind}`;

  badge.textContent =
    kind.toUpperCase();

  if (
    !existingBadge &&
    summary
  ) {
    summary.appendChild(
      badge
    );
  }
}

function refreshCognitionHighlightElements(
  body,
  simId
) {
  const highlightState =
    G.cognitionHighlights
      ?.[simId] ??
    null;

  body
    .querySelectorAll(
      "details[data-cog-highlight-prefixes]"
    )
    .forEach((details) => {
      const prefixes =
        parseHighlightPrefixes(
          details.dataset
            .cogHighlightPrefixes
        );

      const kind =
        strongestUnreadHighlight(
          highlightState,
          prefixes
        );

      updateHighlightElement(
        details,
        kind
      );
    });
}

function ensureCognitionHighlightEvents(
  body
) {
  if (
    body.dataset
      .cogHighlightEventsBound ===
    "true"
  ) {
    return;
  }

  body.dataset
    .cogHighlightEventsBound =
    "true";

  /*
   * The toggle listener uses capture because toggle events from
   * nested details elements are not reliably useful through normal
   * bubbling delegation.
   */
  body.addEventListener(
    "toggle",
    (event) => {
      const details =
        event.target;

      if (
        !(
          details instanceof
          HTMLDetailsElement
        ) ||
        !details.open ||
        details.dataset
          .cogAcknowledge !==
          "true"
      ) {
        return;
      }

      const prefixes =
        parseHighlightPrefixes(
          details.dataset
            .cogHighlightPrefixes
        );

      if (!prefixes.length) {
        return;
      }

      const root =
        details.closest(
          ".cog-root[data-subject]"
        );

      const simId =
        normalizeSimId(
          root?.dataset?.subject
        );

      if (!isAvailableSimId(simId)) {
        return;
      }

      acknowledgeCognitionPrefixes(
        simId,
        prefixes
      );

      /*
       * Update the current DOM in place. Do not rerender here,
       * because rerendering would collapse the tag and reorder it
       * while the user is trying to read it.
       */
      refreshCognitionHighlightElements(
        body,
        simId
      );
    },
    true
  );

  /*
   * Evidence reference clicks. Delegated, once-only, capture phase.
   * Updates the claim's single inline viewer in place. Does not
   * rerender the modal, reset scroll, or mutate state/history.
   */
  body.addEventListener(
    "click",
    (event) => {
      const button =
        event.target.closest(
          "[data-cog-message-id]"
        );

      if (!button) {
        return;
      }

      const claim =
        button.closest(".cog-claim");

      if (!claim) {
        return;
      }

      const viewer =
        claim.querySelector(
          "[data-cog-evidence-viewer]"
        );

      if (!viewer) {
        return;
      }

      const messageId =
        button.dataset.cogMessageId;

      viewer.innerHTML =
        formatEvidenceMessage(
          messageId,
          findCommMsg(messageId)
        );

      viewer.hidden = false;

      const claimRefs =
        claim.querySelectorAll(
          ".cog-evidence-ref"
        );

      claimRefs.forEach((ref) => {
        const isSelected =
          ref === button;

        ref.classList.toggle(
          "sel",
          isSelected
        );

        ref.setAttribute(
          "aria-pressed",
          isSelected
            ? "true"
            : "false"
        );

        ref.setAttribute(
          "aria-expanded",
          isSelected
            ? "true"
            : "false"
        );
      });
    },
    true
  );
}

/* ============================================================
   METADATA
============================================================ */

function displayMetaValue(value) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return "?";
  }

  return String(value);
}

function formatCognitionMeta(scratchpad) {
  if (
    !scratchpad ||
    typeof scratchpad !== "object" ||
    Array.isArray(scratchpad)
  ) {
    return "SCRATCHPAD UNAVAILABLE";
  }

  const status =
    scratchpad.initialized
      ? "INITIALIZED"
      : "AWAITING REVIEW";

  const schema =
    displayMetaValue(
      scratchpad.schemaVersion
    );

  const revision =
    displayMetaValue(
      scratchpad.revision
    );

  const reviewCycle =
    displayMetaValue(
      scratchpad
        .lastCommunicationReviewCycle
    );

  const messageCursor =
    displayMetaValue(
      scratchpad
        .lastReviewedMessageSequence
    );

  return (
    `${status}` +
    ` ? SCHEMA ${schema}` +
    ` ? REVISION ${revision}` +
    ` ? REVIEW CYCLE ${reviewCycle}` +
    ` ? MESSAGE CURSOR ${messageCursor}`
  );
}

/* ============================================================
   ERROR DISPLAY
============================================================ */

function renderControllerError(
  body,
  error
) {
  body.replaceChildren();

  const warningBlock =
    document.createElement("div");

  warningBlock.className =
    "cog-warning-block";

  const warningLabel =
    document.createElement("div");

  warningLabel.className =
    "cog-warning-label";

  warningLabel.textContent =
    "COGNITION RENDER FAILURE";

  const warningText =
    document.createElement("div");

  warningText.className =
    "cog-warning-text";

  warningText.textContent =
    error instanceof Error
      ? error.message
      : String(error);

  warningBlock.append(
    warningLabel,
    warningText
  );

  body.appendChild(
    warningBlock
  );
}

/* ============================================================
   RENDERING
============================================================ */

export function renderCognitionModal(
  requestedSimId =
    G.cognitionModalSim,

  requestedView =
    G.cognitionModalView
) {
  const simId =
    resolveSelectedSimId(
      requestedSimId
    );

  const view =
    resolveView(
      requestedView
    );

  G.cognitionModalSim =
    simId;

  G.cognitionModalView =
    view;

  const title =
    document.getElementById(
      "cognition-title"
    );

  const meta =
    document.getElementById(
      "cognition-meta"
    );

  const body =
    document.getElementById(
      "cognition-body"
    );

  updateSelectedTab(
    simId,
    view
  );

  if (
    !title ||
    !meta ||
    !body
  ) {
    return;
  }

  ensureCognitionHighlightEvents(
    body
  );

  try {
    if (view === "overview") {
      title.textContent =
        "GROUP // COGNITIVE SYNTHESIS";

      meta.textContent =
        `CYCLE ${G.cycle}` +
        ` ? ${SIM_IDS.length} PRISONERS` +
        " ? READ-ONLY TELEMETRY";

      body.innerHTML =
        formatCognitionOverview(G);

      body.scrollTop = 0;
      return;
    }

    const sim =
      G.sims?.[simId];

    const scratchpad =
      sim?.scratchpad;

    const displayName =
      sim?.name ??
      sim?.id ??
      simId;

    title.textContent =
      `${displayName} // COGNITION`;

    meta.textContent =
      formatCognitionMeta(
        scratchpad
      );

    body.innerHTML =
      formatScratchpadForDisplay(
        scratchpad,
        simId,
        G.cognitionHighlights
        ?.[simId] ??
        null
      );
  } catch (error) {
    console.error(
      `[COGNITION] Failed to render ${view === "overview"
        ? "overview"
        : simId
      }.`,
      error
    );

    renderControllerError(
      body,
      error
    );
  }

  body.scrollTop = 0;
}

/* ============================================================
   MODAL CONTROLS
============================================================ */

export function openCognitionModal() {
  const modal =
    document.getElementById(
      "cognition-modal"
    );

  if (!modal) {
    console.warn(
      "[COGNITION] Modal element not found."
    );

    return;
  }

  const simId =
    resolveSelectedSimId(
      G.cognitionModalSim
    );

  const view =
    resolveView(
      G.cognitionModalView
    );

  renderCognitionModal(
    simId,
    view
  );

  modal.classList.add(
    "open"
  );
}

export function closeCognitionModal() {
  const modal =
    document.getElementById(
      "cognition-modal"
    );

  if (modal) {
    modal.classList.remove(
      "open"
    );
  }
}

export function switchCognitionSim(
  button
) {
  const simId =
    normalizeSimId(
      button?.dataset?.s
    );

  if (!isAvailableSimId(simId)) {
    console.warn(
      "[COGNITION] Ignored invalid simulation selection:",
      button?.dataset?.s
    );

    return;
  }

  G.cognitionModalSim =
    simId;

  G.cognitionModalView =
    "sim";

  renderCognitionModal(
    simId,
    "sim"
  );
}

export function switchCognitionOverview() {
  G.cognitionModalView =
    "overview";

  renderCognitionModal(
    G.cognitionModalSim,
    "overview"
  );
}
