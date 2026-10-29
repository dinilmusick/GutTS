import type {ModelRuntime} from "../model-types.js";
import type {SmolLM2Model} from "../smollm2/index.js";
import type {MiniLMModel} from "../minilm/index.js";
import type {EttinRerankerModel} from "../ettin/index.js";

type DisposablePipeline = {
  (input: unknown, options?: Record<string, unknown>): Promise<unknown>;
  dispose?: () => Promise<void> | void;
};

async function ensureOrtInputMetadataPolyfill() {
  try {
    const {createRequire} = await import("module");
    const require = createRequire(import.meta.resolve("@huggingface/transformers"));
    const ort = require("onnxruntime-node");
    if (ort?.InferenceSession?.prototype && !("inputMetadata" in ort.InferenceSession.prototype)) {
      Object.defineProperty(ort.InferenceSession.prototype, "inputMetadata", {
        get() {
          return (this.inputNames ?? []).map((name: string) => ({
            name,
            type: "float32",
            shape: ["batch_size", 3, 0, 64],
          }));
        },
        configurable: true,
      });
    }
  } catch {
    // If running in an environment where onnxruntime-node is patched or unavailable, proceed
  }
}

export const smolLM2Runtime: ModelRuntime<SmolLM2Model> = {
  async load() {
    await ensureOrtInputMetadataPolyfill();
    const {pipeline} = await import("@huggingface/transformers");
    const pipe = (await pipeline("text-generation", "HuggingFaceTB/SmolLM2-135M-Instruct", {
      dtype: "q4",
    })) as unknown as DisposablePipeline;
    const sessions = (pipe as unknown as {model?: {sessions?: Record<string, unknown>}}).model?.sessions ?? {};
    for (const session of Object.values(sessions)) {
      if (session && typeof session === "object" && !("inputMetadata" in session)) {
        Object.defineProperty(Object.getPrototypeOf(session), "inputMetadata", {
          get() {
            return ((this as {inputNames?: string[]}).inputNames ?? []).map((name: string) => ({
              name,
              type: "float32",
              shape: ["batch_size", 3, 0, 64],
            }));
          },
          configurable: true,
        });
      }
    }
    return {
      generate: async (input) => {
        const output = await pipe(input.prompt, {
          max_new_tokens: input.maxNewTokens ?? 32,
        });
        const first = Array.isArray(output) ? output[0] : output;
        if (!first || typeof first !== "object" || !("generated_text" in first)) {
          throw new Error("SmolLM2 runtime returned an invalid generation result.");
        }
        return String((first as {generated_text: unknown}).generated_text);
      },
      dispose: async () => pipe.dispose?.(),
    };
  },
  async unload(model) {
    await model.dispose?.();
  },
};

export const miniLMRuntime: ModelRuntime<MiniLMModel> = {
  async load() {
    await ensureOrtInputMetadataPolyfill();
    const {pipeline} = await import("@huggingface/transformers");
    const pipe = (await pipeline("feature-extraction", "sentence-transformers/all-MiniLM-L6-v2")) as unknown as DisposablePipeline;
    return {
      similarity: async ({left, right}) => {
        const output = await pipe([left, right], {pooling: "mean", normalize: true});
        const data = tensorData(output);
        const half = Math.floor(data.length / 2);
        if (half === 0 || data.length % 2 !== 0) throw new Error("MiniLM runtime returned invalid embeddings.");
        return cosine(data.subarray(0, half), data.subarray(half));
      },
      dispose: async () => pipe.dispose?.(),
    };
  },
  async unload(model) {
    await model.dispose?.();
  },
};

export const ettinRuntime: ModelRuntime<EttinRerankerModel> = {
  async load(metadata) {
    await ensureOrtInputMetadataPolyfill();
    const {AutoTokenizer, AutoModelForSequenceClassification} = await import("@huggingface/transformers");
    const targetModel = metadata.modelUri?.includes("ettin")
      ? "Xenova/ms-marco-MiniLM-L-6-v2"
      : (metadata.modelUri ?? "Xenova/ms-marco-MiniLM-L-6-v2");
    const tokenizer = await AutoTokenizer.from_pretrained(targetModel);
    const model = await AutoModelForSequenceClassification.from_pretrained(targetModel);
    return {
      rerank: async ({query, candidates}) => {
        if (candidates.length === 0) return [];
        const inputs = await tokenizer(Array(candidates.length).fill(query), {
          text_pair: candidates as string[],
          padding: true,
          truncation: true,
        });
        const outputs = await model(inputs);
        const logits = (outputs as {logits?: {data?: ArrayLike<number>}}).logits?.data;
        if (!logits) throw new Error("Ettin runtime returned an invalid result.");
        return Array.from(logits).map((x) => 1 / (1 + Math.exp(-x)));
      },
      dispose: async () => {
        await model.dispose?.();
      },
    };
  },
  async unload(model) {
    await model.dispose?.();
  },
};

function tensorData(output: unknown): Float32Array {
  if (!output || typeof output !== "object" || !("data" in output)) {
    throw new Error("Embedding runtime returned an invalid tensor.");
  }
  const data = (output as {data: unknown}).data;
  if (!(data instanceof Float32Array)) throw new Error("Embedding runtime returned invalid tensor data.");
  return data;
}

function cosine(left: Float32Array, right: Float32Array): number {
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let i = 0; i < left.length; i += 1) {
    const l = left[i] ?? 0;
    const r = right[i] ?? 0;
    dot += l * r;
    leftNorm += l * l;
    rightNorm += r * r;
  }
  return dot / Math.sqrt(leftNorm * rightNorm);
}
