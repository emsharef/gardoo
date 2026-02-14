import { describe, it, expect } from "vitest";
import { createTestCaller } from "../../test-utils.js";

describe("auth router", () => {
  it("should register a new user and return a token", async () => {
    const caller = createTestCaller();

    const result = await caller.auth.register({
      email: `test-${Date.now()}@example.com`,
      password: "password123",
    });

    expect(result.token).toBeDefined();
    expect(typeof result.token).toBe("string");
    expect(result.user.email).toContain("@example.com");
    expect(result.user.id).toBeDefined();
  });

  it("should login with correct credentials", async () => {
    const caller = createTestCaller();
    const email = `test-${Date.now()}@example.com`;
    const password = "password123";

    await caller.auth.register({ email, password });

    const result = await caller.auth.login({ email, password });

    expect(result.token).toBeDefined();
    expect(typeof result.token).toBe("string");
    expect(result.user.email).toBe(email);
  });

  it("should reject wrong password", async () => {
    const caller = createTestCaller();
    const email = `test-${Date.now()}@example.com`;

    await caller.auth.register({ email, password: "password123" });

    await expect(
      caller.auth.login({ email, password: "wrongpassword" }),
    ).rejects.toThrow("Invalid credentials");
  });
});
