import {defineApi} from "../../api/define-api.js";
import {ModelLibrary} from "../model-library.js";

export type Needle3Model = {
  complete(input: {prompt: string; tools?: readonly unknown[]; schema?: unknown}): Promise<unknown>;
  embed(input: string): Promise<readonly number[]>;
};

export const needle3Metadata = {
  id: "model.cactus-needle3",
  name: "Needle 3",
  provider: "Cactus Compute",
  version: "3",
  description: "Tiny structured inference model for tool selection, argument extraction, classification, and embeddings.",
  size: {value: 8, unit: "MB", qualifier: "range"},
  capabilities: ["tool-selection", "argument-extraction", "classification", "structured-output", "embeddings"],
  input: "Natural-language text with optional tools or extraction schema",
  output: "Structured JSON or embedding vector",
  runtime: "Cactus Needle runtime adapter",
  modelUri: "Cactus-Compute/needle3",
} as const;

export const needle3CompleteApi = defineApi({
  id: "model.cactus-needle3.complete",
  name: "Needle3.complete",
  category: "models",
  description: "Select tools or extract structured data from natural-language input.",
  parameters: [
    {name: "prompt", description: "Natural-language input.", required: true, schema: {type: "string"}},
    {name: "tools", description: "Optional tool definitions.", required: false, schema: {type: "array"}},
    {name: "schema", description: "Optional extraction schema.", required: false, schema: {type: "object"}},
  ],
  output: {type: "object", description: "Structured model result."},
  semantics: {deterministic: false, pure: false, sideEffects: false},
});

export class Needle3 extends ModelLibrary<Needle3Model> {
  constructor(runtime: import("../model-types.js").ModelRuntime<Needle3Model>) {
    super(needle3Metadata, runtime);
  }

  complete(input: {prompt: string; tools?: readonly unknown[]; schema?: unknown}): Promise<unknown> {
    return this.withModel((model) => model.complete(input));
  }

  embed(input: string): Promise<readonly number[]> {
    return this.withModel((model) => model.embed(input));
  }
}
