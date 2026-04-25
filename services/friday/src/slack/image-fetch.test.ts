import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchSlackImages } from "./image-fetch.js";

// Mock the global fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function makeResponse(
  ok: boolean,
  body: Uint8Array,
  contentType = "image/png"
): Response {
  return {
    ok,
    headers: { get: (h: string) => (h === "content-type" ? contentType : null) },
    arrayBuffer: async () => body.buffer.slice(
      body.byteOffset,
      body.byteOffset + body.byteLength
    ),
  } as unknown as Response;
}

beforeEach(() => {
  mockFetch.mockReset();
});

describe("fetchSlackImages", () => {
  it("returns empty array for empty file list", async () => {
    expect(await fetchSlackImages([], "tok")).toEqual([]);
  });

  it("skips files with no url_private", async () => {
    const result = await fetchSlackImages(
      [{ mimetype: "image/png" }],
      "tok"
    );
    expect(result).toEqual([]);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("skips non-image files", async () => {
    const result = await fetchSlackImages(
      [{ url_private: "https://files.slack.com/doc.pdf", mimetype: "application/pdf" }],
      "tok"
    );
    expect(result).toEqual([]);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("downloads and base64-encodes an image", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    mockFetch.mockResolvedValue(makeResponse(true, bytes, "image/png"));

    const result = await fetchSlackImages(
      [{ url_private: "https://files.slack.com/img.png", mimetype: "image/png" }],
      "my-token"
    );

    expect(mockFetch).toHaveBeenCalledWith(
      "https://files.slack.com/img.png",
      { headers: { Authorization: "Bearer my-token" } }
    );
    expect(result).toHaveLength(1);
    expect(result[0].mediaType).toBe("image/png");
    expect(result[0].data).toBe(Buffer.from(bytes).toString("base64"));
  });

  it("uses Content-Type header mediaType over file mimetype", async () => {
    const bytes = new Uint8Array([0xff, 0xd8]);
    mockFetch.mockResolvedValue(makeResponse(true, bytes, "image/jpeg; charset=utf-8"));

    const result = await fetchSlackImages(
      [{ url_private: "https://files.slack.com/img.jpg", mimetype: "image/png" }],
      "tok"
    );

    expect(result[0].mediaType).toBe("image/jpeg");
  });

  it("falls back to file mimetype when Content-Type header is absent", async () => {
    const bytes = new Uint8Array([1]);
    mockFetch.mockResolvedValue({
      ok: true,
      headers: { get: () => null },
      arrayBuffer: async () => bytes.buffer,
    } as unknown as Response);

    const result = await fetchSlackImages(
      [{ url_private: "https://files.slack.com/img.gif", mimetype: "image/gif" }],
      "tok"
    );

    expect(result[0].mediaType).toBe("image/gif");
  });

  it("skips files that return non-ok HTTP response", async () => {
    mockFetch.mockResolvedValue({ ok: false } as Response);

    const result = await fetchSlackImages(
      [{ url_private: "https://files.slack.com/img.png", mimetype: "image/png" }],
      "tok"
    );
    expect(result).toEqual([]);
  });

  it("skips files that throw on fetch, continuing with others", async () => {
    const bytes = new Uint8Array([99]);
    mockFetch
      .mockRejectedValueOnce(new Error("network error"))
      .mockResolvedValueOnce(makeResponse(true, bytes, "image/png"));

    const result = await fetchSlackImages(
      [
        { url_private: "https://files.slack.com/bad.png", mimetype: "image/png" },
        { url_private: "https://files.slack.com/good.png", mimetype: "image/png" },
      ],
      "tok"
    );

    expect(result).toHaveLength(1);
    expect(result[0].data).toBe(Buffer.from(bytes).toString("base64"));
  });
});
