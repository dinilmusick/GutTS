# GutTS

Gut stands for Global Utilities. Gut is the aggregate library for the very basic functions and operations needed by KrnlTS services, FrnlTS components, Skipo applications, and other code assets. Its purpose is to prevent multiple libraries from solving the same foundational problems.

## Structure

Each category is a directory with a stable facade. GutTS contains deterministic utilities and narrowly scoped model-backed libraries.

Current categories: JSON, strings, arrays, objects, numbers, URLs, API definitions, and model libraries.

## Runtime entrypoints

- `@dinilmusick/gutts`: universal ESM utilities and API definitions.
- `@dinilmusick/gutts/browser`: browser-facing utilities and Luth client.
- `@dinilmusick/gutts/worker`: Worker-focused Web-standard utilities without model or provider adapters.
- `@dinilmusick/gutts/server`: Node-specific auth/model adapters; storage is deliberately excluded.
- `@dinilmusick/gutts/storage/s3`: AWS S3 adapter (optional `@aws-sdk/client-s3` peer).
- `@dinilmusick/gutts/storage/google-drive`: lazy Google Drive adapter (optional `googleapis` peer).
- `@dinilmusick/gutts/server/models`: Node Cactus runtime adapters to inject into model classes.

GutTS is ESM-only. CommonJS consumers should use dynamic `import()`; CommonJS compatibility is not claimed.

## Model libraries

Every model is a named library with its own metadata, semantic API definitions, and runtime lifecycle. Model weights are not bundled into the GutTS npm package. Model classes accept runtime adapters; Node consumers can inject the explicit adapters from `@dinilmusick/gutts/server/models`. Browser defaults load browser runtimes only when inference is requested.

GutTS does not contain a resolver, intelligence specification, or application-level routing system. Model metadata describes when a model is appropriate; selecting among models remains the responsibility of higher-level application logic.

## Storage adapters

Use provider-specific entrypoints in new code. `storage/s3` loads only the AWS SDK; `storage/google-drive` loads Google APIs only when `loadGoogleApis()` or `createGoogleDriveClient()` is called. The legacy `storage` and `server/storage` aggregate entrypoints preserve the historical `S3Client`, `google`, and `drive_v3` exports and therefore load their provider modules when explicitly imported. Neither aggregate is re-exported by the universal root or `server` entrypoint.

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
