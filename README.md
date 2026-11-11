# GutTS

Gut stands for Global Utilities. Gut is the aggregate library for the very basic functions and operations needed by KrnlTS services, FrnlTS components, Skipo applications, and other code assets. Its purpose is to prevent multiple libraries from solving the same foundational problems.

## Structure

Each category is a directory with a stable facade. GutTS contains both deterministic utilities and narrowly scoped model-backed libraries.

Current categories: JSON, strings, arrays, objects, numbers, URLs, API definitions, and model libraries.

## Model libraries

Every model is a named library with its own metadata, semantic API definitions, and runtime lifecycle.

Models include SmolLM2-135M-Instruct for general text generation, Needle 3 for tool selection and extraction, Whistle for speech-to-text, Ettin Reranker for candidate ranking, and MiniLM for semantic similarity.

Model weights are not bundled into the GutTS npm package. A model runtime acquires them when an operation needs the model and may cache the artifact on disk. ModelResidency keeps the model in RAM only while operations are active, shares one loaded instance for concurrent calls in the same process, and unloads it when the final operation completes.

GutTS does not contain a resolver, intelligence specification, or application-level routing system. Model metadata describes when a model is appropriate; selecting among models remains the responsibility of higher-level application logic.

## Runtime entrypoints

The default package entry and `./browser` are Web-standard entry graphs intended for browsers, Workers, and Fetch-based runtimes. They do not read Node process state or load Node-only adapters.

Node-specific capabilities are explicit subpaths: `./server`, `./server/auth`, `./server/models`, and `./server/storage`. The existing `./storage` export remains as a compatibility alias.

Model classes keep their public constructors and accept a runtime adapter. Browser and Worker consumers use the default browser runtime. Node consumers inject the server adapter:

```ts
import { Needle3 } from "@dinilmusick/gutts/models";
import { nodeCactusNeedle3Runtime } from "@dinilmusick/gutts/server/models";

const needle = new Needle3(nodeCactusNeedle3Runtime);
```

For server-side Luth configuration, resolve `APP_URL` through `resolveServerRuntimeAppUrl()` from `./server/auth` and pass the result as the client's explicit `origin`. The portable auth client itself reads the Web `location` API and never accesses `process.env`.

## Library policy

GutTS is an aggregation layer, not a collection of reimplemented utility algorithms.

- Prefer mature, widely adopted, well-maintained libraries when they provide the required primitive.
- Keep wrappers small and stable.
- Keep application/domain-specific behavior out of GutTS.
- Model runtimes are adapters: model artifacts and execution engines remain replaceable without changing the named model API.

## Design rules

- Prefer small, composable functions.
- Keep category facades stable.
- Keep shared types beside the category that owns them.
- Add regression tests for every public utility family and model lifecycle guarantee.

<!-- storage-provider-ci-validation -->
