// js/ui/timeline.js

import { G } from "../core/state.js";

const MAX_ROWS = 800;

// Helper: get current time formatted as HH:MM:SS
function formatTime() {
  const d = new Date();
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  const s = String(d.getSeconds()).padStart(2, "0");
  return `${h}:${m}:${s}`;
}

// Mapping of words to their respective colors (case‑insensitive)
const WORD_COLORS = {
  "start":       "#888",        // muted gray
  "written":     "#f39c12",     // orange
  "stats analysis": "#3498db",  // blue
  "journal committed": "#27ae91", 
  "journal complete": "#2ecc71",  // green
  "complete":    "#2ecc71",     // green (fallback)
  "updated":     "#2ecc71",     // green
  "committed":   "#27ae60",     // green
};

// Build a single regex that matches any of the words as whole words (case‑insensitive)
const wordRegex = new RegExp(
  `\\b(${Object.keys(WORD_COLORS).join("|")})\\b`,
  "gi"
);

/**
 * Splits a label into text nodes and colored spans for specific words.
 * @param {string} label - The original label text.
 * @returns {Node[]} Array of text nodes and/or <span> elements.
 */
function colorizeLabel(label) {
  const parts = [];
  let lastIndex = 0;
  let match;

  while ((match = wordRegex.exec(label)) !== null) {
    const matchStart = match.index;
    const matchEnd = matchStart + match[0].length;
    const matchedWord = match[0].toLowerCase();

    // Add plain text before the match
    if (matchStart > lastIndex) {
      parts.push(document.createTextNode(label.slice(lastIndex, matchStart)));
    }

    // Determine the color for this word (use original case for display)
    const color = WORD_COLORS[matchedWord] || "#aaa";
    const span = document.createElement("span");
    span.textContent = label.slice(matchStart, matchEnd);
    span.style.color = color;
    parts.push(span);

    lastIndex = matchEnd;
  }

  // Add remaining text after last match
  if (lastIndex < label.length) {
    parts.push(document.createTextNode(label.slice(lastIndex)));
  }

  // If no matches, return a single text node with the whole label
  if (parts.length === 0) {
    return [document.createTextNode(label)];
  }

  return parts;
}

/**
 * Adds a timeline event to both the simulation state and the UI.
 * @param {string} label - The event description.
 */

export function timelineEvent(label) {
  // 1. Store event in simulation state (persistent)
  G.timeline.push({
    cycle: G.cycle,
    time: Date.now(),
    label
  });

  if (G.timeline.length > G.timelineMax) {
    G.timeline.shift();
  }

  // 2. Update the UI
  const body = document.getElementById("timeline-body");
  if (!body) {
    if (!window._timelineMissing) {
      console.warn("timeline-body element not found");
      window._timelineMissing = true;
    }
    return;
  }

  const row = document.createElement("div");

  // Determine if this is a marker line
  const isMarker = label.startsWith("=====") ||
                   label.startsWith(">>>") ||
                   label.startsWith("//") ||
                   label.startsWith("!!");

  if (isMarker) {
    row.className = "timeline-row timeline-marker";
  } else {
    row.className = "timeline-row";
  }

  // Cycle column
  const cycle = document.createElement("span");
  cycle.className = "timeline-cycle";
  cycle.textContent = `C${G.cycle}`;

  // Time column
  const time = document.createElement("span");
  time.className = "timeline-step";
  time.textContent = formatTime();

  // Label column with arrow prefix
  const labelContainer = document.createElement("span");
  labelContainer.className = "timeline-label";
  labelContainer.appendChild(document.createTextNode(" → "));

  if (isMarker) {
    // For markers, color the entire label in yellow (no word‑by‑word coloring)
    const markerSpan = document.createElement("span");
    markerSpan.textContent = label;
    markerSpan.style.color = "#d1a104"; // yellow
    labelContainer.appendChild(markerSpan);
  } else {
    // For regular lines, apply word‑specific coloring
    const coloredParts = colorizeLabel(label);
    coloredParts.forEach(part => labelContainer.appendChild(part));
  }

  // Assemble row
  row.appendChild(cycle);
  row.appendChild(document.createTextNode(" "));
  row.appendChild(time);
  row.appendChild(labelContainer);

  body.appendChild(row);

  // Trim excess rows
  while (body.children.length > MAX_ROWS) {
    body.removeChild(body.firstChild);
  }

  // Auto‑scroll
  body.scrollTop = body.scrollHeight;
}

/**
 * Clears the timeline display.
 */
export function timelineClear() {
  const body = document.getElementById("timeline-body");
  if (!body) return;
  body.innerHTML = "";
}