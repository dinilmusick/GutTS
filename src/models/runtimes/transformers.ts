import type {ModelRuntime} from "../model-types.js";
import type {SmolLM2Model} from "../smollm2/index.js";
import type {MiniLMModel} from "../minilm/index.js";
import type {EttinRerankerModel} from "../ettin/index.js";

type DisposablePipeline = {
  (input: unknown, options?: Record<string, unknown>): Promise<unknown>;
  dispose?: () => Promise<void> | void;
};

async function createPipeline(task: string, model: string): Promise<DisposablePipeline> {
  const {pipeline} = await import("@huggingface/transformers");
  return (await pipeline(task as never, model)) as unknown as DisposablePipeline;
}

export const smolLM2Runtime: ModelRuntime<SmolLM2Model> = {
  async load() {
    const pipe = await createPipeline("text-generation", "HuggingFaceTB/SmolLM2-135M-Instruct");
    return {
      generate: async (input) => {
        const output = await pipe(input.prompt, {
          max_new_tokens: input.maxNewTokens,
          ...(input.maxNewTokens === undefined ? {} : {max_new_tokens: input.maxNewTokens}),
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
    await model.dispose();
  },
};

export const miniLMRuntime: ModelRuntime<MiniLMModel> = {
  async load() {
    const pipe = await createPipeline("feature-extraction", "sentence-transformers/all-MiniLM-L6-v2");
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
    await model.dispose();
  },
};

export const ettinRuntime: ModelRuntime<EttinRerankerModel> = {
  async load(metadata) {
    const pipe = await createPipeline("text-classification", metadata.modelUri!);
    return {
      rerank: async ({query, candidates}) => {
        const output = await pipe(
          candidates.map((candidate) => ({text: query, text_pair: candidate})),
        );
        if (!Array.isArray(output)) throw new Error("Ettin runtime returned an invalid result.");
        return output.map((item) => {
          if (!item || typeof item !== "object" || !("score" in item)) {
            throw new Error("Ettin runtime returned an invalid score.");
          }
          return Number((item as {score: unknown}).score);
        });
      },
      dispose: async () => pipe.dispose?.(),
    };
  },
  async unload(model) {
    await model.dispose();
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
    dot += left[i] * right[i];
    leftNorm += left[i] * left[i];
    rightNorm += right[i] * right[i];
  }
  return dot / Math.sqrt(leftNorm * rightNorm);
}
