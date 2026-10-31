import {describe, expect, it, vi} from "vitest";

vi.mock("../models/needle3/index.js", () => ({
  Needle3: class { async complete() { return {output: "May"}; } },
}));
vi.mock("../models/minilm/index.js", () => ({
  MiniLM: class { async similarity() { return 0.9; } },
}));
vi.mock("../models/ettin/index.js", () => ({
  EttinReranker17M: class {
    async rerank({candidates}: {candidates: readonly string[]}) {
      return candidates.map((_, index) => candidates.length - index);
    }
  },
}));

import {rankSemanticInputCandidates, resolveSemanticInput} from "./index.js";

describe("semantic input", () => {
  it("uses Needle structured extraction with context and schema", async () => {
    const result = await resolveSemanticInput({
      input: "23 mage 1994",
      schema: {type: "object", properties: {month: {type: "string"}}},
      context: {field: "Date of Birth", semanticType: "date", vocabulary: ["May", "March"]},
      preserveRawInput: true,
    });
    expect(result.status).toBe("resolved");
    expect(result.value).toBe("May");
    expect(result.rawInput).toBe("23 mage 1994");
  });

  it("uses existing MiniLM and Ettin models for candidate ranking", async () => {
    const result = await rankSemanticInputCandidates("mage", ["May", "March"]);
    expect(result[0]?.value).toBe("May");
  });
});
