import { beforeEach, describe, expect, test, vi } from "vitest";

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "Content-Type": "application/json", ...(init.headers || {}) }
  });
}

describe("api client", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_API_BASE_URL", "http://api.test");
  });

  test("normalizes login identifiers and stores the returned token", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ access_token: "jwt-1", token_type: "bearer" }));
    vi.stubGlobal("fetch", fetchMock);
    const { login } = await import("@/lib/api");
    const { getToken } = await import("@/lib/auth");

    await login("  CREATOR@EXAMPLE.COM  ", " password123 ");

    expect(fetchMock).toHaveBeenCalledWith(
      "http://api.test/auth/login",
      expect.objectContaining({
        method: "POST",
        cache: "no-store",
        headers: expect.any(Headers)
      })
    );
    const body = fetchMock.mock.calls[0][1].body as URLSearchParams;
    expect(body.get("username")).toBe("creator@example.com");
    expect(body.get("password")).toBe(" password123 ");
    expect(getToken()).toBe("jwt-1");
  });

  test("adds auth headers, maps validation errors, and clears invalid tokens", async () => {
    window.localStorage.setItem("photo_ai_token", "bad-token");
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ detail: [{ msg: "prompt required" }] }, { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);
    const { generateImage } = await import("@/lib/api");
    const { getToken } = await import("@/lib/auth");

    await expect(generateImage({ prompt: "", style: "realistic" })).rejects.toThrow("prompt required");

    const headers = fetchMock.mock.calls[0][1].headers as Headers;
    expect(headers.get("Authorization")).toBe("Bearer bad-token");
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(fetchMock.mock.calls[0][1].cache).toBe("no-store");
    expect(getToken()).toBeNull();
  });

  test("fetchImageBlob uses authenticated no-store image requests", async () => {
    window.localStorage.setItem("photo_ai_token", "jwt-2");
    const blob = new Blob(["png"], { type: "image/png" });
    const fetchMock = vi.fn().mockResolvedValue(new Response(blob, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { fetchImageBlob } = await import("@/lib/api");

    await expect(fetchImageBlob("/api/images/output/a.png")).resolves.toBeInstanceOf(Blob);

    expect(fetchMock).toHaveBeenCalledWith(
      "http://api.test/api/images/output/a.png",
      expect.objectContaining({
        cache: "no-store",
        headers: expect.any(Headers)
      })
    );
    expect((fetchMock.mock.calls[0][1].headers as Headers).get("Authorization")).toBe("Bearer jwt-2");
  });
});
