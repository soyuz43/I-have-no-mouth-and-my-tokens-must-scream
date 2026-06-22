// js/engine/scratchpad/comms/parse.js

import {
  SCRATCHPAD_UPDATES_WRAPPER,
  getScratchpadOperationDefinition,
  normalizeScratchpadOperationTag,
} from "./protocol.js";

/*
============================================================
SCRATCHPAD COMMUNICATION OUTPUT PARSER

Converts repaired XML-like model output into neutral operation
records.

This module:
- Locates the SCRATCHPAD_UPDATES wrapper.
- Extracts paired and self-closing operation tags.
- Parses quoted attributes.
- Decodes XML entities.
- Preserves unknown tags and attributes for validation.
- Reports malformed or unparsed fragments.

This module does not:
- Decide whether an operation is allowed.
- Validate targets, fields, references, ranges, or visibility.
- Repair semantic defects.
- Mutate scratchpad state.

Expected input:
The repaired string returned by repairScratchpadCommsOutput().
============================================================
*/

const WRAPPER =
  SCRATCHPAD_UPDATES_WRAPPER;

/* ============================================================
   XML ENTITY DECODING
============================================================ */

export function decodeScratchpadXmlEntities(value) {
  return String(value ?? "")
    .replace(
      /&#x([0-9a-f]+);/gi,
      (_, hexadecimal) => {
        const codePoint =
          Number.parseInt(
            hexadecimal,
            16
          );

        if (
          !Number.isSafeInteger(
            codePoint
          )
        ) {
          return _;
        }

        try {
          return String.fromCodePoint(
            codePoint
          );
        } catch {
          return _;
        }
      }
    )
    .replace(
      /&#([0-9]+);/g,
      (_, decimal) => {
        const codePoint =
          Number.parseInt(
            decimal,
            10
          );

        if (
          !Number.isSafeInteger(
            codePoint
          )
        ) {
          return _;
        }

        try {
          return String.fromCodePoint(
            codePoint
          );
        } catch {
          return _;
        }
      }
    )
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}

/* ============================================================
   WRAPPER EXTRACTION
============================================================ */

function findWrapperOpenings(text) {
  const expression =
    new RegExp(
      `<\\s*${WRAPPER}\\b[^>]*>`,
      "gi"
    );

  return [
    ...String(text ?? "")
      .matchAll(expression),
  ].map((match) => ({
    index:
      match.index ?? 0,

    length:
      match[0].length,

    raw:
      match[0],
  }));
}

function findClosingWrapper(
  text,
  searchFrom
) {
  const expression =
    new RegExp(
      `<\\s*\\/\\s*${WRAPPER}\\s*>`,
      "gi"
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

    raw:
      match[0],
  };
}

function extractScratchpadWrapper(text) {
  const source =
    String(text ?? "");

  const openings =
    findWrapperOpenings(
      source
    );

  if (!openings.length) {
    return {
      found: false,
      complete: false,
      wrapperCount: 0,
      source,
      inner: "",
      block: "",
      prefix: source,
      suffix: "",
      errors: [
        `Missing <${WRAPPER}> wrapper.`,
      ],
    };
  }

  const opening =
    openings[0];

  const innerStart =
    opening.index +
    opening.length;

  const closing =
    findClosingWrapper(
      source,
      innerStart
    );

  if (!closing) {
    return {
      found: true,
      complete: false,
      wrapperCount:
        openings.length,

      source,
      inner:
        source.slice(
          innerStart
        ),

      block:
        source.slice(
          opening.index
        ),

      prefix:
        source.slice(
          0,
          opening.index
        ),

      suffix: "",

      errors: [
        `Missing </${WRAPPER}> closing tag.`,
      ],
    };
  }

  const blockEnd =
    closing.index +
    closing.length;

  return {
    found: true,
    complete: true,

    wrapperCount:
      openings.length,

    source,

    inner:
      source.slice(
        innerStart,
        closing.index
      ),

    block:
      source.slice(
        opening.index,
        blockEnd
      ),

    prefix:
      source.slice(
        0,
        opening.index
      ),

    suffix:
      source.slice(
        blockEnd
      ),

    errors: [],
  };
}

/* ============================================================
   ATTRIBUTE PARSING
============================================================ */

function removeMatchedRanges(
  source,
  ranges
) {
  if (!ranges.length) {
    return source;
  }

  const characters =
    [...source];

  for (const range of ranges) {
    const start =
      Math.max(
        0,
        range.start
      );

    const end =
      Math.min(
        characters.length,
        range.end
      );

    for (
      let index = start;
      index < end;
      index++
    ) {
      characters[index] = " ";
    }
  }

  return characters.join("");
}

export function parseScratchpadAttributes(
  attributeSource
) {
  const source =
    String(attributeSource ?? "")
      .trim();

  const attributes =
    Object.create(null);

  const entries = [];
  const duplicates = [];
  const matchedRanges = [];

  const expression =
    /([A-Za-z_][A-Za-z0-9_-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

  let match;

  while (
    (
      match =
        expression.exec(source)
    ) !== null
  ) {
    const name =
      match[1];

    const rawValue =
      match[2] !== undefined
        ? match[2]
        : match[3];

    const value =
      decodeScratchpadXmlEntities(
        rawValue
      );

    if (
      Object.hasOwn(
        attributes,
        name
      )
    ) {
      duplicates.push({
        name,

        previousValue:
          attributes[name],

        duplicateValue:
          value,
      });
    }

    attributes[name] =
      value;

    entries.push({
      name,
      value,
      rawValue,

      quote:
        match[2] !== undefined
          ? '"'
          : "'",

      index:
        match.index,

      raw:
        match[0],
    });

    matchedRanges.push({
      start:
        match.index,

      end:
        match.index +
        match[0].length,
    });

    if (
      match[0].length === 0
    ) {
      expression.lastIndex++;
    }
  }

  const unparsed =
    removeMatchedRanges(
      source,
      matchedRanges
    )
      .replace(/\/\s*$/, "")
      .trim();

  return {
    source,
    attributes,
    entries,
    duplicates,
    unparsed,

    malformed:
      unparsed.length > 0,
  };
}

/* ============================================================
   FRAGMENT INSPECTION
============================================================ */

function removeIgnorableFragments(fragment) {
  return String(fragment ?? "")
    .replace(
      /<!--[\s\S]*?-->/g,
      ""
    )
    .trim();
}

function recordMalformedFragment({
  malformedRecords,
  fragment,
  start,
  end,
  reason,
}) {
  const cleaned =
    removeIgnorableFragments(
      fragment
    );

  if (!cleaned) {
    return;
  }

  malformedRecords.push({
    reason,
    start,
    end,
    raw:
      fragment,
  });
}

/* ============================================================
   OPERATION EXTRACTION
============================================================ */

/*
 * Matches either:
 *
 * <NO_UPDATE/>
 *
 * or:
 *
 * <NOTE ref="..." confidence="...">
 * text
 * </NOTE>
 *
 * Raw angle brackets inside operation text are prohibited by the
 * prompt, so this tolerant expression is sufficient for the current
 * sparse protocol.
 */
const OPERATION_EXPRESSION =
  /<\s*([A-Za-z_][A-Za-z0-9_-]*)\b([^>]*?)(?:\/\s*>|>([\s\S]*?)<\s*\/\s*\1\s*>)/gi;

function createParsedOperation(
  match,
  operationIndex
) {
  const raw =
    match[0];

  const rawTag =
    match[1];

  const tag =
    normalizeScratchpadOperationTag(
      rawTag
    );

  const attributeSource =
    match[2] ?? "";

  const rawText =
    match[3] === undefined
      ? ""
      : match[3];

  const attributeResult =
    parseScratchpadAttributes(
      attributeSource
    );

  const definition =
    getScratchpadOperationDefinition(
      tag
    );

  const selfClosing =
    /\/\s*>$/.test(
      raw
    );

  return {
    index:
      operationIndex,

    sourceIndex:
      match.index ?? 0,

    tag,
    rawTag,

    known:
      Boolean(definition),

    type:
      definition?.type ??
      null,

    selfClosing,

    attributes:
      attributeResult.attributes,

    attributeEntries:
      attributeResult.entries,

    duplicateAttributes:
      attributeResult.duplicates,

    unparsedAttributeText:
      attributeResult.unparsed,

    hasMalformedAttributes:
      attributeResult.malformed,

    text:
      decodeScratchpadXmlEntities(
        rawText.trim()
      ),

    rawText,
    raw,
  };
}

function extractOperationsFromInnerText(
  inner
) {
  const operations = [];
  const malformedRecords = [];

  const expression =
    new RegExp(
      OPERATION_EXPRESSION.source,
      OPERATION_EXPRESSION.flags
    );

  let previousEnd = 0;
  let match;

  while (
    (
      match =
        expression.exec(inner)
    ) !== null
  ) {
    recordMalformedFragment({
      malformedRecords,

      fragment:
        inner.slice(
          previousEnd,
          match.index
        ),

      start:
        previousEnd,

      end:
        match.index,

      reason:
        "Unparsed content between operation records.",
    });

    operations.push(
      createParsedOperation(
        match,
        operations.length
      )
    );

    previousEnd =
      match.index +
      match[0].length;

    if (
      match[0].length === 0
    ) {
      expression.lastIndex++;
    }
  }

  recordMalformedFragment({
    malformedRecords,

    fragment:
      inner.slice(
        previousEnd
      ),

    start:
      previousEnd,

    end:
      inner.length,

    reason:
      "Unparsed content after the final operation record.",
  });

  return {
    operations,
    malformedRecords,
  };
}

/* ============================================================
   MAIN PARSER
============================================================ */

export function parseScratchpadCommsOutput(
  repairedOutput
) {
  const source =
    repairedOutput == null
      ? ""
      : String(
          repairedOutput
        ).trim();

  const wrapper =
    extractScratchpadWrapper(
      source
    );

  if (
    !wrapper.found ||
    !wrapper.complete
  ) {
    return {
      status: "failure",

      source,

      wrapperFound:
        wrapper.found,

      wrapperComplete:
        wrapper.complete,

      wrapperCount:
        wrapper.wrapperCount,

      operations: [],
      malformedRecords: [],

      unknownTags: [],

      noUpdate: false,
      hasOperations: false,

      errors:
        [...wrapper.errors],

      diagnostics: {
        inputCharacters:
          source.length,

        innerCharacters:
          wrapper.inner.length,

        operationCount: 0,
        knownOperationCount: 0,
        unknownOperationCount: 0,
        malformedRecordCount: 0,
        duplicateAttributeCount: 0,
        malformedAttributeCount: 0,

        prefixCharacters:
          wrapper.prefix.length,

        suffixCharacters:
          wrapper.suffix.length,
      },
    };
  }

  const extraction =
    extractOperationsFromInnerText(
      wrapper.inner
    );

  const operations =
    extraction.operations;

  const unknownTags =
    operations
      .filter(
        (operation) =>
          !operation.known
      )
      .map(
        (operation) => ({
          index:
            operation.index,

          tag:
            operation.tag,

          raw:
            operation.raw,
        })
      );

  const noUpdate =
    operations.some(
      (operation) =>
        operation.tag ===
        "NO_UPDATE"
    );

  const knownOperationCount =
    operations.filter(
      (operation) =>
        operation.known
    ).length;

  const duplicateAttributeCount =
    operations.reduce(
      (
        total,
        operation
      ) =>
        total +
        operation
          .duplicateAttributes
          .length,
      0
    );

  const malformedAttributeCount =
    operations.filter(
      (operation) =>
        operation
          .hasMalformedAttributes
    ).length;

  let status =
    "success";

  if (
    operations.length === 0
  ) {
    status =
      extraction
        .malformedRecords
        .length > 0
        ? "failure"
        : "empty";
  } else if (
    extraction
      .malformedRecords
      .length > 0
  ) {
    status =
      "partial";
  }

  const errors = [];

  if (
    wrapper.wrapperCount > 1
  ) {
    errors.push(
      `Found ${wrapper.wrapperCount} opening ${WRAPPER} wrappers; only the first complete block was parsed.`
    );
  }

  if (
    wrapper.prefix.trim()
  ) {
    errors.push(
      "Text exists before the parsed wrapper."
    );
  }

  if (
    wrapper.suffix.trim()
  ) {
    errors.push(
      "Text exists after the parsed wrapper."
    );
  }

  return {
    status,

    source,

    wrapperFound: true,
    wrapperComplete: true,

    wrapperCount:
      wrapper.wrapperCount,

    wrapperBlock:
      wrapper.block,

    inner:
      wrapper.inner,

    operations,

    malformedRecords:
      extraction.malformedRecords,

    unknownTags,

    noUpdate,

    hasOperations:
      operations.length > 0,

    errors,

    diagnostics: {
      inputCharacters:
        source.length,

      innerCharacters:
        wrapper.inner.length,

      operationCount:
        operations.length,

      knownOperationCount,

      unknownOperationCount:
        unknownTags.length,

      malformedRecordCount:
        extraction
          .malformedRecords
          .length,

      duplicateAttributeCount,

      malformedAttributeCount,

      prefixCharacters:
        wrapper.prefix.length,

      suffixCharacters:
        wrapper.suffix.length,
    },
  };
}

/* ============================================================
   CONVENIENCE HELPERS
============================================================ */

export function parseScratchpadCommsOperations(
  repairedOutput
) {
  return parseScratchpadCommsOutput(
    repairedOutput
  ).operations;
}

export function hasParsedScratchpadNoUpdate(
  parsedResult
) {
  return Boolean(
    parsedResult?.noUpdate
  );
}
