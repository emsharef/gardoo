import { describe, it, expect } from "vitest";
import { createTestCaller } from "../../test-utils.js";

describe("apiKeys router", () => {
  // These tests require a running Postgres database with ENCRYPTION_KEY set.
  // They verify the router compiles correctly and demonstrate expected usage.

  const TEST_USER_ID = "00000000-0000-4000-a000-000000000001";
  const OTHER_USER_ID = "00000000-0000-4000-a000-000000000002";

  it("should store a key and return id, provider, createdAt but NOT the key value", async () => {
    const caller = createTestCaller(TEST_USER_ID);

    const result = await caller.apiKeys.store({
      provider: "claude",
      key: "sk-ant-test-key-12345",
    });

    expect(result.id).toBeDefined();
    expect(result.provider).toBe("claude");
    expect(result.createdAt).toBeDefined();
    // Must NOT contain the actual key
    expect(result).not.toHaveProperty("key");
    expect(result).not.toHaveProperty("encryptedKey");
    expect(result).not.toHaveProperty("iv");
    expect(result).not.toHaveProperty("authTag");
  });

  it("should list keys without exposing key values", async () => {
    const caller = createTestCaller(TEST_USER_ID);

    await caller.apiKeys.store({ provider: "claude", key: "sk-test-1" });
    await caller.apiKeys.store({ provider: "kimi", key: "kimi-test-1" });

    const keys = await caller.apiKeys.list();

    expect(keys.length).toBeGreaterThanOrEqual(2);
    for (const k of keys) {
      expect(k.id).toBeDefined();
      expect(k.provider).toBeDefined();
      expect(k.createdAt).toBeDefined();
      expect(k).not.toHaveProperty("encryptedKey");
      expect(k).not.toHaveProperty("iv");
      expect(k).not.toHaveProperty("authTag");
      expect(k).not.toHaveProperty("key");
    }
  });

  it("should delete a key", async () => {
    const caller = createTestCaller(TEST_USER_ID);

    const stored = await caller.apiKeys.store({
      provider: "kimi",
      key: "kimi-to-delete",
    });
    const result = await caller.apiKeys.delete({ id: stored.id });

    expect(result.success).toBe(true);

    // Verify it no longer appears in list
    const keys = await caller.apiKeys.list();
    const found = keys.find((k) => k.id === stored.id);
    expect(found).toBeUndefined();
  });

  it("should replace existing key when storing for same provider", async () => {
    const caller = createTestCaller(TEST_USER_ID);

    await caller.apiKeys.store({ provider: "claude", key: "first-key" });
    await caller.apiKeys.store({ provider: "claude", key: "second-key" });

    const keys = await caller.apiKeys.list();
    const claudeKeys = keys.filter((k) => k.provider === "claude");

    // Only one key per provider
    expect(claudeKeys).toHaveLength(1);
  });

  it("should not delete another user's key", async () => {
    const caller1 = createTestCaller(TEST_USER_ID);
    const caller2 = createTestCaller(OTHER_USER_ID);

    const stored = await caller1.apiKeys.store({
      provider: "claude",
      key: "user1-secret",
    });

    // Other user tries to delete it — should silently do nothing
    await caller2.apiKeys.delete({ id: stored.id });

    // Original user should still see the key
    const keys = await caller1.apiKeys.list();
    const found = keys.find((k) => k.id === stored.id);
    expect(found).toBeDefined();
  });
});
