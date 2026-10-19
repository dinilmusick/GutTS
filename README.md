# GutTS

Gut stands for Global Utilities. Gut is the aggregate library for the very basic functions and operations needed by KrnlTS services, FrnlTS components, Skipo applications, and other code assets. Its purpose is to prevent multiple libraries from solving the same foundational problems.

## Structure

Each category is a directory with a `<category>-concepts.ts` facade. The facade re-exports small implementation files containing focused functions and category-owned shared types.

Current categories: JSON, strings, arrays, objects, numbers, and URLs.

## Library policy

GutTS is an aggregation layer, not a collection of reimplemented utility algorithms.

- Prefer mature, widely adopted, well-maintained libraries when they provide the required primitive.
- Current third-party utility dependencies are Lodash ES modules for general-purpose collections/string/number/object operations and Validator for email validation.
- JSON and URL operations use the platform's native implementations because `JSON` and `URL` are established runtime primitives rather than functionality that benefits from another abstraction.
- Keep GutTS wrappers small and stable; do not duplicate the implementation of the underlying library.
- Keep application/domain-specific behavior out of GutTS.

## Design rules

- Prefer small, composable functions.
- Keep category facades stable.
- Keep shared types beside the category that owns them.
- Add regression tests for every public utility family.
