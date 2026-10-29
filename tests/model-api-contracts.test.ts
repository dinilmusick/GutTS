import {describe, expect, it} from "vitest";
import {
  ettinRerankApi,
  guttsApiById,
  miniLMSimilarityApi,
  needle3CompleteApi,
  smolLM2GenerateApi,
  whistleTranscribeApi,
} from "../src/index.js";

describe("model API contracts", () => {
  it("exposes every named model operation through the semantic registry", () => {
    for (const api of [
      smolLM2GenerateApi,
      needle3CompleteApi,
      whistleTranscribeApi,
      ettinRerankApi,
      miniLMSimilarityApi,
    ]) {
      expect(guttsApiById[api.id]).toBe(api);
      expect(api.inputSchema.type).toBe("object");
      expect(api.description.length).toBeGreaterThan(0);
    }
  });
});
