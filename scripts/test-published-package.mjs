import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = process.cwd();
const sourceManifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const packageName = sourceManifest.name;
const version = sourceManifest.version;
assert.ok(packageName && version, 'package name and version are required');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'gutts-packed-consumer-'));
const packDir = path.join(temp, 'pack'), consumerDir = path.join(temp, 'consumer'), unpackedDir = path.join(temp, 'unpacked');
fs.mkdirSync(packDir); fs.mkdirSync(consumerDir); fs.mkdirSync(unpackedDir);
try {
  const packedJson = execFileSync('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', packDir], { cwd: root, encoding: 'utf8' });
  const packed = JSON.parse(packedJson);
  assert.ok(packed[0]?.filename, 'npm pack must produce a local tarball');
  const tarball = path.join(packDir, packed[0].filename);
  execFileSync('tar', ['-xzf', tarball, '-C', unpackedDir, '--strip-components=1']);
  const manifest = JSON.parse(fs.readFileSync(path.join(unpackedDir, 'package.json'), 'utf8'));
  assert.equal(manifest.name, packageName); assert.equal(manifest.version, version);
  assert.equal(manifest.main, manifest.module, 'main and module must agree');
  for (const [key, value] of Object.entries(manifest.exports)) {
    const targets = [];
    const walk = item => { if (typeof item === 'string') targets.push(item); else if (item && typeof item === 'object') Object.values(item).forEach(walk); };
    walk(value);
    for (const target of targets) assert.ok(fs.existsSync(path.join(unpackedDir, target)), `Packed export target missing: ${key} -> ${target}`);
  }
  execFileSync('npm', ['install', '--prefix', consumerDir, '--ignore-scripts', '--no-audit', '--no-fund', tarball], { stdio: 'inherit' });
  // Optional peers are installed only in this adapter-specific consumer fixture.
  execFileSync('npm', ['install', '--prefix', consumerDir, '--ignore-scripts', '--no-audit', '--no-fund', '@aws-sdk/client-s3@^3.1164.0', 'googleapis@^189.0.0'], { stdio: 'inherit' });
  const specs = ['@dinilmusick/gutts','@dinilmusick/gutts/browser','@dinilmusick/gutts/worker','@dinilmusick/gutts/server','@dinilmusick/gutts/server/auth','@dinilmusick/gutts/server/models','@dinilmusick/gutts/server/storage','@dinilmusick/gutts/storage','@dinilmusick/gutts/storage/s3','@dinilmusick/gutts/storage/google-drive'];
  const typeFixture = `import {chunk} from "@dinilmusick/gutts/worker";\nimport {LuthAuthClient} from "@dinilmusick/gutts/browser";\nimport {resolveServerRuntimeAppUrl} from "@dinilmusick/gutts/server/auth";\nimport {S3Client} from "@dinilmusick/gutts/storage/s3";\nimport type {GoogleApisModule} from "@dinilmusick/gutts/storage/google-drive";\nconst groups = chunk([1,2,3,4],2); void LuthAuthClient; void resolveServerRuntimeAppUrl; void S3Client; void groups;\ntype GoogleModule = GoogleApisModule;\n`;
  fs.writeFileSync(path.join(consumerDir, 'consumer.ts'), typeFixture);
  execFileSync(path.join(root, 'node_modules/.bin/tsc'), ['--noEmit','--strict','--target','ES2022','--module','NodeNext','--moduleResolution','NodeNext','consumer.ts'], {cwd:consumerDir,stdio:'inherit'});
  for (const specifier of specs) {
    const code = `await import(${JSON.stringify(specifier)}); console.log("imported ${specifier}")`;
    execFileSync(process.execPath, ['--input-type=module','-e',code], {cwd:consumerDir,stdio:'inherit'});
  }
  console.log(JSON.stringify({package:packageName,version,tarball:packed[0].filename,packedConsumerImports:specs},null,2));
} finally { fs.rmSync(temp,{recursive:true,force:true}); }
