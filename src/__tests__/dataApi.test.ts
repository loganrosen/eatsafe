import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchJson } from "../dataApi.js";

beforeEach(() => vi.restoreAllMocks());

describe("fetchJson", () => {
  it("returns a useful message for network failures", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));

    await expect(fetchJson("https://example.com")).rejects.toThrow(
      "Could not reach the inspection data service.",
    );
  });

  it("preserves abort errors", async () => {
    const error = new Error("aborted");
    error.name = "AbortError";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(error));

    await expect(fetchJson("https://example.com")).rejects.toBe(error);
  });

  it("reports invalid JSON responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.reject(new SyntaxError("invalid JSON")),
      }),
    );

    await expect(fetchJson("https://example.com")).rejects.toThrow(
      "The inspection data service returned an invalid response.",
    );
  });
});
