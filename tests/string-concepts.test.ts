import {describe,expect,it} from "vitest";
import {camelCase,isBlank,kebabCase,truncate} from "../src/strings/string-concepts.js";
describe("string concepts",()=>{it("provides predicates and transforms",()=>{expect(isBlank(" \t")).toBe(true);expect(camelCase("hello-world")).toBe("helloWorld");expect(kebabCase("helloWorld")).toBe("hello-world");expect(truncate("abcdef",4)).toBe("abc…");});});