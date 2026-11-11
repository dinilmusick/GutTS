import {afterAll,describe,expect,it} from "vitest";
import fs from "node:fs";
import path from "node:path";
import {builtinModules} from "node:module";

const root=process.cwd();
const dist=path.join(root,"dist");
const builtinNames=new Set([...builtinModules,...builtinModules.map((name)=>`node:${name}`)]);
const forbiddenPackages=new Set([
  "@aws-sdk/client-s3",
  "@aws-sdk/credential-provider-node",
  "googleapis",
  "onnxruntime-node",
  "node-gyp-build",
]);
const failures:string[]=[];
const visited=new Set<string>();
const packageRoots=new Set<string>();

function fileCandidates(target:string):string[]{
  return [target,`${target}.js`,`${target}.mjs`,`${target}.cjs`,`${target}.json`,path.join(target,"index.js"),path.join(target,"index.mjs")];
}
function resolveFile(target:string):string{
  const found=fileCandidates(target).find((candidate)=>fs.existsSync(candidate)&&fs.statSync(candidate).isFile());
  if(!found)throw new Error(`Cannot resolve emitted module: ${target}`);
  return fs.realpathSync(found);
}
function nearestPackage(from:string):string{
  let current=path.dirname(from);
  while(true){
    const manifest=path.join(current,"package.json");
    if(fs.existsSync(manifest))return current;
    const parent=path.dirname(current);
    if(parent===current)throw new Error(`No package scope found for ${from}`);
    current=parent;
  }
}
function conditionalTarget(value:any):string|null{
  if(typeof value==="string")return value;
  if(Array.isArray(value)){for(const item of value){const selected=conditionalTarget(item);if(selected)return selected;}return null;}
  if(!value||typeof value!=="object")return null;
  for(const condition of ["browser","worker","import","default"]){
    if(Object.prototype.hasOwnProperty.call(value,condition)){
      const selected=conditionalTarget(value[condition]);
      if(selected)return selected;
    }
  }
  return null;
}
function exportTarget(exportsMap:any,subpath:string):string|null{
  if(typeof exportsMap==="string"||Array.isArray(exportsMap))return subpath==="."?conditionalTarget(exportsMap):null;
  if(!exportsMap||typeof exportsMap!=="object")return null;
  const hasSubpaths=Object.keys(exportsMap).some((key)=>key.startsWith("."));
  if(!hasSubpaths)return subpath==="."?conditionalTarget(exportsMap):null;
  if(Object.prototype.hasOwnProperty.call(exportsMap,subpath))return conditionalTarget(exportsMap[subpath]);
  for(const [key,value] of Object.entries(exportsMap)){
    if(!key.includes("*"))continue;
    const [prefix,suffix]=key.split("*");
    if(!subpath.startsWith(prefix!)||!subpath.endsWith(suffix!))continue;
    const capture=subpath.slice(prefix!.length,subpath.length-suffix!.length);
    const target=conditionalTarget(value);
    return target?.replace("*",capture)??null;
  }
  return null;
}
function resolvePackage(from:string,specifier:string):string{
  const parts=specifier.split("/");
  const packageName=specifier.startsWith("@")?parts.slice(0,2).join("/"):parts[0]!;
  const subpath=parts.length>(specifier.startsWith("@")?2:1)?`./${parts.slice(specifier.startsWith("@")?2:1).join("/")}`:" .".trim();
  let current=path.dirname(from);
  let packageDir:string|undefined;
  while(true){
    const candidate=path.join(current,"node_modules",packageName);
    if(fs.existsSync(candidate)){packageDir=fs.realpathSync(candidate);break;}
    const parent=path.dirname(current);
    if(parent===current)break;
    current=parent;
  }
  if(!packageDir)throw new Error(`Cannot resolve package '${packageName}' imported by ${from}`);
  packageRoots.add(packageDir);
  const manifest=JSON.parse(fs.readFileSync(path.join(packageDir,"package.json"),"utf8"));
  let target=exportTarget(manifest.exports,subpath);
  if(!target&&subpath==="."&&typeof manifest.browser==="string")target=manifest.browser;
  if(!target&&subpath==="."&&typeof manifest.module==="string")target=manifest.module;
  if(!target&&subpath==="."&&typeof manifest.main==="string")target=manifest.main;
  if(!target&&subpath!==".")target=subpath.slice(2);
  if(!target)throw new Error(`Package '${packageName}' has no browser/import export for '${subpath}'`);
  if(target.startsWith("./"))target=target.slice(2);
  return resolveFile(path.join(packageDir,target));
}
function imports(source:string):string[]{
  const found=new Set<string>();
  const patterns=[
    /\b(?:import|export)\s+(?:[\s\S]*?\s+from\s*)?["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for(const pattern of patterns)for(const match of source.matchAll(pattern)){if(match[1])found.add(match[1]);}
  return [...found];
}
function resolveImport(from:string,specifier:string):string|null{
  if(specifier.startsWith("node:")||builtinNames.has(specifier)){
    failures.push(`Node builtin reachable from portable export: ${specifier} <- ${from}`);
    return null;
  }
  if(specifier.startsWith("./")||specifier.startsWith("../"))return resolveFile(path.resolve(path.dirname(from),specifier));
  if(specifier.startsWith("/")||specifier.startsWith("data:")||specifier.startsWith("https:")||specifier.startsWith("http:"))return null;
  const packageName=specifier.startsWith("@")?specifier.split("/").slice(0,2).join("/"):specifier.split("/")[0]!;
  if(forbiddenPackages.has(packageName))failures.push(`Node/server-only package reachable from portable export: ${specifier} <- ${from}`);
  return resolvePackage(from,specifier);
}
function collect(entry:string):Set<string>{
  const closure=new Set<string>();
  const queue=[resolveFile(entry)];
  while(queue.length){
    const current=queue.pop()!;
    if(closure.has(current))continue;
    closure.add(current);
    const source=fs.readFileSync(current,"utf8");
    if(current.startsWith(dist+path.sep)&&/\b(?:process\s*\.|Buffer\s*(?:\.|\[)|__dirname\b|__filename\b|require\s*\()/.test(source)){
      failures.push(`Node global reachable from portable GutTS export: ${path.relative(root,current)}`);
    }
    if(current.startsWith(dist+path.sep)&&/\bimport\s*\(\s*(?!["'])/.test(source)){
      failures.push(`Non-literal dynamic import cannot be proven portable: ${path.relative(root,current)}`);
    }
    for(const specifier of imports(source)){
      const target=resolveImport(current,specifier);
      if(target)queue.push(target);
    }
  }
  return closure;
}

describe("GutTS emitted Web-standard dependency closures",()=>{
  it("keeps the default root import closure free of Node-only modules and globals",()=>{
    const closure=collect(path.join(dist,"index.js"));
    expect(closure.size).toBeGreaterThan(1);
    expect(failures).toEqual([]);
  });
  it("keeps the browser entrypoint closure free of Node-only modules and globals",()=>{
    const before=failures.length;
    const closure=collect(path.join(dist,"browser.js"));
    expect(closure.size).toBeGreaterThan(1);
    expect(failures.slice(before)).toEqual([]);
  });
  it("publishes explicit server-only subpaths without folding them into portable roots",()=>{
    const pkg=JSON.parse(fs.readFileSync(path.join(root,"package.json"),"utf8"));
    expect(pkg.exports["./server"]).toBe("./dist/server/index.js");
    expect(pkg.exports["./server/auth"]).toBe("./dist/server/auth.js");
    expect(pkg.exports["./server/models"]).toBe("./dist/server/models.js");
    expect(pkg.exports["./server/storage"]).toBe("./dist/server/storage/index.js");
    expect(pkg.exports["./storage"]).toBe("./dist/storage/index.js");
    const rootClosure=collect(path.join(dist,"index.js"));
    expect([...rootClosure].some((file)=>file.includes(`${path.sep}storage${path.sep}`))).toBe(false);
    expect([...rootClosure].some((file)=>file.includes(`${path.sep}server${path.sep}`))).toBe(false);
  });
});
