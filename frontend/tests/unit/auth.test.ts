import { describe, expect, test } from "vitest";

import { clearToken, getToken, isAuthenticated, setToken } from "@/lib/auth";

describe("auth token storage", () => {
  test("saves, loads, and clears the bearer token", () => {
    expect(getToken()).toBeNull();
    expect(isAuthenticated()).toBe(false);

    setToken("token-1");

    expect(getToken()).toBe("token-1");
    expect(isAuthenticated()).toBe(true);

    clearToken();

    expect(getToken()).toBeNull();
    expect(isAuthenticated()).toBe(false);
  });
});
