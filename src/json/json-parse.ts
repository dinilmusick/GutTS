import type {JsonValue} from "./json-value.js";
export function parseJson<T extends JsonValue=JsonValue>(text:string):T{return JSON.parse(text) as T;}
export function tryParseJson<T extends JsonValue=JsonValue>(text:string):T|undefined{try{return parseJson<T>(text);}catch{return undefined;}}
export function stringifyJson(value:JsonValue,space?:number):string{return JSON.stringify(value,null,space);}