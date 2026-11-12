# Runtime compatibility contract

A runtime is supported only when its emitted dependency graph and an actual runtime smoke test pass. TypeScript compilation alone is not evidence of runtime compatibility.

| Environment | Entry point | Contract |
|---|---|---|
| Universal JavaScript | `@dinilmusick/gutts` | ESM utilities, API definitions, metadata, and Web-standard functionality. No Node built-ins or eager platform adapters. |
| Browser | `@dinilmusick/gutts/browser` | Browser-facing utility surface, including the Luth client. Browser storage APIs are accessed only behind guarded operations. |
| Cloudflare Workers / Fetch runtimes | `@dinilmusick/gutts/worker` | Worker-focused Web-standard utilities, API definitions, and engineering metadata. No model runtime, filesystem, process, or provider adapter exports. |
| Node.js | `@dinilmusick/gutts/server` | Node adapter surface. Provider integrations are separate explicit subpaths. |
| Node.js storage | `@dinilmusick/gutts/storage/s3`, `@dinilmusick/gutts/storage/google-drive` | Optional provider adapters loaded only when their respective subpath is imported or loader invoked. |
| Node.js models | `@dinilmusick/gutts/server/models` | Explicit Node Cactus runtime adapters to inject into model classes. |

## Module format

GutTS is ESM-only. `type`, `main`, `module`, `types`, and `exports` point to the same emitted ESM package contract. CommonJS is not advertised and no synthetic CommonJS wrapper is shipped. Use dynamic `import()` from CommonJS applications.

## Boundary rules

- Universal and Worker entrypoints must not statically import Node built-ins, process/filesystem implementations, browser-only APIs, or optional provider SDKs.
- Importing `/server` must not import storage providers.
- Importing `/storage/s3` must not load Google APIs; importing `/storage/google-drive` must not load the AWS SDK.
- Browser and Worker consumers must not import `/server` or storage adapters.
- Model execution requires an explicit runtime choice. Browser model adapters are loaded only when a model operation is invoked; Node consumers inject adapters from `/server/models`.

## Verification gates

CI builds the package, inspects emitted dependency closures, installs a packed tarball in clean consumers, resolves each public export, imports universal and Worker entries, and executes the Worker entry in Miniflare/Wrangler's local Workers runtime. Provider isolation tests ensure optional SDKs do not leak across adapter boundaries. Worker support is claimed only for the Worker entrypoint and only to the extent demonstrated by the runtime smoke test; this does not imply that every model backend or optional provider SDK runs in Workers.
