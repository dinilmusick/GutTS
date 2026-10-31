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
  application?: string;
  workspace?: string;
  page?: string;
  section?: string;
  form?: string;
  field?: string;
  label?: string;
  description?: string;
  semanticType?: string;
  vocabulary?: readonly string[];
  examples?: readonly string[];
  aliases?: readonly string[];
  constraints?: readonly string[];
  locale?: string;
  relatedFields?: readonly string[];
};

export type SemanticInputErrorCode =
  | "EMPTY_INPUT"
  | "MODEL_FAILURE"
  | "MODEL_OUTPUT_EMPTY"
  | "SCHEMA_MISMATCH"
  | "AMBIGUOUS_CANDIDATE"
  | "UNSUPPORTED_TYPE"
  | "ABORTED";

export type SemanticInputRisk = "low" | "medium" | "high";

export type SemanticInputPolicy = {
  risk?: SemanticInputRisk;
  requireConfirmation?: boolean;
};

export type SemanticInputCandidate = {
  value: string;
  similarity?: number | undefined;
  relevance?: number | undefined;
};

export type SemanticInputEvidence = {
  needleOutput?: unknown;
  candidates: readonly SemanticInputCandidate[];
  selectedCandidate?: string;
  similarityThreshold?: number;
  relevanceMarginThreshold?: number;
};

export type SemanticInputClarification = {
  question: string;
  candidates: readonly string[];
};

export type SemanticInputResolution<T = unknown> = {
  status: "resolved" | "ambiguous" | "invalid" | "unsupported" | "unresolved" | "failed";
  value?: T;
  rawInput?: string;
  candidates: readonly SemanticInputCandidate[];
  modelOutput: unknown;
  evidence?: SemanticInputEvidence;
  clarification?: SemanticInputClarification;
  error?: {
    code: SemanticInputErrorCode;
    message: string;
  };
  requiresConfirmation?: boolean;
};

export type SemanticInputCacheKey = string;

export class SemanticInputCache {
  private readonly entries = new Map<SemanticInputCacheKey, SemanticInputResolution>();

  constructor(private readonly maxEntries = 128) {}

  get<T>(key: SemanticInputCacheKey): SemanticInputResolution<T> | undefined {
    const value = this.entries.get(key);
    if (!value) return undefined;
    this.entries.delete(key);
    this.entries.set(key, value);
    return value as SemanticInputResolution<T>;
  }

  set<T>(key: SemanticInputCacheKey, value: SemanticInputResolution<T>): void {
    this.entries.delete(key);
    this.entries.set(key, value);
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}

export type SemanticInputRequest = {
  input: string;
  schema: SemanticInputSchema;
  context?: SemanticInputContext;
  candidates?: readonly string[];
  preserveRawInput?: boolean;
  minCandidateSimilarity?: number;
  minCandidateMargin?: number;
  policy?: SemanticInputPolicy;
  cache?: SemanticInputCache;
  signal?: AbortSignal;
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
    request.context?.application ? `Application: ${request.context.application}` : "",
    request.context?.workspace ? `Workspace: ${request.context.workspace}` : "",
    request.context?.page ? `Page: ${request.context.page}` : "",
    request.context?.section ? `Section: ${request.context.section}` : "",
    request.context?.form ? `Form: ${request.context.form}` : "",
    request.context?.field ? `Field: ${request.context.field}` : "",
    request.context?.label ? `Label: ${request.context.label}` : "",
    request.context?.description ? `Description: ${request.context.description}` : "",
    request.context?.semanticType ? `Semantic type: ${request.context.semanticType}` : "",
    request.context?.vocabulary?.length ? `Vocabulary: ${request.context.vocabulary.join(", ")}` : "",
    request.context?.examples?.length ? `Examples: ${request.context.examples.join(" | ")}` : "",
    request.context?.aliases?.length ? `Aliases: ${request.context.aliases.join(", ")}` : "",
    request.context?.constraints?.length ? `Constraints: ${request.context.constraints.join("; ")}` : "",
    request.context?.relatedFields?.length ? `Related fields: ${request.context.relatedFields.join(", ")}` : "",
    request.context?.locale ? `Locale: ${request.context.locale}` : "",
    request.candidates?.length ? `Candidate values: ${request.candidates.join(" | ")}` : "",
    `Target schema: ${JSON.stringify(request.schema)}`,
    `Input: ${request.input}`,
  ].filter(Boolean).join("\n");
}

function cacheKey(request: SemanticInputRequest): SemanticInputCacheKey {
  return JSON.stringify({
    input: request.input,
    schema: request.schema,
    context: request.context,
    candidates: request.candidates,
    preserveRawInput: request.preserveRawInput ?? false,
    minCandidateSimilarity: request.minCandidateSimilarity ?? 0.65,
    minCandidateMargin: request.minCandidateMargin ?? 0.15,
    policy: request.policy,
  });
}

function confirmationRequired(policy?: SemanticInputPolicy): boolean {
  return policy?.requireConfirmation === true || policy?.risk === "high";
}

function deterministicValue(input: string, schema: SemanticInputSchema): unknown {
  const trimmed = input.trim();
  if (schema.enum?.some((candidate) => candidate === trimmed)) return trimmed;
  if (schema.type === "string") {
    if (schema.format === "email" && /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(trimmed)) return trimmed;
    if (schema.format === "uri" && /^https?:\\/\\//i.test(trimmed)) return trimmed;
    if (schema.format === "date" && /^\\d{4}-\\d{2}-\\d{2}$/.test(trimmed)) return trimmed;
    if (schema.format === "date-time" && /^\\d{4}-\\d{2}-\\d{2}T/.test(trimmed)) return trimmed;
    if (schema.pattern && new RegExp(String(schema.pattern)).test(trimmed)) return trimmed;
    if (!schema.format && !schema.pattern) return trimmed;
  }
  if (schema.type === "number") {
    const value = Number(trimmed);
    return Number.isFinite(value) ? value : undefined;
  }
  if (schema.type === "integer") {
    const value = Number(trimmed);
    return Number.isInteger(value) ? value : undefined;
  }
  if (schema.type === "boolean") {
    if (trimmed.toLowerCase() === "true") return true;
    if (trimmed.toLowerCase() === "false") return false;
  }
  return undefined;
}

export function resolveDeterministicSemanticInput<T = unknown>(
  input: string,
  schema: SemanticInputSchema,
): SemanticInputResolution<T> | undefined {
  if (!input.trim()) return undefined;
  const value = deterministicValue(input, schema);
  if (value === undefined) return undefined;
  return {
    status: "resolved",
    value: value as T,
    candidates: [],
    modelOutput: value,
  };
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

function clarificationFor(candidates: readonly SemanticInputCandidate[], context?: SemanticInputContext): SemanticInputClarification | undefined {
  const values = candidates.slice(0, 3).map((candidate) => candidate.value);
  if (values.length < 2) return undefined;
  const label = context?.label ?? context?.field ?? "this field";
  return {
    question: `Which value did you mean for ${label}: ${values.join(", ")}?`,
    candidates: values,
  };
}

export async function resolveSemanticInput<T = unknown>(
  request: SemanticInputRequest,
): Promise<SemanticInputResolution<T>> {
  const preserveRaw = request.preserveRawInput ?? false;
  const confirmed = confirmationRequired(request.policy);
  if (request.signal?.aborted) {
    return {
      status: "failed",
      ...(preserveRaw ? {rawInput: request.input} : {}),
      candidates: [],
      modelOutput: undefined,
      error: {code: "ABORTED", message: "Semantic resolution was aborted."},
    };
  }

  const cached = request.cache?.get<T>(cacheKey(request));
  if (cached) return cached;

  if (!request.input || !request.input.trim()) {
    const result: SemanticInputResolution<T> = {
      status: "invalid",
      ...(preserveRaw ? {rawInput: request.input} : {}),
      candidates: [],
      modelOutput: undefined,
      error: {code: "EMPTY_INPUT", message: "Semantic input is empty."},
    };
    request.cache?.set(cacheKey(request), result);
    return result;
  }

  const deterministic = resolveDeterministicSemanticInput<T>(request.input, request.schema);
  if (deterministic) {
    const result = {...deterministic, ...(confirmed ? {requiresConfirmation: true} : {})};
    request.cache?.set(cacheKey(request), result);
    return result;
  }

  const candidateList = request.candidates?.length ? request.candidates : (request.context?.vocabulary ?? []);
  const candidates = candidateList.length ? await rankSemanticInputCandidates(request.input, candidateList) : [];

  if (request.signal?.aborted) {
    return {
      status: "failed",
      ...(preserveRaw ? {rawInput: request.input} : {}),
      candidates,
      modelOutput: undefined,
      error: {code: "ABORTED", message: "Semantic resolution was aborted."},
    };
  }

  const needle = new Needle3();
  let rawOutput: unknown;
  try {
    rawOutput = await needle.complete({
      prompt: buildPrompt(request),
      schema: request.schema,
    });
  } catch {
    return {
      status: "failed",
      ...(preserveRaw ? {rawInput: request.input} : {}),
      candidates,
      modelOutput: undefined,
      error: {code: "MODEL_FAILURE", message: "Needle structured resolution failed."},
    };
  }

  const modelOutput = unwrapModelOutput(rawOutput);
  if (modelOutput === undefined || modelOutput === null || modelOutput === "") {
    return {
      status: "unresolved",
      ...(preserveRaw ? {rawInput: request.input} : {}),
      candidates,
      modelOutput,
      error: {code: "MODEL_OUTPUT_EMPTY", message: "Needle returned no usable semantic value."},
    };
  }

  let value: T | undefined;
  let selectedCandidate: string | undefined;

  if (candidates.length && typeof modelOutput === "string") {
    const exact = candidates.find((candidate) => candidate.value === modelOutput);
    if (exact) {
      value = exact.value as T;
      selectedCandidate = exact.value;
    } else {
      const top = candidates[0];
      const second = candidates[1];
      const minSimilarity = request.minCandidateSimilarity ?? 0.65;
      const minMargin = request.minCandidateMargin ?? 0.15;
      const similarityPass = (top?.similarity ?? -Infinity) >= minSimilarity;
      const margin = second ? (top?.relevance ?? -Infinity) - (second.relevance ?? -Infinity) : Infinity;
      if (top && similarityPass && margin >= minMargin) {
        value = top.value as T;
        selectedCandidate = top.value;
      }
    }
  } else {
    value = modelOutput as T;
  }

  const evidence: SemanticInputEvidence = {
    needleOutput: modelOutput,
    candidates,
    ...(selectedCandidate ? {selectedCandidate} : {}),
    ...(candidates.length ? {
      similarityThreshold: request.minCandidateSimilarity ?? 0.65,
      relevanceMarginThreshold: request.minCandidateMargin ?? 0.15,
    } : {}),
  };

  if (value === undefined || value === null) {
    const result: SemanticInputResolution<T> = {
      status: candidates.length > 0 ? "ambiguous" : "invalid",
      ...(preserveRaw ? {rawInput: request.input} : {}),
      candidates,
      modelOutput,
      evidence,
      ...(candidates.length > 1 ? {clarification: clarificationFor(candidates, request.context)} : {}),
      error: candidates.length
        ? {code: "AMBIGUOUS_CANDIDATE", message: "Semantic evidence did not uniquely identify a candidate."}
        : {code: "SCHEMA_MISMATCH", message: "The model output could not be resolved to the target schema."},
    };
    request.cache?.set(cacheKey(request), result);
    return result;
  }

  const result: SemanticInputResolution<T> = {
    status: "resolved",
    value,
    ...(preserveRaw ? {rawInput: request.input} : {}),
    candidates,
    modelOutput,
    evidence,
    ...(confirmed ? {requiresConfirmation: true} : {}),
  };
  request.cache?.set(cacheKey(request), result);
  return result;
}
