import {arrayApis} from "./array-apis.js";
import {jsonApis} from "./json-apis.js";
import {numberApis} from "./number-apis.js";
import {objectApis} from "./object-apis.js";
import {stringApis} from "./string-apis.js";
import {urlApis} from "./url-apis.js";
import type {ApiDefinition} from "./api-types.js";

export const guttsApiDefinitions: readonly ApiDefinition[] = Object.freeze([
  ...arrayApis,
  ...jsonApis,
  ...numberApis,
  ...objectApis,
  ...stringApis,
  ...urlApis,
]);

export const guttsApiById: Readonly<Record<string, ApiDefinition>> = Object.freeze(
  Object.fromEntries(guttsApiDefinitions.map((api) => [api.id, api])),
);
