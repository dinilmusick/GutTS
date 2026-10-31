import {EttinReranker17M} from "../models/ettin/index.js";
import {MiniLM} from "../models/minilm/index.js";
import {Needle3} from "../models/needle3/index.js";

export type SemanticInputSchema = {
  type: string;
  properties?: Record<string, SemanticInputSchema>;
  required?: readonly string[];
  enum?: readonly unknown[];
  items?: SemanticInputSchema;
  description?: string;
  [key: string]: unknown;
};

export type SemanticInputContext = {
  page?: string;
  section?: string;
  field?: string;
  label?: string;
  description?: string;
  semanticType?: string;
  vocabulary?: readonly string[];
  examples?: readonly string[];
  constraints?: readonly string[];
};

export type SemanticInputRequest = {
  input: string;
  schema: SemanticInputSchema;
  context?: SemanticInputContext;
  candidates?: readonly string[];
  preserveRawInput?: boolean;
};

export type SemanticInputCandidate = {
  value: string;
  similarity?: number | undefined;
  relevance?: number | undefined;
};

export type SemanticInputResolution<T = unknown> = {
  status: "resolved" | "ambiguous" | "invalid";
  value?: T;
  rawInput?: string;
  candidates: readonly SemanticInputCandidate[];
  modelOutput: unknown;
};

function unwrapModelOutput(output: unknown): unknown {
  if (!output || typeof output !== "object") return output;
  const record = output as Record<string, unknown>;
  for (const key of ["output", "result", "data", "structuredOutput"]) {
    if (key in record) return record[key];
  }
  return output;
}

function buildPrompt(request: SemanticInputRequest): string {
  return [
    "Convert the natural-language input into the supplied target schema.",
    "Return only data conforming to the target schema. Never invent information.",
    request.context?.page ? `Page: ${request.context.page}` : "",
    request.context?.section ? `Section: ${request.context.section}` : "",
    request.context?.field ? `Field: ${request.context.field}` : "",
    request.context?.label ? `Label: ${request.context.label}` : "",
    request.context?.description ? `Description: ${request.context.description}` : "",
    request.context?.semanticType ? `Semantic type: ${request.context.semanticType}` : "",
    request.context?.vocabulary?.length ? `Vocabulary: ${request.context.vocabulary.join(", ")}` : "",
    request.context?.examples?.length ? `Examples: ${request.context.examples.join(" | ")}` : "",
    request.context?.constraints?.length ? `Constraints: ${request.context.constraints.join("; ")}` : "",
    request.candidates?.length ? `Candidate values: ${request.candidates.join(" | ")}` : "",
    `Target schema: ${JSON.stringify(request.schema)}`,
    `Input: ${request.input}`,
  ].filter(Boolean).join("\n");
}

export async function rankSemanticInputCandidates(
  input: string,
  candidates: readonly string[],
): Promise<readonly SemanticInputCandidate[]> {
  if (candidates.length === 0) return [];
  const similarityModel = new MiniLM();
  const reranker = new EttinReranker17M();
  const similarities = await Promise.all(
    candidates.map((candidate) => similarityModel.similarity({left: input, right: candidate})),
  );
  const relevance = await reranker.rerank({query: input, candidates});
  return candidates
    .map((value, index) => ({value, similarity: similarities[index], relevance: relevance[index]}))
    .sort((a, b) => {
      const relDiff = (b.relevance ?? -Infinity) - (a.relevance ?? -Infinity);
      if (relDiff !== 0) return relDiff;
      const simDiff = (b.similarity ?? -Infinity) - (a.similarity ?? -Infinity);
      if (simDiff !== 0) return simDiff;
      return a.value.localeCompare(b.value);
    });
}

export async function resolveSemanticInput<T = unknown>(
  request: SemanticInputRequest,
): Promise<SemanticInputResolution<T>> {
  if (!request.input || !request.input.trim()) {
    return {
      status: "invalid",
      ...(request.preserveRawInput ? {rawInput: request.input} : {}),
      candidates: [],
      modelOutput: undefined,
    };
  }

  const candidateList = request.candidates?.length
    ? request.candidates
    : (request.context?.vocabulary ?? []);
  const candidates = candidateList.length
    ? await rankSemanticInputCandidates(request.input, candidateList)
    : [];

  const needle = new Needle3();
  let rawOutput: unknown;
  try {
    rawOutput = await needle.complete({
      prompt: buildPrompt(request),
      schema: request.schema,
    });
  } catch {
    return {
      status: "invalid",
      ...(request.preserveRawInput ? {rawInput: request.input} : {}),
      candidates,
      modelOutput: undefined,
    };
  }

  const modelOutput = unwrapModelOutput(rawOutput);

  if (modelOutput === undefined || modelOutput === null || modelOutput === "") {
    return {
      status: "invalid",
      ...(request.preserveRawInput ? {rawInput: request.input} : {}),
      candidates,
      modelOutput,
    };
  }

  const value = (candidates.length && typeof modelOutput === "string"
    ? candidates[0]?.value
    : modelOutput) as T | undefined;

  if (value === undefined || value === null) {
    return {
      status: candidates.length > 1 ? "ambiguous" : "invalid",
      ...(request.preserveRawInput ? {rawInput: request.input} : {}),
      candidates,
      modelOutput,
    };
  }

  return {
    status: "resolved",
    value,
    ...(request.preserveRawInput ? {rawInput: request.input} : {}),
    candidates,
    modelOutput,
  };
}
