import {describe, expect, it} from "vitest";
import {guttsApiById, guttsApiDefinitions} from "../src/api/index.js";

describe("GutTS semantic API definitions", () => {
  it("defines every currently exported runtime API", () => {
    expect(guttsApiDefinitions).toHaveLength(33);
    expect(new Set(guttsApiDefinitions.map((api) => api.name)).size).toBe(33);
    expect(guttsApiDefinitions.every((api) => api.id.startsWith("gutts."))).toBe(true);
  });

  it("provides machine-readable input schemas", () => {
    for (const api of guttsApiDefinitions) {
      expect(api.inputSchema.type).toBe("object");
      expect(api.inputSchema.additionalProperties).toBe(false);
      expect(api.inputSchema.properties).toBeDefined();
      expect(api.output).toBeDefined();
      expect(api.description.length).toBeGreaterThan(20);
      expect(api.semantics).toEqual({deterministic: true, pure: true, sideEffects: false});
    }
  });

  it("indexes definitions by stable identifier", () => {
    expect(guttsApiById["gutts.numbers.clamp"]?.name).toBe("clamp");
    expect(guttsApiById["gutts.strings.truncateWords"]?.name).toBe("truncateWords");
    expect(guttsApiById["gutts.urls.setQueryParam"]?.name).toBe("setQueryParam");
  });
});
