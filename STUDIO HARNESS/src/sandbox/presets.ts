import { existsSync } from "node:fs";
import { delimiter, join, resolve } from "node:path";

import type { SandboxScopeMode } from "./scope.js";

/**
 * A named bundle of paths with a detector.
 *
 * A preset grants nothing. It exists so that a person who has Rust installed
 * does not have to know that Rust keeps a toolchain in `.rustup`. Two rules
 * decide the whole design:
 *
 * A preset that cannot be detected is not shipped. Paths vary by OS, by
 * version, and by install method, and a preset with a wrong path either grants
 * something nobody intended or silently grants nothing while looking correct.
 * So each preset carries a detector, the pane shows only what is actually on
 * the machine, and it shows the path it found.
 *
 * Ship the ones a working developer actually hits. Not thirty. Eight, chosen
 * from what the measurements show breaks or is likely to.
 */

interface PresetPath {
  readonly path: string;
  readonly mode: SandboxScopeMode;
}

export interface SandboxPreset {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  /** The candidate directories, in preference order. Only the ones present are shown. */
  readonly candidates: (env: NodeJS.ProcessEnv) => readonly PresetPathCandidate[];
  readonly paths: readonly PresetPath[];
}

export interface PresetPathCandidate {
  readonly path: string;
  readonly mode: SandboxScopeMode;
}

export interface DetectedPreset {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly paths: readonly PresetPath[];
}

function home(env: NodeJS.ProcessEnv): string {
  return env.HOME ?? env.USERPROFILE ?? "";
}

function exists(path: string): boolean {
  try {
    return existsSync(path);
  } catch {
    return false;
  }
}

function present(candidates: readonly PresetPathCandidate[]): readonly PresetPath[] {
  const found: PresetPath[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const absolute = resolve(candidate.path);
    if (seen.has(absolute.toLowerCase())) continue;
    seen.add(absolute.toLowerCase());
    if (!exists(absolute)) continue;
    found.push({ path: absolute, mode: candidate.mode });
  }
  return found;
}

function npmCache(env: NodeJS.ProcessEnv): string | undefined {
  if (env.npm_config_cache !== undefined && env.npm_config_cache !== "") {
    return env.npm_config_cache;
  }
  const base = home(env);
  if (base === "") return undefined;
  return process.platform === "win32"
    ? join(base, "AppData", "Roaming", "npm-cache")
    : join(base, ".npm");
}

function pnpmStoreCandidates(env: NodeJS.ProcessEnv): readonly string[] {
  const base = home(env);
  if (base === "") return [];
  if (process.platform === "win32") {
    const localApp = env.LOCALAPPDATA ?? join(base, "AppData", "Local");
    return [join(localApp, "pnpm", "store")];
  }
  const xdg = env.XDG_DATA_HOME ?? join(base, ".local", "share");
  return [join(xdg, "pnpm", "store"), join(base, ".pnpm-store"), join(base, ".local", "share", "pnpm", "store")];
}

function yarnCache(env: NodeJS.ProcessEnv): string | undefined {
  if (env.YARN_CACHE_FOLDER !== undefined && env.YARN_CACHE_FOLDER !== "") {
    return env.YARN_CACHE_FOLDER;
  }
  const base = home(env);
  if (base === "") return undefined;
  return process.platform === "win32"
    ? join(base, "AppData", "Local", "Yarn", "Cache")
    : join(base, ".cache", "yarn");
}

function pipCache(env: NodeJS.ProcessEnv): string | undefined {
  const base = home(env);
  if (base === "") return undefined;
  if (process.platform === "win32") return join(base, "AppData", "Local", "pip", "Cache");
  const xdg = env.XDG_CACHE_HOME ?? join(base, ".cache");
  return join(xdg, "pip");
}

function nugetPackages(env: NodeJS.ProcessEnv): string | undefined {
  if (env.NUGET_PACKAGES !== undefined && env.NUGET_PACKAGES !== "") return env.NUGET_PACKAGES;
  const base = home(env);
  if (base === "") return undefined;
  return process.platform === "win32"
    ? join(base, ".nuget", "packages")
    : join(base, ".nuget", "packages");
}

function goCaches(env: NodeJS.ProcessEnv): readonly PresetPathCandidate[] {
  const out: PresetPathCandidate[] = [];
  const gopath = env.GOPATH ?? "";
  const base = home(env);
  const roots: string[] = [];
  if (gopath !== "") {
    for (const entry of gopath.split(delimiter)) {
      const trimmed = entry.trim();
      if (trimmed !== "") roots.push(trimmed);
    }
  } else if (base !== "") {
    roots.push(join(base, "go"));
  }
  for (const root of roots) {
    out.push({ path: join(root, "pkg", "mod"), mode: "write" });
  }
  if (env.GOMODCACHE !== undefined && env.GOMODCACHE !== "") {
    out.push({ path: env.GOMODCACHE, mode: "write" });
  }
  const cacheBase =
    process.platform === "win32"
      ? (env.LOCALAPPDATA ?? (base === "" ? undefined : join(base, "AppData", "Local")))
      : (env.XDG_CACHE_HOME ?? (base === "" ? undefined : join(base, ".cache")));
  if (cacheBase !== undefined) out.push({ path: join(cacheBase, "go-build"), mode: "write" });
  return out;
}

function gitCandidates(): readonly PresetPathCandidate[] {
  if (process.platform === "win32") {
    const out: PresetPathCandidate[] = [];
    const programFiles = process.env.ProgramFiles ?? "C:\\Program Files";
    const programFilesX86 = process.env["ProgramFiles(x86)"];
    out.push({ path: join(programFiles, "Git"), mode: "read" });
    if (programFilesX86 !== undefined) out.push({ path: join(programFilesX86, "Git"), mode: "read" });
    const localApp = process.env.LOCALAPPDATA;
    if (localApp !== undefined) out.push({ path: join(localApp, "Programs", "Git"), mode: "read" });
    return out;
  }
  // Nothing off Windows. The preset exists for one measured reason: under
  // AppContainer the shell's interpreter is `bash.exe` from the Git install,
  // and it cannot start unless that directory is readable. Elsewhere git lives
  // in `/usr/bin`, and the only candidate wide enough to cover it is `/usr` -
  // which `systemScopeRefusal` calls the end of containment, correctly. A
  // preset that offers a path the store then refuses is worse than no preset.
  return [];
}

function pythonSiteCandidates(env: NodeJS.ProcessEnv): readonly PresetPathCandidate[] {
  const out: PresetPathCandidate[] = [];
  const cache = pipCache(env);
  if (cache !== undefined) out.push({ path: cache, mode: "write" });
  const base = home(env);
  if (base !== "") {
    if (process.platform === "win32") {
      out.push({ path: join(base, "AppData", "Roaming", "Python"), mode: "write" });
    } else {
      out.push({ path: join(base, ".local", "lib"), mode: "write" });
    }
  }
  return out;
}

function androidCandidates(env: NodeJS.ProcessEnv): readonly PresetPathCandidate[] {
  const out: PresetPathCandidate[] = [];
  const sdk = env.ANDROID_HOME ?? env.ANDROID_SDK_ROOT;
  if (sdk !== undefined && sdk !== "") out.push({ path: sdk, mode: "write" });
  const base = home(env);
  if (base !== "") {
    const localApp =
      process.platform === "win32"
        ? (env.LOCALAPPDATA ?? join(base, "AppData", "Local"))
        : base;
    out.push({
      path: process.platform === "win32" ? join(localApp, "Android", "Sdk") : join(base, "Android", "Sdk"),
      mode: "write",
    });
  }
  const flutter = env.FLUTTER_ROOT;
  if (flutter !== undefined && flutter !== "") out.push({ path: flutter, mode: "read" });
  if (base !== "") {
    out.push({ path: join(base, ".gradle"), mode: "write" });
    if (process.platform === "win32") {
      out.push({ path: join(base, "flutter"), mode: "read" });
    } else {
      out.push({ path: join(base, "flutter"), mode: "read" });
      out.push({ path: join(base, "Android", "flutter"), mode: "read" });
    }
  }
  return out;
}

export const SANDBOX_PRESETS: readonly (Omit<SandboxPreset, "paths"> & {
  readonly candidates: (env: NodeJS.ProcessEnv) => readonly PresetPathCandidate[];
})[] = [
  {
    id: "git",
    title: "Git",
    description: "The Git installation, so the shell's interpreter can start.",
    candidates: () => gitCandidates(),
  },
  {
    id: "rust",
    title: "Rust",
    description: "The Rust toolchain and cargo registries.",
    candidates: (env) => {
      const base = home(env);
      if (base === "") return [];
      const cargoHome = env.CARGO_HOME ?? join(base, ".cargo");
      const rustupHome = env.RUSTUP_HOME ?? join(base, ".rustup");
      return [
        { path: rustupHome, mode: "write" },
        { path: cargoHome, mode: "write" },
      ];
    },
  },
  {
    id: "node-caches",
    title: "Node caches",
    description: "The npm, pnpm, and yarn caches.",
    candidates: (env) => {
      const out: PresetPathCandidate[] = [];
      const npm = npmCache(env);
      if (npm !== undefined) out.push({ path: npm, mode: "write" });
      for (const store of pnpmStoreCandidates(env)) out.push({ path: store, mode: "write" });
      const yarn = yarnCache(env);
      if (yarn !== undefined) out.push({ path: yarn, mode: "write" });
      return out;
    },
  },
  {
    id: "python",
    title: "Python",
    description: "The user packages and the pip cache.",
    candidates: (env) => pythonSiteCandidates(env),
  },
  {
    id: "java",
    title: "Java",
    description: "The Maven and Gradle caches.",
    candidates: (env) => {
      const base = home(env);
      if (base === "") return [];
      return [
        { path: join(base, ".m2"), mode: "write" },
        { path: join(base, ".gradle"), mode: "write" },
      ];
    },
  },
  {
    id: "android-flutter",
    title: "Android and Flutter",
    description: "The Android SDK, the Flutter SDK, and the Gradle cache.",
    candidates: (env) => androidCandidates(env),
  },
  {
    id: "go",
    title: "Go",
    description: "The module cache and build cache.",
    candidates: (env) => goCaches(env),
  },
  {
    id: "dotnet",
    title: ".NET",
    description: "The NuGet package folder.",
    candidates: (env) => {
      const folder = nugetPackages(env);
      if (folder === undefined) return [];
      return [{ path: folder, mode: "write" }];
    },
  },
];

/**
 * The presets the machine actually has, with the paths found.
 *
 * A preset that is not detected is not shown; a line saying what is looked
 * for is better than a checkbox that does nothing.
 */
export function detectPresets(env: NodeJS.ProcessEnv = process.env): readonly DetectedPreset[] {
  const detected: DetectedPreset[] = [];
  for (const preset of SANDBOX_PRESETS) {
    const paths = present(preset.candidates(env));
    if (paths.length === 0) continue;
    detected.push({
      id: preset.id,
      title: preset.title,
      description: preset.description,
      paths,
    });
  }
  // Git first, because it is the one that unblocks the interpreter.
  detected.sort((left, right) => {
    if (left.id === "git") return -1;
    if (right.id === "git") return 1;
    return left.title.localeCompare(right.title);
  });
  return detected;
}

