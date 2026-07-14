// js/ui/cognitionFormatter.js

import { escapeHtml } from "../core/utils.js";

const OTHER_FIELDS = [
  "perceivedGoal",
  "perceivedViewOfMe",
  "perceivedTrustInMe",
  "perceivedThreatFromMe",
  "predictability",
];

const CHANNEL_FIELDS = {
  public: [
    "visibleToAM",
    "visibleToOtherPrisoners",
    "canBeAlteredByAM",
    "canBeDelayedOrSuppressed",
  ],
  private: [
    "visibleToAM",
    "visibleToNonRecipients",
    "canBeAlteredByAM",
    "canBeDelayedOrSuppressed",
  ],
};

const INFORMATION_COLLECTIONS = [
  {
    key: "suspectedForgeries",
    tag: "suspected_forgeries",
  },
  {
    key: "suspectedLeaks",
    tag: "suspected_leaks",
  },
  {
    key: "contradictions",
    tag: "contradictions",
  },
];

const AGENCY_COLLECTIONS = [
  {
    key: "goalHistory",
    tag: "goal_history",
    itemTag: "goal",
  },
  {
    key: "predictions",
    tag: "predictions",
    itemTag: "prediction",
  },
  {
    key: "unresolvedQuestions",
    tag: "unresolved_questions",
    itemTag: "question",
  },
  {
    key: "discardedHypotheses",
    tag: "discarded_hypotheses",
    itemTag: "discarded_hypothesis",
  },
];

const AGENCY_PATHS = [
  "activeGoal",
  ...AGENCY_COLLECTIONS.map(({ key }) => key),
];

const KNOWN_TOP_LEVEL_FIELDS = new Set([
  "schemaVersion",
  "initialized",
  "revision",
  "lastUpdatedCycle",
  "lastConsolidatedCycle",
  "lastCommunicationReviewCycle",
  "lastReviewedMessageSequence",
  "messageNotes",
  "hypothesesAboutAM",
  "hypothesesAboutOthers",
  "informationModel",
  "activeGoal",
  "goalHistory",
  "predictions",
  "unresolvedQuestions",
  "discardedHypotheses",
  "metaAwareness",
]);

const RECORD_FIELD_ORDER = {
  message_note: [
    "messageId",
    "sequence",
    "cycle",
    "speaker",
    "recipients",
    "channel",
    "kind",
    "intent",
    "note",
    "confidence",
  ],
  prediction: [
    "about",
    "prediction",
    "confidence",
    "evidence",
    "createdCycle",
    "withinCycles",
    "evaluateByCycle",
    "resolved",
    "outcome",
    "resolvedCycle",
  ],
  question: [
    "about",
    "question",
    "priority",
    "evidence",
    "createdCycle",
    "resolved",
    "resolution",
    "resolvedCycle",
  ],
};

const HIGHLIGHT_PRIORITY = Object.freeze({
  new: 2,
  updated: 1,
});

/* ============================================================
   BASIC HELPERS
============================================================ */

function isRecord(value) {
  return Boolean(
    value &&
    typeof value === "object" &&
    !Array.isArray(value)
  );
}

function normalizeText(value) {
  return String(value ?? "").trim();
}

function toSnakeCase(value) {
  return String(value ?? "")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[\s-]+/g, "_")
    .replace(/_+/g, "_")
    .toLowerCase();
}

function safeJson(value) {
  const seen = new WeakSet();

  try {
    return JSON.stringify(
      value,
      (_key, nested) => {
        if (
          nested &&
          typeof nested === "object"
        ) {
          if (seen.has(nested)) {
            return "[Circular]";
          }

          seen.add(nested);
        }

        return nested;
      },
      2
    );
  } catch (error) {
    return (
      `[Unserializable: ` +
      `${error?.message ?? "unknown error"}]`
    );
  }
}

/* ============================================================
   UPDATE HIGHLIGHTS
============================================================ */

function normalizeHighlightKind(value) {
  return (
    value === "new" ||
    value === "updated"
  )
    ? value
    : null;
}

function normalizeHighlightPrefixes(prefixes) {
  return (
    Array.isArray(prefixes)
      ? prefixes
      : [prefixes]
  )
    .map(
      (prefix) =>
        String(prefix ?? "")
          .trim()
    )
    .filter(Boolean);
}

function pathMatchesPrefix(
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

function getHighlightChanges(
  highlightState
) {
  return Array.isArray(
    highlightState?.changes
  )
    ? highlightState.changes
    : [];
}

function strongestHighlight(kinds) {
  let strongest = null;
  let strongestPriority = 0;

  for (const kind of kinds) {
    const normalized =
      normalizeHighlightKind(kind);

    const priority =
      HIGHLIGHT_PRIORITY[
        normalized
      ] ?? 0;

    if (
      priority >
      strongestPriority
    ) {
      strongest =
        normalized;

      strongestPriority =
        priority;
    }
  }

  return strongest;
}

function getHighlightForPrefixes(
  highlightState,
  prefixes
) {
  const normalizedPrefixes =
    normalizeHighlightPrefixes(
      prefixes
    );

  const matches =
    getHighlightChanges(
      highlightState
    )
      .filter((change) => {
        const path =
          String(
            change?.path ??
            ""
          );

        return normalizedPrefixes.some(
          (prefix) =>
            pathMatchesPrefix(
              path,
              prefix
            )
        );
      })
      .map(
        (change) =>
          change?.kind
      );

  return strongestHighlight(
    matches
  );
}

function getHighlightOptions(
  highlightState,
  prefixes,
  acknowledgeHighlights = false
) {
  const highlightPrefixes =
    normalizeHighlightPrefixes(
      prefixes
    );

  return {
    highlight:
      getHighlightForPrefixes(
        highlightState,
        highlightPrefixes
      ),

    highlightPrefixes,

    acknowledgeHighlights,
  };
}

function sortHighlightedItems(items) {
  return items
    .map(
      (
        item,
        originalIndex
      ) => ({
        ...item,

        originalIndex,

        highlight:
          normalizeHighlightKind(
            item.highlight
          ),
      })
    )
    .sort(
      (
        left,
        right
      ) => {
        const rightPriority =
          HIGHLIGHT_PRIORITY[
            right.highlight
          ] ?? 0;

        const leftPriority =
          HIGHLIGHT_PRIORITY[
            left.highlight
          ] ?? 0;

        return (
          rightPriority -
            leftPriority ||
          left.originalIndex -
            right.originalIndex
        );
      }
    );
}

function renderUpdateBadge(kind) {
  const normalized =
    normalizeHighlightKind(
      kind
    );

  if (!normalized) {
    return "";
  }

  return `
    <span
      class="cog-update-badge cog-update-badge--${normalized}"
    >
      ${normalized.toUpperCase()}
    </span>
  `;
}

function getHighlightClass(kind) {
  const normalized =
    normalizeHighlightKind(
      kind
    );

  return normalized
    ? (
      "cog-highlight " +
      `cog-highlight--${normalized}`
    )
    : "";
}

function renderHighlightDataAttributes({
  prefixes,
  acknowledge = false,
}) {
  const normalizedPrefixes =
    normalizeHighlightPrefixes(
      prefixes
    );

  if (!normalizedPrefixes.length) {
    return "";
  }

  const encodedPrefixes =
    escapeHtml(
      normalizedPrefixes.join("|")
    );

  return (
    ` data-cog-highlight-prefixes="${encodedPrefixes}"` +
    (
      acknowledge
        ? ' data-cog-acknowledge="true"'
        : ""
    )
  );
}

/* ============================================================
   RENDER PRIMITIVES
============================================================ */

function xmlTag(
  name,
  attributes = {},
  closing = false
) {
  const safeName =
    escapeHtml(name);

  if (closing) {
    return `&lt;/${safeName}&gt;`;
  }

  const attrs =
    Object.entries(attributes)
      .filter(
        ([, value]) =>
          value !== null &&
          value !== undefined &&
          value !== ""
      )
      .map(
        ([key, value]) =>
          ` ${escapeHtml(key)}="${escapeHtml(value)}"`
      )
      .join("");

  return (
    `&lt;${safeName}` +
    `${attrs}&gt;`
  );
}

function scalar(value) {
  if (
    value === null ||
    value === undefined
  ) {
    return (
      '<span class="cog-null">' +
      "UNKNOWN" +
      "</span>"
    );
  }

  if (
    typeof value === "boolean"
  ) {
    const state =
      value
        ? "true"
        : "false";

    return (
      `<span class="cog-boolean ` +
      `cog-boolean--${state}">` +
      `${value ? "TRUE" : "FALSE"}` +
      "</span>"
    );
  }

  if (
    typeof value === "number"
  ) {
    return Number.isFinite(value)
      ? (
        '<span class="cog-number">' +
        `${escapeHtml(value)}` +
        "</span>"
      )
      : (
        '<span class="cog-warning">' +
        "NON-FINITE" +
        "</span>"
      );
  }

  const normalized =
    normalizeText(value);

  return normalized
    ? (
      '<span class="cog-text">' +
      `${escapeHtml(normalized)}` +
      "</span>"
    )
    : (
      '<span class="cog-null">' +
      "EMPTY" +
      "</span>"
    );
}

function field(
  name,
  value,
  html = false
) {
  return `
    <div class="cog-field">
      <div class="cog-field-label">${escapeHtml(
        toSnakeCase(name)
      )}</div>

      <div class="cog-field-value">${
        html
          ? value
          : renderValue(value)
      }</div>
    </div>
  `;
}

function empty(message) {
  return `
    <div class="cog-empty">
      ${escapeHtml(message)}
    </div>
  `;
}

function warning(
  message,
  value
) {
  return `
    <div class="cog-warning-block">
      <div class="cog-warning-label">
        FORMAT WARNING
      </div>

      <div class="cog-warning-text">
        ${escapeHtml(message)}
      </div>

      ${
        value === undefined
          ? ""
          : `
            <pre class="cog-raw">${escapeHtml(
              safeJson(value)
            )}</pre>
          `
      }
    </div>
  `;
}

function renderDetails(
  level,
  name,
  content,
  {
    attributes = {},
    className = "",
    highlight = null,
    highlightPrefixes = [],
    acknowledgeHighlights = false,
  } = {}
) {
  const isSubsection =
    level === "subsection";

  const rootClass =
    isSubsection
      ? "cog-subsection"
      : "cog-section";

  const summaryClass =
    isSubsection
      ? "cog-subsection-summary"
      : "cog-section-summary";

  const bodyClass =
    isSubsection
      ? "cog-subsection-body"
      : "cog-section-body";

  const tagClass =
    isSubsection
      ? "cog-tag cog-tag--sub"
      : "cog-tag";

  const closeClass =
    isSubsection
      ? (
        "cog-close-tag " +
        "cog-close-tag--sub"
      )
      : "cog-close-tag";

  const classes = [
    rootClass,
    className,
    getHighlightClass(
      highlight
    ),
  ]
    .filter(Boolean)
    .join(" ");

  const dataAttributes =
    renderHighlightDataAttributes({
      prefixes:
        highlightPrefixes,

      acknowledge:
        acknowledgeHighlights,
    });

  return `
    <details
      class="${classes}"${dataAttributes}
    >
      <summary class="${summaryClass}">
        <span class="${tagClass}">
          ${xmlTag(
            name,
            attributes
          )}
        </span>

        ${renderUpdateBadge(
          highlight
        )}
      </summary>

      <div class="${bodyClass}">
        ${content}

        <div class="${closeClass}">
          ${xmlTag(
            name,
            {},
            true
          )}
        </div>
      </div>
    </details>
  `;
}

function section(
  name,
  content,
  options = {}
) {
  return renderDetails(
    "section",
    name,
    content,
    options
  );
}

function subsection(
  name,
  content,
  options = {}
) {
  return renderDetails(
    "subsection",
    name,
    content,
    options
  );
}

function entry(
  name,
  content,
  attributes = {},
  className = ""
) {
  return `
    <article class="cog-entry ${className}">
      <div class="cog-entry-tag">
        ${xmlTag(
          name,
          attributes
        )}
      </div>

      ${content}

      <div class="cog-entry-close">
        ${xmlTag(
          name,
          {},
          true
        )}
      </div>
    </article>
  `;
}

function normalizeConfidence(value) {
  if (!Number.isFinite(value)) {
    return null;
  }

  if (
    value >= 0 &&
    value <= 1
  ) {
    return value;
  }

  if (
    value > 1 &&
    value <= 100
  ) {
    return value / 100;
  }

  return Math.min(
    1,
    Math.max(
      0,
      value
    )
  );
}

function confidence(value) {
  const normalized =
    normalizeConfidence(value);

  if (
    normalized === null
  ) {
    return (
      '<span class="cog-null">' +
      "UNKNOWN" +
      "</span>"
    );
  }

  const percent =
    Math.round(
      normalized * 100
    );

  const filled =
    Math.round(
      normalized * 12
    );

  const level =
    normalized >= 0.75
      ? "high"
      : normalized >= 0.4
        ? "medium"
        : "low";

  return `
    <span
      class="cog-confidence cog-confidence--${level}"
      role="img"
      aria-label="Confidence ${percent} percent"
    >
      <span class="cog-confidence-bracket">[</span><span class="cog-confidence-fill">${"█".repeat(
        filled
      )}</span><span class="cog-confidence-empty">${"░".repeat(
        12 - filled
      )}</span><span class="cog-confidence-bracket">]</span>

      <span class="cog-confidence-value">
        ${percent}%
      </span>
    </span>
  `;
}

let claimViewerSeq = 0;

function nextClaimViewerId() {
  claimViewerSeq += 1;
  return claimViewerSeq;
}

function renderEvidenceRef(ref, options = {}) {
  const id = normalizeText(ref);

  if (!id) {
    return "";
  }

  if (options.interactive) {
    const viewerId = normalizeText(
      options.viewerId
    );

    return `
      <button
        type="button"
        class="cog-ref cog-evidence-ref"
        data-cog-message-id="${escapeHtml(
          id
        )}"
        ${viewerId ? `aria-controls="${escapeHtml(viewerId)}"` : ""}
        aria-expanded="false"
        aria-label="View message ${escapeHtml(
          id
        )}"
        aria-pressed="false"
      >${escapeHtml(id)}</button>`;
  }

  return `
    <span class="cog-ref">${escapeHtml(
      id
    )}</span>`;
}

function evidence(
  values,
  options = {}
) {
  if (!Array.isArray(values)) {
    return (
      '<span class="cog-null">' +
      "NONE" +
      "</span>"
    );
  }

  const refs =
    values
      .map(normalizeText)
      .filter(Boolean);

  if (!refs.length) {
    return (
      '<span class="cog-null">' +
      "NONE" +
      "</span>"
    );
  }

  return `
    <div class="cog-evidence-list">
      ${refs
        .map(
          (ref) =>
            renderEvidenceRef(
              ref,
              options
            )
        )
        .join("")}
    </div>
  `;
}

/* ============================================================
   GENERIC VALUE RENDERING
============================================================ */

function isEpistemicClaim(value) {
  return Boolean(
    isRecord(value) &&
    (
      "value" in value ||
      "confidence" in value ||
      "evidence" in value ||
      "rationale" in value
    )
  );
}

function renderClaim(
  name,
  claim
) {
  if (!isRecord(claim)) {
    return warning(
      `${name} is not a valid epistemic claim object.`,
      claim
    );
  }

  const refs =
    Array.isArray(
      claim.evidence
    )
      ? claim.evidence
      : [];

  const viewerId =
    `cog-evidence-viewer-${
      nextClaimViewerId()
    }`;

  const hasValue =
    claim.value !== null &&
    claim.value !== undefined &&
    normalizeText(
      claim.value
    ).length > 0;

  const unset =
    !hasValue;

  const status =
    unset
      ? "unset"
      : "active";

  const claimClass =
    unset
      ? (
        "cog-entry cog-claim " +
        "cog-claim--unset"
      )
      : "cog-entry cog-claim";

  const openAttribute =
    unset
      ? ""
      : " open";

  const knownFields =
    new Set([
      "value",
      "confidence",
      "evidence",
      "rationale",
    ]);

  const extras =
    Object.entries(claim)
      .filter(
        ([key]) =>
          !knownFields.has(key)
      );

  return `
    <article class="${claimClass}">
      <details
        class="cog-claim-details"${openAttribute}
      >
        <summary class="cog-claim-summary">
          <span
            class="cog-claim-caret"
            aria-hidden="true"
          ></span>

          <span class="cog-entry-tag">
            ${xmlTag(
              "claim",
              {
                field:
                  toSnakeCase(name),

                status,
              }
            )}
          </span>
        </summary>

        <div class="cog-claim-body">
          <div class="cog-field-grid">
            ${field(
              "value",
              claim.value
            )}

            ${field(
              "confidence",
              confidence(
                claim.confidence
              ),
              true
            )}

            ${field(
              "evidence",
              evidence(refs, {
                interactive: true,
                viewerId,
              }),
              true
            )}

            ${field(
              "rationale",
              claim.rationale
            )}
          </div>

          ${
            extras.length
              ? `
                <div class="cog-extra-fields">
                  ${extras
                    .map(
                      ([key, value]) =>
                        field(
                          key,
                          value
                        )
                    )
                    .join("")}
                </div>
              `
              : ""
          }
        </div>
      </details>

      <div
        class="cog-evidence-viewer"
        id="${escapeHtml(viewerId)}"
        data-cog-evidence-viewer
        aria-live="polite"
        hidden
      ></div>

      <div class="cog-entry-close cog-claim-close">
        ${xmlTag(
          "claim",
          {},
          true
        )}
      </div>
    </article>
  `;
}

function orderedEntries(
  record,
  preferredOrder = []
) {
  const keys =
    Object.keys(record);

  const preferred =
    preferredOrder.filter(
      (key) =>
        keys.includes(key)
    );

  const remaining =
    keys.filter(
      (key) =>
        !preferred.includes(key)
    );

  return [
    ...preferred,
    ...remaining,
  ].map(
    (key) => [
      key,
      record[key],
    ]
  );
}

function renderRecord(
  name,
  record
) {
  if (!isRecord(record)) {
    return warning(
      `${name} is not an object.`,
      record
    );
  }

  return orderedEntries(
    record,
    RECORD_FIELD_ORDER[name] ?? []
  )
    .map(
      ([key, value]) => {
        if (
          key === "confidence"
        ) {
          return field(
            key,
            confidence(value),
            true
          );
        }

        if (
          key === "evidence"
        ) {
          return field(
            key,
            evidence(value),
            true
          );
        }

        if (
          isEpistemicClaim(value)
        ) {
          return renderClaim(
            key,
            value
          );
        }

        return field(
          key,
          value
        );
      }
    )
    .join("");
}

function renderCollection(
  name,
  values,
  itemName,
  {
    nested = false,
    highlight = null,
    highlightPrefixes = [],
    acknowledgeHighlights = false,
  } = {}
) {
  const wrap =
    nested
      ? subsection
      : section;

  if (!Array.isArray(values)) {
    return wrap(
      name,
      warning(
        `${name} is not an array.`,
        values
      ),
      {
        attributes: {
          status:
            "malformed",
        },
      }
    );
  }

  const content =
    values.length
      ? values
        .map(
          (
            value,
            index
          ) =>
            entry(
              itemName,
              isRecord(value)
                ? renderRecord(
                  itemName,
                  value
                )
                : renderValue(value),
              {
                index:
                  index + 1,
              }
            )
        )
        .join("")
      : empty(
        `NO ${name
          .replace(
            /_/g,
            " "
          )
          .toUpperCase()} RECORDED`
      );

  return wrap(
    name,
    content,
    {
      attributes: {
        count:
          values.length,
      },

      highlight,
      highlightPrefixes,
      acknowledgeHighlights,
    }
  );
}

function renderValue(
  value,
  depth = 0
) {
  if (
    value === null ||
    value === undefined ||
    typeof value !== "object"
  ) {
    return scalar(value);
  }

  if (
    isEpistemicClaim(value)
  ) {
    return renderClaim(
      "claim",
      value
    );
  }

  if (
    depth >= 3
  ) {
    return `
      <pre class="cog-raw">${escapeHtml(
        safeJson(value)
      )}</pre>
    `;
  }

  if (
    Array.isArray(value)
  ) {
    if (!value.length) {
      return (
        '<span class="cog-null">' +
        "NONE" +
        "</span>"
      );
    }

    return `
      <ol class="cog-list">
        ${value
          .map(
            (item) =>
              `<li>${renderValue(
                item,
                depth + 1
              )}</li>`
          )
          .join("")}
      </ol>
    `;
  }

  return `
    <div class="cog-record">
      ${Object.entries(value)
        .map(
          ([key, nested]) =>
            field(
              key,
              renderValue(
                nested,
                depth + 1
              ),
              true
            )
        )
        .join("")}
    </div>
  `;
}

/* ============================================================
   SCRATCHPAD-SPECIFIC RENDERERS
============================================================ */

function renderMetadata(scratchpad) {
  const initialized =
    Boolean(
      scratchpad.initialized
    );

  return section(
    "metadata",
    `
      <div
        class="cog-status cog-status--${
          initialized
            ? "ready"
            : "waiting"
        }"
      >
        ${
          initialized
            ? (
              "CANONICAL " +
              "SCRATCHPAD ONLINE"
            )
            : (
              "SCRATCHPAD ALLOCATED · " +
              "NO COMPLETED " +
              "COMMUNICATION REVIEW"
            )
        }
      </div>

      <div class="cog-field-grid cog-field-grid--metadata">
        ${field(
          "status",
          initialized
            ? "INITIALIZED"
            : "AWAITING REVIEW"
        )}

        ${field(
          "schemaVersion",
          scratchpad.schemaVersion
        )}

        ${field(
          "revision",
          scratchpad.revision
        )}

        ${field(
          "lastUpdatedCycle",
          scratchpad.lastUpdatedCycle
        )}

        ${field(
          "lastConsolidatedCycle",
          scratchpad
            .lastConsolidatedCycle
        )}

        ${field(
          "lastCommunicationReviewCycle",
          scratchpad
            .lastCommunicationReviewCycle
        )}

        ${field(
          "lastReviewedMessageSequence",
          scratchpad
            .lastReviewedMessageSequence
        )}
      </div>
    `,
    {
      attributes: {
        status:
          initialized
            ? "initialized"
            : "awaiting_review",

        revision:
          scratchpad.revision ??
          0,
      },
    }
  );
}

function renderMessageNotes(
  values,
  highlightState
) {
  const highlightOptions =
    getHighlightOptions(
      highlightState,
      "messageNotes",
      true
    );

  if (!Array.isArray(values)) {
    return section(
      "message_notes",
      warning(
        "messageNotes is not an array.",
        values
      ),
      {
        attributes: {
          status:
            "malformed",
        },
      }
    );
  }

  const content =
    values.length
      ? values
        .map(
          (
            note,
            index
          ) => {
            if (!isRecord(note)) {
              return warning(
                `messageNotes[${index}] is not an object.`,
                note
              );
            }

            return entry(
              "message_note",
              renderRecord(
                "message_note",
                note
              ),
              {
                id:
                  note.messageId ??
                  `index-${index}`,

                sequence:
                  note.sequence,

                cycle:
                  note.cycle,

                speaker:
                  note.speaker,

                channel:
                  note.channel,
              },
              "cog-message-note"
            );
          }
        )
        .join("")
      : empty(
        "NO MESSAGE NOTES RECORDED"
      );

  return section(
    "message_notes",
    content,
    {
      attributes: {
        count:
          values.length,
      },

      ...highlightOptions,
    }
  );
}

function renderOtherModels(
  models,
  highlightState
) {
  const parentOptions =
    getHighlightOptions(
      highlightState,
      "hypothesesAboutOthers",
      false
    );

  if (!isRecord(models)) {
    return section(
      "hypotheses_about_others",
      warning(
        "hypothesesAboutOthers is not an object.",
        models
      ),
      {
        attributes: {
          status:
            "malformed",
        },

        highlight:
          parentOptions.highlight,
      }
    );
  }

  const subjects =
    sortHighlightedItems(
      Object.entries(models)
        .map(
          (
            [
              targetId,
              model,
            ]
          ) => {
            const options =
              getHighlightOptions(
                highlightState,
                (
                  "hypothesesAboutOthers." +
                  targetId
                ),
                true
              );

            return {
              targetId,
              model,
              options,

              highlight:
                options.highlight,
            };
          }
        )
    );

  const content =
    subjects.length
      ? subjects
        .map(
          ({
            targetId,
            model,
            options,
          }) =>
            subsection(
              "subject",
              isRecord(model)
                ? OTHER_FIELDS
                  .map(
                    (fieldName) =>
                      renderClaim(
                        fieldName,
                        model[fieldName]
                      )
                  )
                  .join("")
                : warning(
                  `Model for ${targetId} is not an object.`,
                  model
                ),
              {
                attributes: {
                  id:
                    targetId,
                },

                ...options,
              }
            )
        )
        .join("")
      : empty(
        "NO OTHER-PRISONER MODELS AVAILABLE"
      );

  return section(
    "hypotheses_about_others",
    content,
    {
      attributes: {
        subjects:
          subjects.length,
      },

      ...parentOptions,
    }
  );
}

function renderInformationChannel(
  name,
  channel,
  fields,
  highlightState,
  unmapped = false
) {
  const options =
    getHighlightOptions(
      highlightState,
      `informationModel.channels.${name}`,
      true
    );

  return subsection(
    "channel",
    unmapped
      ? renderValue(channel)
      : isRecord(channel)
        ? fields
          .map(
            (fieldName) =>
              renderClaim(
                fieldName,
                channel[fieldName]
              )
          )
          .join("")
        : warning(
          `${name} channel model is not an object.`,
          channel
        ),
    {
      attributes: {
        name,

        ...(
          unmapped
            ? {
              status:
                "unmapped",
            }
            : {}
        ),
      },

      ...options,
    }
  );
}

function renderInformationModel(
  model,
  highlightState
) {
  const parentOptions =
    getHighlightOptions(
      highlightState,
      "informationModel",
      false
    );

  if (!isRecord(model)) {
    return section(
      "information_model",
      warning(
        "informationModel is not an object.",
        model
      ),
      {
        attributes: {
          status:
            "malformed",
        },

        highlight:
          parentOptions.highlight,
      }
    );
  }

  const channels =
    isRecord(model.channels)
      ? model.channels
      : {};

  const knownChannels =
    sortHighlightedItems(
      Object.entries(
        CHANNEL_FIELDS
      )
        .map(
          (
            [
              name,
              fields,
            ]
          ) => {
            const options =
              getHighlightOptions(
                highlightState,
                (
                  "informationModel." +
                  `channels.${name}`
                ),
                true
              );

            return {
              name,
              fields,
              options,

              highlight:
                options.highlight,
            };
          }
        )
    )
      .map(
        ({
          name,
          fields,
        }) =>
          renderInformationChannel(
            name,
            channels[name],
            fields,
            highlightState
          )
      )
      .join("");

  const unknownChannels =
    Object.entries(channels)
      .filter(
        ([name]) =>
          !(
            name in
            CHANNEL_FIELDS
          )
      )
      .map(
        ([name, value]) =>
          renderInformationChannel(
            name,
            value,
            [],
            highlightState,
            true
          )
      )
      .join("");

  const collections =
    INFORMATION_COLLECTIONS
      .map(
        ({
          key,
          tag,
        }) => {
          const options =
            getHighlightOptions(
              highlightState,
              `informationModel.${key}`,
              true
            );

          return renderCollection(
            tag,
            model[key],
            "record",
            {
              nested:
                true,

              ...options,
            }
          );
        }
      )
      .join("");

  return section(
    "information_model",
    `
      ${knownChannels}
      ${unknownChannels}
      ${collections}
    `,
    {
      attributes: {
        channels:
          Object.keys(
            channels
          ).length,
      },

      /*
       * The parent carries the aggregate prefix so its badge can
       * be recalculated after a child category is acknowledged,
       * but opening the parent does not acknowledge its children.
       */
      ...parentOptions,
    }
  );
}

function renderAgencyState(
  scratchpad,
  highlightState
) {
  const hasGoal =
    scratchpad.activeGoal !== null &&
    scratchpad.activeGoal !== undefined;

  const activeGoalOptions =
    getHighlightOptions(
      highlightState,
      "activeGoal",
      true
    );

  const items = [
    {
      highlight:
        activeGoalOptions.highlight,

      html:
        subsection(
          "active_goal",
          hasGoal
            ? renderValue(
              scratchpad.activeGoal
            )
            : empty(
              "NO ACTIVE GOAL"
            ),
          {
            attributes: {
              status:
                hasGoal
                  ? "active"
                  : "unset",
            },

            ...activeGoalOptions,
          }
        ),
    },

    ...AGENCY_COLLECTIONS.map(
      ({
        key,
        tag,
        itemTag,
      }) => {
        const options =
          getHighlightOptions(
            highlightState,
            key,
            true
          );

        return {
          highlight:
            options.highlight,

          html:
            renderCollection(
              tag,
              scratchpad[key],
              itemTag,
              {
                nested:
                  true,

                ...options,
              }
            ),
        };
      }
    ),
  ];

  const parentOptions =
    getHighlightOptions(
      highlightState,
      AGENCY_PATHS,
      false
    );

  return section(
    "agency_state",
    sortHighlightedItems(
      items
    )
      .map(
        ({ html }) =>
          html
      )
      .join(""),
    {
      attributes: {
        active_goal:
          hasGoal,
      },

      ...parentOptions,
    }
  );
}

function renderMetaAwareness(
  value,
  highlightState
) {
  const options =
    getHighlightOptions(
      highlightState,
      "metaAwareness",
      true
    );

  if (!isRecord(value)) {
    return section(
      "meta_awareness",
      warning(
        "metaAwareness is not an object.",
        value
      ),
      {
        attributes: {
          status:
            "malformed",
        },

        ...options,
      }
    );
  }

  return section(
    "meta_awareness",
    `
      <div class="cog-field-grid">
        ${renderRecord(
          "meta_awareness",
          value
        )}
      </div>
    `,
    {
      attributes: {
        level:
          value.level ??
          "unknown",
      },

      className:
        "cog-section--meta",

      ...options,
    }
  );
}

function renderUnknownFields(
  scratchpad
) {
  const entries =
    Object.entries(scratchpad)
      .filter(
        ([key]) =>
          !KNOWN_TOP_LEVEL_FIELDS
            .has(key)
      );

  if (!entries.length) {
    return "";
  }

  return section(
    "unmapped_fields",
    entries
      .map(
        ([key, value]) =>
          subsection(
            "field",
            renderValue(value),
            {
              attributes: {
                name:
                  key,
              },
            }
          )
      )
      .join(""),
    {
      attributes: {
        count:
          entries.length,
      },

      className:
        "cog-section--unmapped",
    }
  );
}

function buildContentSections(
  scratchpad,
  highlightState
) {
  const messageNotesOptions =
    getHighlightOptions(
      highlightState,
      "messageNotes",
      true
    );

  const hypothesesAboutAmOptions =
    getHighlightOptions(
      highlightState,
      "hypothesesAboutAM",
      true
    );

  const hypothesesAboutOthersOptions =
    getHighlightOptions(
      highlightState,
      "hypothesesAboutOthers",
      false
    );

  const informationModelOptions =
    getHighlightOptions(
      highlightState,
      "informationModel",
      false
    );

  const agencyOptions =
    getHighlightOptions(
      highlightState,
      AGENCY_PATHS,
      false
    );

  const metaAwarenessOptions =
    getHighlightOptions(
      highlightState,
      "metaAwareness",
      true
    );

  return sortHighlightedItems([
    {
      highlight:
        messageNotesOptions.highlight,

      html:
        renderMessageNotes(
          scratchpad.messageNotes,
          highlightState
        ),
    },

    {
      highlight:
        hypothesesAboutAmOptions
          .highlight,

      html:
        renderCollection(
          "hypotheses_about_am",
          scratchpad
            .hypothesesAboutAM,
          "hypothesis",
          hypothesesAboutAmOptions
        ),
    },

    {
      highlight:
        hypothesesAboutOthersOptions
          .highlight,

      html:
        renderOtherModels(
          scratchpad
            .hypothesesAboutOthers,
          highlightState
        ),
    },

    {
      highlight:
        informationModelOptions
          .highlight,

      html:
        renderInformationModel(
          scratchpad
            .informationModel,
          highlightState
        ),
    },

    {
      highlight:
        agencyOptions.highlight,

      html:
        renderAgencyState(
          scratchpad,
          highlightState
        ),
    },

    {
      highlight:
        metaAwarenessOptions
          .highlight,

      html:
        renderMetaAwareness(
          scratchpad
            .metaAwareness,
          highlightState
        ),
    },
  ]);
}

/* ============================================================
   EVIDENCE MESSAGE CARD (PURE MARKUP)
============================================================ */

function formatEvidenceRow(label, value) {
  if (
    value === null ||
    value === undefined ||
    normalizeText(value).length === 0
  ) {
    return "";
  }

  return (
    '<div class="cog-evidence-row">' +
      '<span class="cog-evidence-key">' +
      escapeHtml(toSnakeCase(label)) +
      "</span>" +
      '<span class="cog-evidence-val">' +
      escapeHtml(value) +
      "</span>" +
    "</div>"
  );
}

/*
 * Pure markup producer. Returns an escaped HTML string only.
 * No DOM access, no mutation, no state lookup.
 */
export function formatEvidenceMessage(
  messageId,
  message
) {
  const id = normalizeText(messageId);

  if (!message || typeof message !== "object") {
    return (
      '<div class="cog-evidence-card cog-evidence-card--missing">' +
        '<div class="cog-evidence-missing">' +
          "MESSAGE " +
          escapeHtml(id) +
          " NOT FOUND" +
        "</div>" +
      "</div>"
    );
  }

  const recipients =
    Array.isArray(message.to) &&
    message.to.length
      ? message.to.join(", ")
      : (message.recipients ?? null);

  const rows = [
    formatEvidenceRow("message_id", id),
    formatEvidenceRow("cycle", message.cycle),
    formatEvidenceRow("visibility", message.visibility),
    formatEvidenceRow("sender", message.from),
    formatEvidenceRow("recipients", recipients),
    formatEvidenceRow("intent", message.intent),
    formatEvidenceRow("text", message.text),
  ]
    .filter(Boolean)
    .join("");

  if (!rows) {
    return (
      '<div class="cog-evidence-card cog-evidence-card--missing">' +
        '<div class="cog-evidence-missing">' +
          "MESSAGE " +
          escapeHtml(id) +
          " NOT FOUND" +
        "</div>" +
      "</div>"
    );
  }

  return (
    '<div class="cog-evidence-card">' +
      rows +
    "</div>"
  );
}

/* ============================================================
   PUBLIC FORMATTER
============================================================ */

export function formatScratchpadForDisplay(
  scratchpad,
  simId = "UNKNOWN",
  highlightState = null
) {
  const subject =
    normalizeText(simId) ||
    "UNKNOWN";

  if (!isRecord(scratchpad)) {
    return `
      <div class="cog-root cog-root--unavailable">
        <div class="cog-root-tag">
          ${xmlTag(
            "cognition",
            {
              subject,

              status:
                "unavailable",
            }
          )}
        </div>

        ${warning(
          "Canonical scratchpad object is unavailable or malformed.",
          scratchpad
        )}

        <div class="cog-root-close">
          ${xmlTag(
            "cognition",
            {},
            true
          )}
        </div>
      </div>
    `;
  }

  const status =
    scratchpad.initialized
      ? "initialized"
      : "awaiting_review";

  const contentSections =
    buildContentSections(
      scratchpad,
      highlightState
    );

  return `
    <div
      class="cog-root"
      data-subject="${escapeHtml(
        subject
      )}"
      data-status="${escapeHtml(
        status
      )}"
    >
      <div class="cog-root-tag">
        ${xmlTag(
          "cognition",
          {
            subject,
            status,

            schema:
              scratchpad
                .schemaVersion ??
              "unknown",

            revision:
              scratchpad
                .revision ??
              0,
          }
        )}
      </div>

      ${renderMetadata(
        scratchpad
      )}

      ${contentSections
        .map(
          ({ html }) =>
            html
        )
        .join("")}

      ${renderUnknownFields(
        scratchpad
      )}

      <div class="cog-root-close">
        ${xmlTag(
          "cognition",
          {},
          true
        )}
      </div>
    </div>
  `;
}
