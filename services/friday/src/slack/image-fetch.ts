import type { ImageAttachment } from "../sessions/queue.js";

interface SlackFile {
  url_private?: string;
  mimetype?: string;
}

/**
 * Download image files attached to a Slack message and return them as
 * base64-encoded ImageAttachments. Non-image files are silently skipped.
 * Slack private file URLs require the bot token for authentication.
 */
export async function fetchSlackImages(
  files: SlackFile[],
  token: string
): Promise<ImageAttachment[]> {
  const results: ImageAttachment[] = [];

  for (const file of files) {
    const url = file.url_private;
    if (!url) continue;

    const mimeType = file.mimetype ?? "";
    if (!mimeType.startsWith("image/")) continue;

    try {
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) continue;

      const contentType = response.headers.get("content-type") ?? mimeType;
      const mediaType = contentType.split(";")[0].trim() || mimeType;

      const buffer = await response.arrayBuffer();
      const data = Buffer.from(buffer).toString("base64");

      results.push({ data, mediaType });
    } catch {
      // Skip files that fail to download — don't abort the whole message
    }
  }

  return results;
}
