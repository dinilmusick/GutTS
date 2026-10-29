import {defineApi} from "../../api/define-api.js";
import {ModelLibrary} from "../model-library.js";
import type {ModelRuntime} from "../model-types.js";
import {cactusWhistleRuntime} from "../runtimes/cactus.js";

export type WhistleModel = {
  transcribe(input: {audio: Uint8Array; language?: string}): Promise<string>;
  close?: () => Promise<void>;
};

export const whistleMetadata = {
  id: "model.cactus-whistle",
  name: "Whistle",
  provider: "Cactus Compute",
  version: "1",
  description: "Compact CPU speech-recognition model for on-device transcription.",
  examples: ["transcribe a voice note", "transcribe a command"],
  avoidWhen: "Avoid when audio understanding beyond transcription is required.",
  whenToUse: "Use for local speech-to-text when low resource use and privacy matter.",
  size: {value: 16.9, unit: "MB", qualifier: "artifact"},
  capabilities: ["speech-to-text", "on-device", "cpu"],
  input: "Audio bytes",
  output: "Transcribed natural-language text",
  runtime: "Cactus Needle runtime adapter",
  modelUri: "Cactus-Compute/whistle",
} as const;

export const whistleTranscribeApi = defineApi({
  id: "model.cactus-whistle.transcribe",
  name: "Whistle.transcribe",
  category: "models",
  description: "Transcribe speech audio into natural-language text.",
  parameters: [
    {name: "audio", description: "Audio bytes supplied to the speech model.", required: true, schema: {type: "string"}},
    {name: "language", description: "Optional language identifier.", required: false, schema: {type: "string"}},
  ],
  output: {type: "string", description: "Transcribed text."},
  semantics: {deterministic: true, pure: false, sideEffects: false},
});

export class Whistle extends ModelLibrary<WhistleModel> {
  constructor(runtime: ModelRuntime<WhistleModel> = cactusWhistleRuntime) {
    super(whistleMetadata, runtime);
  }

  transcribe(input: {audio: Uint8Array; language?: string}): Promise<string> {
    return this.withModel((model) => model.transcribe(input));
  }
}
