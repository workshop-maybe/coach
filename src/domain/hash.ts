// Assignment version (KTD5): a short SHA-256 of the normalized task and rubric.
// Uses Web Crypto so the same code runs in the Tauri webview and in Node tests.

/** Hex chars kept from the digest. */
const VERSION_LENGTH = 12;

/** LF line endings, no trailing whitespace per line, no blank edge lines. */
function normalize(text: string): string {
  const lines = text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+$/, ""));
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start] === "") start++;
  while (end > start && lines[end - 1] === "") end--;
  return lines.slice(start, end).join("\n");
}

/** Whitespace-only edits keep the version. Any other task or rubric edit changes it. */
export async function assignmentVersion(task: string, rubric: string): Promise<string> {
  // A JSON array keeps the task/rubric boundary unambiguous.
  const input = JSON.stringify([normalize(task), normalize(rubric)]);
  const bytes = new TextEncoder().encode(input);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, VERSION_LENGTH);
}
