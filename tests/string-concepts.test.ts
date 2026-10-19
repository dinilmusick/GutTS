import {describe,expect,it} from "vitest";
import {camelCase,endsWithAny,isBlank,isEmail,kebabCase,startsWithAny,truncate} from "../src/strings/string-concepts.js";

describe("string concepts",()=>{
  it("provides predicates and transforms",()=>{
    expect(isBlank(" \t")).toBe(true);
    expect(isEmail("user@example.com")).toBe(true);
    expect(isEmail("not-an-email")).toBe(false);
    expect(startsWithAny("hello-world",["no","hello"])).toBe(true);
    expect(endsWithAny("hello-world",["world"])).toBe(true);
    expect(camelCase("hello-world")).toBe("helloWorld");
    expect(kebabCase("helloWorld")).toBe("hello-world");
    expect(truncate("abcdef",4)).toBe("abc…");
  });
});
