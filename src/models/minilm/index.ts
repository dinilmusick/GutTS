import {defineApi} from "../../api/define-api.js";
import {ModelLibrary} from "../model-library.js";

export type MiniLMModel = {
  similarity(input: {left: string; right: string}): Promise<number>;
};

export const miniLML4Metadata = {
  id: "model.minilm-l4-v2",
  name: "MiniLM-L4-v2",
  provider: "Sentence Transformers",
  version: "L4-v2",
  description: "Tiny sentence embedding model for semantic similarity.",
  size: {value: 19, unit: "params" as const, qualifier: "parameters" as const},
  capabilities: ["embeddings", "semantic-similarity"],
  input: "Two text strings",
  output: "Similarity score",
  runtime: "ModelRuntime adapter",
  modelUri: "sentence-transformers/all-MiniLM-L4-v2",
  license: "Apache-2.0",
} as const;

export const miniLML6Metadata = {
  ...miniLML4Metadata,
  id: "model.minilm-l6-v2",
  name: "MiniLM-L6-v2",
  version: "L6-v2",
  size: {value: 23, unit: "params" as const, qualifier: "parameters" as const},
  modelUri: "sentence-transformers/all-MiniLM-L6-v2",
} as const;

export const miniLMSimilarityApi = defineApi({
  id: "model.minilm.similarity",
  name: "MiniLM.similarity",
  category: "models",
  description: "Compute semantic similarity between two texts.",
  parameters: [
    {name: "left", description: "First text.", required: true, schema: {type: "string"}},
    {name: "right", description: "Second text.", required: true, schema: {type: "string"}},
  ],
  output: {type: "number", description: "Semantic similarity score."},
  semantics: {deterministic: true, pure: false, sideEffects: false},
});

export class MiniLM extends ModelLibrary<MiniLMModel> {
  constructor(readonly modelMetadata: typeof miniLML4Metadata, runtime: import("../model-types.js").ModelRuntime<MiniLMModel>) {
    super(modelMetadata, runtime);
  }

  similarity(input: {left: string; right: string}): Promise<number> {
    return this.withModel((model) => model.similarity(input));
  }
}
