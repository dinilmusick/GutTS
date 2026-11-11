import {describe,expect,it} from "vitest";
import fs from "node:fs";
import path from "node:path";
import {builtinModules} from "node:module";
import ts from "typescript";

const root=process.cwd();
const dist=path.join(root,"dist");
const builtinNames=new Set([...builtinModules,...builtinModules.map((name)=>`node:${name}`)]);
const forbiddenPackages=new Set([
  "@aws-sdk/client-s3",
  "@aws-sdk/credential-provider-node",
  "googleapis",
  "onnxruntime-node",
  "sharp",
  "node-gyp-build",
]);

function fileCandidates(target:string):string[]{
  if(path.extname(target))return [target];
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
function mapTarget(map:any,key:string):string|null{
  if(!map||typeof map!=="object")return null;
  if(Object.prototype.hasOwnProperty.call(map,key))return conditionalTarget(map[key]);
  for(const [pattern,value] of Object.entries(map)){
    if(!pattern.includes("*"))continue;
    const [prefix,suffix]=pattern.split("*");
    if(!key.startsWith(prefix!)||!key.endsWith(suffix!))continue;
    const capture=key.slice(prefix!.length,key.length-suffix!.length);
    return conditionalTarget(value)?.replace("*",capture)??null;
  }
  return null;
}
function exportTarget(exportsMap:any,subpath:string):string|null{
  if(typeof exportsMap==="string"||Array.isArray(exportsMap))return subpath==="."?conditionalTarget(exportsMap):null;
  if(!exportsMap||typeof exportsMap!=="object")return null;
  const hasSubpaths=Object.keys(exportsMap).some((key)=>key.startsWith("."));
  return hasSubpaths?mapTarget(exportsMap,subpath):subpath==="."?conditionalTarget(exportsMap):null;
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
function resolvePackageImport(from:string,specifier:string):string{
  const packageDir=nearestPackage(from);
  const manifest=JSON.parse(fs.readFileSync(path.join(packageDir,"package.json"),"utf8"));
  const target=mapTarget(manifest.imports,specifier);
  if(!target)throw new Error(`Package import '${specifier}' has no browser/import target in ${packageDir}`);
  return resolveFile(path.resolve(packageDir,target));
}
function moduleSpecifiers(file:string,source:string):{specifier:string;kind:"static"|"dynamic"|"require"|"unknown-dynamic"}[]{
  const parsed=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
  const found:{specifier:string;kind:"static"|"dynamic"|"require"|"unknown-dynamic"}[]=[];
  const visit=(node:ts.Node):void=>{
    if(ts.isImportDeclaration(node)||ts.isExportDeclaration(node)){
      if(node.moduleSpecifier&&ts.isStringLiteral(node.moduleSpecifier))found.push({specifier:node.moduleSpecifier.text,kind:"static"});
    }else if(ts.isCallExpression(node)&&node.expression.kind===ts.SyntaxKind.ImportKeyword){
      const arg=node.arguments[0];
      if(arg&&ts.isStringLiteral(arg))found.push({specifier:arg.text,kind:"dynamic"});
      else found.push({specifier:"",kind:"unknown-dynamic"});
    }else if(ts.isCallExpression(node)&&ts.isIdentifier(node.expression)&&node.expression.text==="require"){
      const arg=node.arguments[0];
      if(arg&&ts.isStringLiteral(arg))found.push({specifier:arg.text,kind:"require"});
      else found.push({specifier:"",kind:"unknown-dynamic"});
    }
    ts.forEachChild(node,visit);
  };
  visit(parsed);
  return found;
}
function collect(entry:string):{closure:Set<string>;failures:string[]}{
  const closure=new Set<string>();
  const failures:string[]=[];
  const queue=[resolveFile(entry)];
  while(queue.length){
    const current=queue.pop()!;
    if(closure.has(current))continue;
    closure.add(current);
    const source=fs.readFileSync(current,"utf8");
    const isGuttsOutput=current.startsWith(dist+path.sep);
    if(isGuttsOutput&&/\b(?:process\s*\.|Buffer\s*(?:\.|\[)|__dirname\b|__filename\b|require\s*\()/.test(source)){
      failures.push(`Node global reachable from portable GutTS export: ${path.relative(root,current)}`);
    }
    for(const edge of moduleSpecifiers(current,source)){
      if(edge.kind==="unknown-dynamic"){
        if(isGuttsOutput)failures.push(`Non-literal dynamic import cannot be proven portable: ${path.relative(root,current)}`);
        continue;
      }
      const specifier=edge.specifier;
      if(specifier.startsWith("node:")||builtinNames.has(specifier)){
        failures.push(`Node builtin reachable from portable export: ${specifier} <- ${current}`);
        continue;
      }
      if(specifier.startsWith("./")||specifier.startsWith("../")){
        queue.push(resolveFile(path.resolve(path.dirname(current),specifier)));
        continue;
      }
      if(specifier.startsWith("#")){
        queue.push(resolvePackageImport(current,specifier));
        continue;
      }
      if(specifier.startsWith("/")||specifier.startsWith("data:")||specifier.startsWith("https:")||specifier.startsWith("http:"))continue;
      const packageName=specifier.startsWith("@")?specifier.split("/").slice(0,2).join("/"):specifier.split("/")[0]!;
      if(forbiddenPackages.has(packageName)||packageName.startsWith("@aws-sdk/")){
        failures.push(`Node/server-only package reachable from portable export: ${specifier} <- ${current}`);
      }
      queue.push(resolvePackage(current,specifier));
    }
  }
  return {closure,failures};
}

describe("GutTS emitted Web-standard dependency closures",()=>{
  it("keeps the default root import closure free of Node-only modules and globals",()=>{
    const result=collect(path.join(dist,"index.js"));
    expect(result.closure.size).toBeGreaterThan(1);
    expect(result.failures).toEqual([]);
  });
  it("keeps the browser entrypoint closure free of Node-only modules and globals",()=>{
    const result=collect(path.join(dist,"browser.js"));
    expect(result.closure.size).toBeGreaterThan(1);
    expect(result.failures).toEqual([]);
  });
  it("publishes explicit server-only subpaths without folding them into portable roots",()=>{
    const pkg=JSON.parse(fs.readFileSync(path.join(root,"package.json"),"utf8"));
    expect(pkg.exports["./server"]).toBe("./dist/server/index.js");
    expect(pkg.exports["./server/auth"]).toBe("./dist/server/auth.js");
    expect(pkg.exports["./server/models"]).toBe("./dist/server/models.js");
    expect(pkg.exports["./server/storage"]).toBe("./dist/server/storage/index.js");
    expect(pkg.exports["./storage"]).toBe("./dist/storage/index.js");
    const result=collect(path.join(dist,"index.js"));
    expect(result.failures).toEqual([]);
    expect([...result.closure].some((file)=>file.includes(`${path.sep}storage${path.sep}`))).toBe(false);
    expect([...result.closure].some((file)=>file.includes(`${path.sep}server${path.sep}`))).toBe(false);
  });
});
