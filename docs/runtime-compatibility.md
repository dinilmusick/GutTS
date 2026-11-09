# Runtime compatibility contract

This document records the runtime contract established by the current public package surfaces. A surface is not considered supported merely because its TypeScript source compiles.

| Environment | Surface | Status | Evidence / limitation |
|---|---|---|---|
| Browser | `@dinilmusick/gutts/browser` | Candidate; import smoke test required | Dedicated browser entry exists. Its transitive closure must remain free of Node built-ins and server-only providers. |
| Node.js | `@dinilmusick/gutts`, `@dinilmusick/gutts/server` | Intended | The root and server surfaces are not interchangeable with the browser surface. |
| Cloudflare Workers | No dedicated Worker export | Unsupported / unverified | Do not infer Worker support from Fetch-compatible APIs alone. |
| Build-time tooling | package build and boundary scripts | Node.js tooling | Scripts may use Node filesystem and process APIs; they are not runtime package exports. |
| TypeScript consumers | package export declarations | Declared; consumer verification required | Declarations must resolve for each public subpath independently. |

## Boundary rules

- Browser consumers must import `/browser`, not the package root or `/server`.
- Node-only storage/provider implementations must not enter the browser dependency closure.
- Optional providers must not be eagerly imported by unrelated public surfaces.
- Worker compatibility remains unclaimed until a dedicated Worker-compatible dependency closure and a Workers-runtime execution test exist.

## Verification gates

For every claimed surface, CI must build the package, install its packed tarball into a clean consumer, import the exact subpath without browser globals unless that surface requires them, and compile a TypeScript consumer against its declarations. Browser claims additionally require a browser-compatible test environment; Worker claims require execution in a Workers-compatible runtime.
