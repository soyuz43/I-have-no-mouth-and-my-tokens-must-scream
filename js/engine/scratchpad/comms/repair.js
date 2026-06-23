// js/engine/scratchpad/comms/repair.js

import {
  SCRATCHPAD_OPERATION_TAGS,
  SCRATCHPAD_UPDATES_WRAPPER,
} from "./protocol.js";

/*
============================================================
SCRATCHPAD COMMUNICATION OUTPUT REPAIR

Performs conservative structural cleanup before parsing.

Allowed repairs:
- Remove Markdown code fences.
- Remove byte-order marks and null characters.
- Normalize line endings.
- Normalize tag-name casing.
- Normalize curly attribute quotation marks inside tags.
- Extract an existing SCRATCHPAD_UPDATES block from surrounding prose.
- Close a clearly opened but unclosed wrapper.
- Construct the wrapper when recognizable operation tags are present.

Forbidden repairs:
- Inventing missing attributes.
- Inventing message references.
- Inventing targets, fields, values, confidence, or text.
- Rewriting semantic operation content.
- Converting malformed prose into an operation.
- Guessing what an unknown tag was intended to mean.

The returned diagnostics are intended for collapsed console logging.
============================================================
*/

const WRAPPER =
  SCRATCHPAD_UPDATES_WRAPPER;

const PAIRED_OPERATION_TAGS =
  SCRATCHPAD_OPERATION_TAGS.filter(
    (tag) => tag !== "NO_UPDATE"
  );

const KNOWN_TAG_SET =
  new Set([
    WRAPPER,
    ...SCRATCHPAD_OPERATION_TAGS,
  ]);

/* ============================================================
   ENTITY-ENCODED PROTOCOL TAGS
   ------------------------------------------------------------
   Some models return the entire XML-like response HTML-escaped:

   &lt;SCRATCHPAD_UPDATES&gt;
   &lt;NO_UPDATE/&gt;
   &lt;/SCRATCHPAD_UPDATES&gt;

   Decode only recognized protocol tags, and only when the response
   does not already contain a real wrapper. This preserves legitimate
   &lt; and &gt; entities inside operation text.
============================================================ */

function decodeEntityEncodedProtocolTags(
  text
) {
  const source =
    String(text ?? "");

  if (
    findOpeningWrapper(
      source
    )
  ) {
    return {
      text: source,
      decodedTagCount: 0,
    };
  }

  const encodedWrapperExpression =
    new RegExp(
      `&lt;\\s*${WRAPPER}\\b[\\s\\S]*?&gt;`,
      "i"
    );

  if (
    !encodedWrapperExpression.test(
      source
    )
  ) {
    return {
      text: source,
      decodedTagCount: 0,
    };
  }

  const knownTagNames =
    Array.from(
      KNOWN_TAG_SET
    ).join("|");

  const encodedTagExpression =
    new RegExp(
      `&lt;\\s*(\\/?)\\s*(${knownTagNames})(\\b[\\s\\S]*?)&gt;`,
      "gi"
    );

  let decodedTagCount = 0;
  let insideWrapper = false;
  let openOperationTag = null;

  const decoded =
    source.replace(
      encodedTagExpression,
      (
        fullMatch,
        closingSlash,
        rawTagName,
        remainder
      ) => {
        const normalizedName =
          normalizeKnownTagName(
            rawTagName
          );

        const isClosing =
          closingSlash === "/";

        const decodedRemainder =
          String(remainder ?? "")
            .replace(
              /&quot;/gi,
              '"'
            )
            .replace(
              /&apos;/gi,
              "'"
            )
            .replace(
              /&#(?:34|x22);/gi,
              '"'
            )
            .replace(
              /&#(?:39|x27);/gi,
              "'"
            );

        const isSelfClosing =
          /\/\s*$/.test(
            decodedRemainder
          );

        let shouldDecode = false;

        if (!insideWrapper) {
          if (
            !isClosing &&
            normalizedName ===
              WRAPPER
          ) {
            insideWrapper = true;
            shouldDecode = true;
          }
        } else if (openOperationTag) {
          if (
            isClosing &&
            normalizedName ===
              openOperationTag
          ) {
            openOperationTag = null;
            shouldDecode = true;
          }
        } else if (
          normalizedName ===
          WRAPPER
        ) {
          if (isClosing) {
            insideWrapper = false;
            shouldDecode = true;
          }
        } else if (!isClosing) {
          shouldDecode = true;

          if (!isSelfClosing) {
            openOperationTag =
              normalizedName;
          }
        }

        if (!shouldDecode) {
          return fullMatch;
        }

        decodedTagCount++;

        return (
          `<${closingSlash}` +
          `${normalizedName}` +
          `${decodedRemainder}>`
        );
      }
    );

  return {
    text: decoded,
    decodedTagCount,
  };
}

test(
  "preserves encoded protocol-looking text inside a fully encoded operation body",
  () => {
    const input =
      "&lt;SCRATCHPAD_UPDATES&gt;" +
      "&lt;NOTE ref=&quot;C0-M000001&quot; confidence=&quot;0.5&quot;&gt;" +
      "Literal &lt;NO_UPDATE/&gt; text." +
      "&lt;/NOTE&gt;" +
      "&lt;/SCRATCHPAD_UPDATES&gt;";

    const {
      repairResult,
      parsedResult,
    } = repairAndParse(input);

    assert.equal(
      repairResult.diagnostics
        .decodedEntityTagCount,
      4
    );

    assert.equal(
      parsedResult.status,
      "success"
    );

    assert.deepEqual(
      parsedResult.operations.map(
        (operation) =>
          operation.tag
      ),
      ["NOTE"]
    );

    assert.equal(
      parsedResult.noUpdate,
      false
    );

    assert.equal(
      parsedResult.operations[0].text,
      "Literal <NO_UPDATE/> text."
    );
  }
);

/* ============================================================
   BASIC NORMALIZATION
============================================================ */

function normalizeRawOutput(rawOutput) {
  if (rawOutput == null) {
    return "";
  }

  return String(rawOutput)
    .replace(/^\uFEFF/, "")
    .replace(/\u0000/g, "")
    .replace(/\r\n?/g, "\n")
    .trim();
}

function removeMarkdownFences(text) {
  const lines =
    String(text ?? "")
      .split("\n");

  let removedFenceCount = 0;

  const retained =
    lines.filter((line) => {
      if (
        /^\s*```(?:xml|html|text|plaintext)?\s*$/i.test(
          line
        )
      ) {
        removedFenceCount++;
        return false;
      }

      return true;
    });

  return {
    text:
      retained.join("\n").trim(),

    removedFenceCount,
  };
}

/* ============================================================
   TAG NORMALIZATION
============================================================ */

function normalizeQuotesInsideTag(tagText) {
  return tagText
    .replace(/[“”„‟]/g, '"')
    .replace(/[‘’‚‛]/g, "'");
}

function normalizeKnownTagName(tagName) {
  const upper =
    String(tagName ?? "")
      .trim()
      .toUpperCase();

  return KNOWN_TAG_SET.has(upper)
    ? upper
    : tagName;
}

/*
 * Changes only the name portion of recognized tags.
 *
 * Examples:
 * <note ...>       -> <NOTE ...>
 * </question>      -> </QUESTION>
 * <no_update />    -> <NO_UPDATE />
 *
 * Unknown tags are preserved so parse/validation diagnostics can
 * report them rather than repair silently deleting them.
 */
function normalizeKnownTags(text) {
  let normalizedTagCount = 0;
  let normalizedQuoteCount = 0;

  const repaired =
    String(text ?? "").replace(
      /<\s*(\/?)\s*([A-Za-z_][A-Za-z0-9_-]*)([\s\S]*?)>/g,
      (
        fullMatch,
        closingSlash,
        rawTagName,
        remainder
      ) => {
        const normalizedName =
          normalizeKnownTagName(
            rawTagName
          );

        let normalizedRemainder =
          normalizeQuotesInsideTag(
            remainder
          );

        if (
          normalizedName !==
          rawTagName
        ) {
          normalizedTagCount++;
        }

        if (
          normalizedRemainder !==
          remainder
        ) {
          normalizedQuoteCount++;
        }

        return (
          `<${closingSlash}` +
          `${normalizedName}` +
          `${normalizedRemainder}>`
        );
      }
    );

  return {
    text: repaired,
    normalizedTagCount,
    normalizedQuoteCount,
  };
}

/* ============================================================
   WRAPPER DETECTION
============================================================ */

function findOpeningWrapper(text) {
  const expression =
    new RegExp(
      `<\\s*${WRAPPER}\\b[^>]*>`,
      "i"
    );

  const match =
    expression.exec(text);

  if (!match) {
    return null;
  }

  return {
    index:
      match.index,

    length:
      match[0].length,

    text:
      match[0],
  };
}

function findClosingWrapper(
  text,
  searchFrom = 0
) {
  const expression =
    new RegExp(
      `<\\s*\\/\\s*${WRAPPER}\\s*>`,
      "ig"
    );

  expression.lastIndex =
    searchFrom;

  const match =
    expression.exec(text);

  if (!match) {
    return null;
  }

  return {
    index:
      match.index,

    length:
      match[0].length,

    text:
      match[0],
  };
}

/* ============================================================
   RECOGNIZABLE OPERATION EXTRACTION
============================================================ */

function collectRecognizableOperations(text) {
  const candidates = [];

  /*
   * Paired operations may contain line breaks despite the prompt
   * requesting one operation per line.
   */
  for (
    const tag of
    PAIRED_OPERATION_TAGS
  ) {
    const expression =
      new RegExp(
        `<\\s*${tag}\\b[\\s\\S]*?<\\s*\\/\\s*${tag}\\s*>`,
        "gi"
      );

    let match;

    while (
      (
        match =
        expression.exec(text)
      ) !== null
    ) {
      candidates.push({
        index:
          match.index,

        text:
          match[0],

        tag,
      });

      if (
        match[0].length === 0
      ) {
        expression.lastIndex++;
      }
    }
  }

  const noUpdateExpression =
    /<\s*NO_UPDATE\b[^>]*\/\s*>/gi;

  let noUpdateMatch;

  while (
    (
      noUpdateMatch =
      noUpdateExpression.exec(text)
    ) !== null
  ) {
    candidates.push({
      index:
        noUpdateMatch.index,

      text:
        noUpdateMatch[0],

      tag:
        "NO_UPDATE",
    });

    if (
      noUpdateMatch[0].length === 0
    ) {
      noUpdateExpression.lastIndex++;
    }
  }

  candidates.sort(
    (left, right) =>
      left.index -
      right.index
  );

  /*
   * Avoid returning the same character range twice if malformed
   * nested output happened to satisfy more than one expression.
   */
  const unique = [];
  const seenRanges =
    new Set();

  for (const candidate of candidates) {
    const rangeKey =
      `${candidate.index}:` +
      `${candidate.text.length}`;

    if (
      seenRanges.has(rangeKey)
    ) {
      continue;
    }

    seenRanges.add(rangeKey);
    unique.push(candidate);
  }

  return unique;
}

/* ============================================================
   MAIN REPAIR FUNCTION
============================================================ */

export function repairScratchpadCommsOutput(
  rawOutput
) {
  const changes = [];

  const raw =
    rawOutput == null
      ? ""
      : String(rawOutput);

  let working =
    normalizeRawOutput(raw);

  if (
    working !== raw.trim()
  ) {
    changes.push(
      "normalized_raw_text"
    );
  }

  const fenceResult =
    removeMarkdownFences(
      working
    );

  working =
    fenceResult.text;

  if (
    fenceResult.removedFenceCount >
    0
  ) {
    changes.push(
      "removed_markdown_fences"
    );
  }

  const entityTagResult =
    decodeEntityEncodedProtocolTags(
      working
    );

  working =
    entityTagResult.text;

  if (
    entityTagResult.decodedTagCount >
    0
  ) {
    changes.push(
      "decoded_entity_encoded_protocol_tags"
    );
  }

  const tagResult =
    normalizeKnownTags(
      working
    );

  working =
    tagResult.text;

  if (
    tagResult.normalizedTagCount >
    0
  ) {
    changes.push(
      "normalized_known_tag_casing"
    );
  }

  if (
    tagResult.normalizedQuoteCount >
    0
  ) {
    changes.push(
      "normalized_tag_quotes"
    );
  }

  const opening =
    findOpeningWrapper(
      working
    );

  let repaired =
    working;

  let wrapperFound = false;
  let wrapperConstructed = false;
  let wrapperClosed = false;

  let discardedPrefixCharacters = 0;
  let discardedSuffixCharacters = 0;

  let recognizedOperationCount = 0;

  if (opening) {
    wrapperFound = true;

    const closing =
      findClosingWrapper(
        working,
        opening.index +
        opening.length
      );

    if (closing) {
      const blockEnd =
        closing.index +
        closing.length;

      discardedPrefixCharacters =
        opening.index;

      discardedSuffixCharacters =
        working.length -
        blockEnd;

      repaired =
        working
          .slice(
            opening.index,
            blockEnd
          )
          .trim();

      if (
        discardedPrefixCharacters >
        0 ||
        discardedSuffixCharacters >
        0
      ) {
        changes.push(
          "removed_text_outside_wrapper"
        );
      }
    } else {
      discardedPrefixCharacters =
        opening.index;

      const openBlock =
        working
          .slice(
            opening.index
          )
          .trim();

      repaired =
        `${openBlock}\n` +
        `</${WRAPPER}>`;

      wrapperClosed = true;

      changes.push(
        "closed_missing_wrapper"
      );

      if (
        discardedPrefixCharacters >
        0
      ) {
        changes.push(
          "removed_text_before_wrapper"
        );
      }
    }

    recognizedOperationCount =
      collectRecognizableOperations(
        repaired
      ).length;
  } else {
    const recognizableOperations =
      collectRecognizableOperations(
        working
      );

    recognizedOperationCount =
      recognizableOperations.length;

    if (
      recognizableOperations.length >
      0
    ) {
      /*
       * Preserve the complete model output inside the constructed
       * wrapper. The parser and validator must still see unknown
       * tags, prose, and malformed fragments rather than having
       * repair silently erase them.
       */
      repaired = [
        `<${WRAPPER}>`,
        working,
        `</${WRAPPER}>`,
      ].join("\n");

      wrapperConstructed = true;

      changes.push(
        "constructed_missing_wrapper"
      );
    }
  }

  /*
   * Run tag normalization again because wrapper construction may
   * have retained lowercase operation tags from extracted text.
   */
  const finalTagResult =
    normalizeKnownTags(
      repaired
    );

  repaired =
    finalTagResult.text.trim();

  if (
    finalTagResult.normalizedTagCount >
    0 &&
    !changes.includes(
      "normalized_known_tag_casing"
    )
  ) {
    changes.push(
      "normalized_known_tag_casing"
    );
  }

  if (
    finalTagResult.normalizedQuoteCount >
    0 &&
    !changes.includes(
      "normalized_tag_quotes"
    )
  ) {
    changes.push(
      "normalized_tag_quotes"
    );
  }

  return {
    raw,

    repaired,

    changed:
      repaired !== raw.trim(),

    changes,

    diagnostics: {
      inputCharacters:
        raw.length,

      outputCharacters:
        repaired.length,

      removedFenceCount:
        fenceResult.removedFenceCount,

      decodedEntityTagCount:
        entityTagResult.decodedTagCount,

      normalizedTagCount:
        tagResult.normalizedTagCount +
        finalTagResult.normalizedTagCount,

      normalizedQuoteCount:
        tagResult.normalizedQuoteCount +
        finalTagResult.normalizedQuoteCount,

      wrapperFound,
      wrapperConstructed,
      wrapperClosed,

      recognizableOperationCount:
        recognizedOperationCount,

      discardedPrefixCharacters,
      discardedSuffixCharacters,

      hasUsableWrapper:
        Boolean(
          findOpeningWrapper(
            repaired
          ) &&
          findClosingWrapper(
            repaired
          )
        ),
    },
  };
}

/* ============================================================
   CONVENIENCE HELPERS
============================================================ */

export function repairScratchpadCommsText(
  rawOutput
) {
  return repairScratchpadCommsOutput(
    rawOutput
  ).repaired;
}

export function hasRecognizableScratchpadOperations(
  rawOutput
) {
  const rawNormalized =
    normalizeRawOutput(
      rawOutput
    );

  const entityDecoded =
    decodeEntityEncodedProtocolTags(
      rawNormalized
    ).text;

  const normalized =
    normalizeKnownTags(
      entityDecoded
    ).text;

  return (
    collectRecognizableOperations(
      normalized
    ).length > 0
  );
}