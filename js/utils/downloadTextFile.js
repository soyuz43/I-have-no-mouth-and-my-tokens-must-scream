// js/utils/downloadTextFile.js
//
// Minimal, robust file download helper for browser environment.
// Used by exporter to write CSV files to disk.

export function downloadTextFile(filename, text) {
  try {
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });

    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = filename;

    // Required for Firefox
    document.body.appendChild(a);
    a.click();

    // Cleanup
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

  } catch (err) {
    console.error("[DOWNLOAD] Failed to save file:", err);
  }
}