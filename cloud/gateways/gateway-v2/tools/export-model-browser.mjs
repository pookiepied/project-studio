import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const srcRoot = join(root, "src");
const outDir = join(root, ".tmp", "model-browser-export");
const dataFile = join(root, "tools", "model-browser-data.js");

const entry = join(srcRoot, "registry", "index.ts");
const seen = new Set();

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });
await compileTree(entry);

const compiledEntry = compiledPath(entry);
const { getModelRegistry } = await import(pathToFileURL(compiledEntry).href);
const registry = getModelRegistry();

await writeFile(
  dataFile,
  `window.__MODEL_REGISTRY__ = ${JSON.stringify(registry, null, 2)};\n`,
  "utf8"
);

console.log(`Exported ${registry.models.length} models to ${relative(root, dataFile)}`);

async function compileTree(filePath) {
  const resolved = resolve(filePath);
  if (seen.has(resolved)) return;
  seen.add(resolved);

  const source = await readFile(resolved, "utf8");
  const dependencies = relativeImports(source)
    .map((specifier) => resolveImport(dirname(resolved), specifier))
    .filter(Boolean);

  for (const dependency of dependencies) {
    await compileTree(dependency);
  }

  const output = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ES2022,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      importsNotUsedAsValues: ts.ImportsNotUsedAsValues.Remove
    }
  }).outputText;

  const rewritten = output.replace(
    /(from\s+["'])(\.[^"']+)(["'])/g,
    (_match, prefix, specifier, suffix) => `${prefix}${rewriteSpecifier(resolved, specifier)}${suffix}`
  );

  const target = compiledPath(resolved);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, rewritten, "utf8");
}

function relativeImports(source) {
  const imports = [];
  const importPattern = /(?:import|export)\s+(?:[^"']+\s+from\s+)?["'](\.[^"']+)["']/g;
  let match;
  while ((match = importPattern.exec(source))) {
    imports.push(match[1]);
  }
  return imports;
}

function resolveImport(baseDir, specifier) {
  const direct = resolve(baseDir, specifier);
  for (const candidate of [direct, `${direct}.ts`, join(direct, "index.ts")]) {
    if (candidate.startsWith(srcRoot) && existsSync(candidate)) return candidate;
  }
  return undefined;
}

function rewriteSpecifier(importer, specifier) {
  const dependency = resolveImport(dirname(importer), specifier);
  if (!dependency) return specifier;
  let rewritten = relative(dirname(compiledPath(importer)), compiledPath(dependency)).replace(/\\/g, "/");
  if (!rewritten.startsWith(".")) rewritten = `./${rewritten}`;
  return rewritten;
}

function compiledPath(sourcePath) {
  const relativePath = relative(srcRoot, sourcePath).replace(/\.ts$/, ".mjs");
  return join(outDir, relativePath);
}
