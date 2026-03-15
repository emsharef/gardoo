import { describe, it, expect } from "vitest";
import {
  CHAT_TOOL_DEFINITIONS_CLAUDE,
  CHAT_TOOL_DEFINITIONS_OPENAI,
} from "../chatTools";

// ─── Tool Definition Tests ───────────────────────────────────────────────────

describe("CHAT_TOOL_DEFINITIONS_CLAUDE", () => {
  it("has exactly 2 tools", () => {
    expect(CHAT_TOOL_DEFINITIONS_CLAUDE).toHaveLength(2);
  });

  it("defines list_photos and view_photo tools", () => {
    const names = CHAT_TOOL_DEFINITIONS_CLAUDE.map((t) => t.name);
    expect(names).toContain("list_photos");
    expect(names).toContain("view_photo");
  });

  it("list_photos has optional targetType and targetId", () => {
    const listPhotos = CHAT_TOOL_DEFINITIONS_CLAUDE.find(
      (t) => t.name === "list_photos",
    )!;
    expect(listPhotos.input_schema.properties).toHaveProperty("targetType");
    expect(listPhotos.input_schema.properties).toHaveProperty("targetId");
    // Both should be optional (not in required array)
    expect(listPhotos.input_schema.required).not.toContain("targetType");
    expect(listPhotos.input_schema.required).not.toContain("targetId");
  });

  it("view_photo requires photoKey", () => {
    const viewPhoto = CHAT_TOOL_DEFINITIONS_CLAUDE.find(
      (t) => t.name === "view_photo",
    )!;
    expect(viewPhoto.input_schema.properties).toHaveProperty("photoKey");
    expect(viewPhoto.input_schema.required).toContain("photoKey");
  });

  it("all tools have descriptions", () => {
    for (const tool of CHAT_TOOL_DEFINITIONS_CLAUDE) {
      expect(tool.description).toBeTruthy();
      expect(typeof tool.description).toBe("string");
    }
  });
});

describe("CHAT_TOOL_DEFINITIONS_OPENAI", () => {
  it("has exactly 2 tools", () => {
    expect(CHAT_TOOL_DEFINITIONS_OPENAI).toHaveLength(2);
  });

  it("defines list_photos and view_photo with correct function.name", () => {
    const names = CHAT_TOOL_DEFINITIONS_OPENAI.map((t) => t.function.name);
    expect(names).toContain("list_photos");
    expect(names).toContain("view_photo");
  });

  it("all tools have type 'function'", () => {
    for (const tool of CHAT_TOOL_DEFINITIONS_OPENAI) {
      expect(tool.type).toBe("function");
    }
  });

  it("list_photos has optional targetType and targetId", () => {
    const listPhotos = CHAT_TOOL_DEFINITIONS_OPENAI.find(
      (t) => t.function.name === "list_photos",
    )!;
    expect(listPhotos.function.parameters.properties).toHaveProperty(
      "targetType",
    );
    expect(listPhotos.function.parameters.properties).toHaveProperty(
      "targetId",
    );
    expect(listPhotos.function.parameters.required).not.toContain(
      "targetType",
    );
    expect(listPhotos.function.parameters.required).not.toContain("targetId");
  });

  it("view_photo requires photoKey", () => {
    const viewPhoto = CHAT_TOOL_DEFINITIONS_OPENAI.find(
      (t) => t.function.name === "view_photo",
    )!;
    expect(viewPhoto.function.parameters.properties).toHaveProperty(
      "photoKey",
    );
    expect(viewPhoto.function.parameters.required).toContain("photoKey");
  });

  it("all tools have descriptions", () => {
    for (const tool of CHAT_TOOL_DEFINITIONS_OPENAI) {
      expect(tool.function.description).toBeTruthy();
      expect(typeof tool.function.description).toBe("string");
    }
  });
});
