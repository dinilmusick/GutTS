# GutTS

Gut stands for Global Utilities. Gut is the aggregate library for the very basic functions and operations needed by KrnlTS services, FrnlTS components, Skipo applications, and other code assets. Its purpose is to prevent multiple libraries from solving the same foundational problems.

## Structure

Each category is a directory with a `<category>-concepts.ts` facade. The facade re-exports small implementation files containing focused functions and category-owned shared types.

Current categories: JSON, strings, arrays, objects, numbers, and URLs.

The package intentionally has zero runtime dependencies. Standard-library implementations keep this foundational package cheap to consume; established packages can be introduced where they provide functionality that should not be maintained locally.

## Design rules

- Prefer small, composable functions.
- Keep category facades stable.
- Keep shared types beside the category that owns them.
- Keep application/domain-specific behavior out of GutTS.
- Add regression tests for every public utility family.
