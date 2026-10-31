import {beforeEach, describe, expect, it, vi} from "vitest";

const completeMock = vi.fn();
const similarityMock = vi.fn();
const rerankMock = vi.fn();

vi.mock("../models/needle3/index.js", () => ({
  Needle3: class {
    complete(args: {prompt: string; schema?: unknown}) {
      return completeMock(args);
    }
  },
}));

vi.mock("../models/minilm/index.js", () => ({
  MiniLM: class {
    similarity(args: {left: string; right: string}) {
      return similarityMock(args);
    }
  },
}));

vi.mock("../models/ettin/index.js", () => ({
  EttinReranker17M: class {
    rerank(args: {query: string; candidates: readonly string[]}) {
      return rerankMock(args);
    }
  },
}));

import {rankSemanticInputCandidates, resolveSemanticInput} from "./index.js";

describe("GutTS universal semantic input", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    similarityMock.mockImplementation(async () => 0.5);
    rerankMock.mockImplementation(async ({candidates}: {candidates: readonly string[]}) =>
      candidates.map((_, i) => candidates.length - i),
    );
    completeMock.mockImplementation(async () => ({output: "default"}));
  });

  it("1. Needle receives the target schema", async () => {
    const targetSchema = {type: "object", properties: {age: {type: "integer"}}, required: ["age"]};
    completeMock.mockResolvedValueOnce({output: {age: 32}});

    await resolveSemanticInput({
      input: "I am thirty-two",
      schema: targetSchema,
    });

    expect(completeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        schema: targetSchema,
      }),
    );
  });

  it("2. Context is included in semantic resolution", async () => {
    completeMock.mockResolvedValueOnce({output: {country: "Canada"}});

    await resolveSemanticInput({
      input: "from Toronto",
      schema: {type: "object", properties: {country: {type: "string"}}},
      context: {
        page: "Profile",
        section: "Geography",
        field: "originCountry",
        label: "Origin Country",
        description: "Country of residence",
        semanticType: "geo-country",
        vocabulary: ["Canada", "USA"],
        examples: ["Canada", "Mexico"],
        constraints: ["Must be ISO compliant"],
      },
    });

    expect(completeMock).toHaveBeenCalled();
    const callArgs = completeMock.mock.calls[0]?.[0];
    expect(callArgs.prompt).toContain("Page: Profile");
    expect(callArgs.prompt).toContain("Section: Geography");
    expect(callArgs.prompt).toContain("Field: originCountry");
    expect(callArgs.prompt).toContain("Label: Origin Country");
    expect(callArgs.prompt).toContain("Description: Country of residence");
    expect(callArgs.prompt).toContain("Semantic type: geo-country");
    expect(callArgs.prompt).toContain("Vocabulary: Canada, USA");
    expect(callArgs.prompt).toContain("Examples: Canada | Mexico");
    expect(callArgs.prompt).toContain("Constraints: Must be ISO compliant");
  });

  it("3. Natural language is converted into structured output", async () => {
    completeMock.mockResolvedValueOnce({
      output: {
        quantity: 5,
        item: "apples",
      },
    });

    const result = await resolveSemanticInput<{quantity: number; item: string}>({
      input: "five apples please",
      schema: {
        type: "object",
        properties: {quantity: {type: "integer"}, item: {type: "string"}},
      },
    });

    expect(result.status).toBe("resolved");
    expect(result.value).toEqual({quantity: 5, item: "apples"});
  });

  it("4. Candidate ranking uses existing MiniLM + Ettin models", async () => {
    similarityMock.mockImplementation(async ({right}) => (right === "May" ? 0.88 : 0.42));
    rerankMock.mockResolvedValueOnce([10.5, 2.1]);

    const ranked = await rankSemanticInputCandidates("mage", ["May", "March"]);

    expect(similarityMock).toHaveBeenCalledTimes(2);
    expect(rerankMock).toHaveBeenCalledWith(
      expect.objectContaining({
        query: "mage",
        candidates: ["May", "March"],
      }),
    );
    expect(ranked[0]?.value).toBe("May");
    expect(ranked[0]?.similarity).toBe(0.88);
    expect(ranked[0]?.relevance).toBe(10.5);
  });

  it("5. Candidate ordering is deterministic with tie-breaking", async () => {
    similarityMock.mockResolvedValue(0.5);
    // All candidates return equal relevance score
    rerankMock.mockResolvedValueOnce([5.0, 5.0, 5.0]);

    const ranked = await rankSemanticInputCandidates("query", ["Zeta", "Alpha", "Beta"]);

    // Equal relevance and similarity falls back to alphabetical
    expect(ranked.map((c) => c.value)).toEqual(["Alpha", "Beta", "Zeta"]);
  });

  it("6. Empty candidate sets work correctly", async () => {
    completeMock.mockResolvedValueOnce({output: "Plain output"});
    const ranked = await rankSemanticInputCandidates("query", []);
    expect(ranked).toEqual([]);

    const result = await resolveSemanticInput({
      input: "Plain query",
      schema: {type: "string"},
      candidates: [],
    });
    expect(result.status).toBe("resolved");
    expect(result.value).toBe("Plain output");
    expect(result.candidates).toEqual([]);
  });

  it("7. Invalid/empty model output becomes invalid rather than fabricated data", async () => {
    completeMock.mockResolvedValueOnce({output: null});

    const resultNull = await resolveSemanticInput({
      input: "gibberish 123",
      schema: {type: "object"},
      context: {vocabulary: ["One", "Two"]},
    });
    expect(resultNull.status).toBe("invalid");
    expect(resultNull.value).toBeUndefined();

    completeMock.mockResolvedValueOnce({output: ""});
    const resultEmpty = await resolveSemanticInput({
      input: "something",
      schema: {type: "string"},
    });
    expect(resultEmpty.status).toBe("invalid");
    expect(resultEmpty.value).toBeUndefined();
  });

  it("8. preserveRawInput defaults to false", async () => {
    completeMock.mockResolvedValueOnce({output: 42});

    const result = await resolveSemanticInput({
      input: "forty-two",
      schema: {type: "integer"},
    });

    expect(result.status).toBe("resolved");
    expect(result.value).toBe(42);
    expect("rawInput" in result).toBe(false);
  });

  it("9. preserveRawInput: true returns the original input", async () => {
    completeMock.mockResolvedValueOnce({output: 42});

    const result = await resolveSemanticInput({
      input: "  forty-two  ",
      schema: {type: "integer"},
      preserveRawInput: true,
    });

    expect(result.status).toBe("resolved");
    expect(result.value).toBe(42);
    expect(result.rawInput).toBe("  forty-two  ");
  });

  it("10. Contextual example resolves through schema/context pipeline without hard-coded replacements", async () => {
    similarityMock.mockImplementation(async ({right}) => (right === "May" ? 0.95 : 0.3));
    rerankMock.mockResolvedValueOnce([12.0, 1.0]);
    completeMock.mockResolvedValueOnce({output: "May"});

    const result = await resolveSemanticInput({
      input: "23 mage 1994",
      schema: {type: "string"},
      context: {
        field: "Date of Birth",
        semanticType: "date",
        vocabulary: ["May", "March"],
      },
      preserveRawInput: true,
    });

    expect(result.status).toBe("resolved");
    expect(result.value).toBe("May");
    expect(result.rawInput).toBe("23 mage 1994");
    expect(result.candidates[0]?.value).toBe("May");
  });

  describe("Edge cases", () => {
    it("handles empty or whitespace-only input safely", async () => {
      const emptyResult = await resolveSemanticInput({
        input: "",
        schema: {type: "string"},
      });
      expect(emptyResult.status).toBe("invalid");
      expect(emptyResult.value).toBeUndefined();
      expect(completeMock).not.toHaveBeenCalled();

      const whitespaceResult = await resolveSemanticInput({
        input: "    \t\n  ",
        schema: {type: "string"},
        preserveRawInput: true,
      });
      expect(whitespaceResult.status).toBe("invalid");
      expect(whitespaceResult.rawInput).toBe("    \t\n  ");
      expect(completeMock).not.toHaveBeenCalled();
    });

    it("handles model exceptions safely", async () => {
      completeMock.mockRejectedValueOnce(new Error("Needle inference timeout"));

      const result = await resolveSemanticInput({
        input: "failing query",
        schema: {type: "string"},
      });

      expect(result.status).toBe("invalid");
      expect(result.value).toBeUndefined();
    });
  });
});
