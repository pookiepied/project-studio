import { existsSync, readdirSync, realpathSync } from "node:fs";
import { delimiter, isAbsolute, join, resolve } from "node:path";

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

/**
 * Where corepack keeps the package-manager payloads it manages.
 *
 * Found as a cache beside the others, and for the same reason: on Windows a
 * contained process is handed a `LOCALAPPDATA` under its own profile, so
 * corepack starts with an empty cupboard and downloads pnpm again for every
 * profile — while the payload it wants is already on the disk. The preset
 * grants the folder and `toolchainEnvironment` points `COREPACK_HOME` at it.
 */
function corepackCache(env: NodeJS.ProcessEnv): string | undefined {
  const base = home(env);
  if (base === "") return undefined;
  if (process.platform === "win32") {
    return join(env.LOCALAPPDATA ?? join(base, "AppData", "Local"), "node", "corepack");
  }
  return join(env.XDG_CACHE_HOME ?? join(base, ".cache"), "node", "corepack");
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
  // The interpreter's own installation first, and read rather than write, for
  // a gap that measured as "I can't find any Python" from a model that had
  // just been told Python was granted. The preset used to name only the pip
  // cache and the user site-packages — the places Python *stores* things — and
  // never the place Python *is*. Under a container that distinction is fatal:
  // the launcher opens an executable's image with its own rights, so python.exe
  // starts, and the interpreter's first act is to read its own standard library
  // from its installation directory, where the container holds no entry at all.
  // The shell could not even list the directory to resolve `python` on the
  // PATH, and answered with the `not recognized` that reads as a typo. The
  // git preset carries the same idea for the same reason: a program that
  // reads its own files at runtime needs its directory readable.
  for (const installation of pythonInstallations(env)) {
    out.push({ path: installation, mode: "read" });
  }
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

/**
 * The Python installations the machine actually has, most recent first.
 *
 * Found the way the python.org installer lays them down — one directory per
 * minor version under `%LOCALAPPDATA%\Programs\Python` — rather than by
 * resolving `python` against the PATH, because the process that builds this
 * list has already missed that resolution once: the harness is launched from
 * whatever environment started the application, and a PATH captured before
 * Python was installed, or from a shell that never had it, resolves nothing
 * while the installation sits right there. The glob is the ground truth the
 * installer wrote to disk.
 */
function pythonInstallations(env: NodeJS.ProcessEnv): readonly string[] {
  if (process.platform !== "win32") return [];
  const base = env.LOCALAPPDATA ?? (home(env) === "" ? undefined : join(home(env), "AppData", "Local"));
  if (base === undefined) return [];
  const root = join(base, "Programs", "Python");
  let found: string[];
  try {
    found = readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /^Python\d+[.\d]*$/.test(entry.name))
      .map((entry) => join(root, entry.name));
  } catch {
    // No Python directory is the ordinary answer for most machines, and an
    // unreadable one is the same answer for our purposes: nothing to grant.
    return [];
  }
  // A version-sort would be nicer than a reverse name-sort, but the names are
  // zero-padded enough (`Python311`, `Python312`) that reverse lexical is the
  // newest-first order in practice, and the pane shows every one it finds.
  found.sort((left, right) => right.localeCompare(left));
  return found.filter((installation) => existsSync(installation));
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
      // The SDK stays read-only and its cache becomes writable, because the
      // Flutter tool mutates `bin/cache` as part of *running*: version stamps
      // on first launch, the startup lock, and the Dart SDK it downloads
      // there on first use. A read-only tree turned every `flutter` invocation
      // into a hang that produced no output at all — measured at ten minutes
      // of nothing across three attempts, each larger than the last — because
      // the tool was waiting on a write it could never make and never said so.
      // Write access is owed to the one directory Flutter owns and rewrites,
      // not to the whole installation.
      out.push({ path: join(base, "flutter", "bin", "cache"), mode: "write" });
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
      const corepack = corepackCache(env);
      if (corepack !== undefined) out.push({ path: corepack, mode: "write" });
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

/**
 * The directories where a user-profile toolchain keeps the programs its
 * command lines name.
 *
 * These join the sandbox PATH deliberately, and the reason is a measurement
 * that cost a whole debugging session to read: a contained shell resolves
 * `python` by walking the PATH it was given, and it may only find a program
 * in a directory it can read — so `python` resolved for the person's own
 * terminal and never for a contained one, even though the PATH text was
 * *identical*. The text is not the problem; the snapshot is. The harness
 * inherits the PATH of whatever terminal started it, and an environment
 * captured before Python was installed, or by a launcher that trims it,
 * hands a contained shell a PATH that resolves nothing while every
 * installation sits exactly where the preset candidates say it does.
 *
 * So the toolchain directories are added to the policy PATH from the same
 * disk-level detection the presets use, not from the inherited environment,
 * and the ACE the preset places makes the directory listable — the two
 * halves of "the shell can run `python`" decided in one place. Only the
 * user-profile toolchains are here: anything under Program Files is already
 * on every PATH and already readable to every container.
 */
export function interpreterPathEntries(env: NodeJS.ProcessEnv = process.env): readonly string[] {
  const entries: string[] = [];
  for (const installation of pythonInstallations(env)) {
    entries.push(installation);
  }
  const base = home(env);
  if (base !== "") {
    entries.push(join(base, "flutter", "bin"));
    entries.push(join(env.CARGO_HOME ?? join(base, ".cargo"), "bin"));
    entries.push(join(base, "go", "bin"));
  }
  return entries.filter((entry) => existsSync(entry));
}

/** Subdirectory names of one directory; a missing root is simply no names. */
function subdirectories(root: string): readonly string[] {
  try {
    return readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    // A directory that is absent or unreadable has the same answer for our
    // purposes: nothing found. Detection guesses at nothing.
    return [];
  }
}

/** Numeric version order, so `14.9` sorts below `14.38`, unlike text. */
function byVersionDescending(left: string, right: string): number {
  const a = left.split(".").map((part) => Number.parseInt(part, 10));
  const b = right.split(".").map((part) => Number.parseInt(part, 10));
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const l = a[index] ?? -1;
    const r = b[index] ?? -1;
    if (l !== r) return r - l;
  }
  return right.localeCompare(left);
}

/**
 * The Java installations the machine actually has, as their `bin` directories.
 *
 * Found by walking the installers' own directories rather than by resolving
 * `java` against the PATH, for a measured reason the PATH cannot state: on a
 * machine with Oracle's JDK, the PATH entry named `javapath` is a directory
 * of symlinks, and the directory its `java.exe` resolves to carries no
 * ALL APPLICATION PACKAGES entry — so a container can list the shim and
 * cannot follow it, and answers `java` with the `not recognized` that reads
 * as a typo. The installation's own `bin` directory is readable, so the
 * policy PATH is given the installation and the shim becomes irrelevant.
 * Only directories holding `bin\java.exe` count, newest first.
 */
function javaInstallations(env: NodeJS.ProcessEnv): readonly string[] {
  if (process.platform !== "win32") return [];
  const programFiles = env.ProgramFiles ?? "C:\\Program Files";
  const roots = [
    join(programFiles, "Java"),
    join(programFiles, "Eclipse Adoptium"),
    join(programFiles, "Microsoft"),
    join(programFiles, "Zulu"),
    join(programFiles, "Amazon Corretto"),
    join(programFiles, "BellSoft"),
  ];
  const found: string[] = [];
  for (const root of roots) {
    for (const name of subdirectories(root)) {
      const bin = join(root, name, "bin");
      if (existsSync(join(bin, "java.exe"))) found.push(bin);
    }
  }
  found.sort((left, right) => right.localeCompare(left));
  return found;
}

/** Whether a directory is a link to another place rather than a normal one. */
function isReparsePoint(path: string): boolean {
  try {
    return realpathSync.native(path).toLowerCase() !== resolve(path).toLowerCase();
  } catch {
    return false;
  }
}

/**
 * The real JDK `bin` directories, but only when the PATH reaches `java`
 * through a shim the container cannot follow.
 *
 * Prepending is a deliberate exception to "the person's PATH leads": a shim
 * directory that the container cannot resolve is not a PATH entry doing its
 * job, and the installation behind it is what the shim was for. When no
 * shim is in the way, nothing is prepended and the person's order is kept
 * exactly.
 */
function javaPathEntries(searchPath: string, env: NodeJS.ProcessEnv): readonly string[] {
  if (process.platform !== "win32") return [];
  const entries = searchPath
    .split(delimiter)
    .map((entry) => entry.trim().replace(/^"|"$/g, ""))
    .filter((entry) => entry !== "" && isAbsolute(entry));
  const shimmed = entries.some(
    (entry) => existsSync(join(entry, "java.exe")) && isReparsePoint(entry),
  );
  if (!shimmed) return [];
  return javaInstallations(env);
}

interface MsvcToolchain {
  readonly vsRoot: string;
  readonly vcRoot: string;
  readonly toolsRoot: string;
  readonly toolsVersion: string;
  readonly kitsRoot: string;
  readonly sdkVersion: string;
  readonly hostBin: string;
  readonly libEntries: readonly string[];
  readonly includeEntries: readonly string[];
}

/**
 * The Visual Studio and Windows SDK installation this machine has, if any.
 *
 * The registry is the ordinary way a compiler finds these, and inside an
 * AppContainer the registry is not there: `rustc` cannot run its own MSVC
 * discovery, falls back to whichever bare `link.exe` the PATH happens to
 * hold, and every link fails — measured as `LNK1181` for the missing
 * `kernel32.lib` and, with the library paths supplied, `LNK1101` from a
 * mismatched `mspdb140.dll`. Both are the same absence: the toolchain
 * environment a developer command prompt would have set. So it is rebuilt
 * from the disk — the highest toolset and the newest SDK actually installed
 * — and handed to the policy, the same way the interpreter directories are.
 */
function msvcToolchain(env: NodeJS.ProcessEnv): MsvcToolchain | undefined {
  if (process.platform !== "win32") return undefined;
  const programFiles = env.ProgramFiles ?? "C:\\Program Files";
  const programFilesX86 = env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)";

  let tools:
    | { vsRoot: string; vcRoot: string; toolsRoot: string; toolsVersion: string }
    | undefined;
  for (const year of ["2022", "2019"]) {
    for (const sku of ["Enterprise", "Professional", "Community", "BuildTools"]) {
      const vsRoot = join(programFiles, "Microsoft Visual Studio", year, sku);
      const vcRoot = join(vsRoot, "VC");
      for (const version of subdirectories(join(vcRoot, "Tools", "MSVC"))) {
        const hostBin = join(vcRoot, "Tools", "MSVC", version, "bin", "Hostx64", "x64");
        if (!existsSync(join(hostBin, "link.exe"))) continue;
        if (
          tools === undefined ||
          byVersionDescending(version, tools.toolsVersion) < 0
        ) {
          tools = {
            vsRoot,
            vcRoot,
            toolsRoot: join(vcRoot, "Tools", "MSVC", version),
            toolsVersion: version,
          };
        }
      }
    }
  }
  if (tools === undefined) return undefined;

  let sdk: { kitsRoot: string; sdkVersion: string } | undefined;
  for (const kitsRoot of [
    join(programFilesX86, "Windows Kits", "10"),
    join(programFiles, "Windows Kits", "10"),
  ]) {
    for (const sdkVersion of subdirectories(join(kitsRoot, "Lib"))) {
      const um = join(kitsRoot, "Lib", sdkVersion, "um", "x64", "kernel32.lib");
      const ucrt = join(kitsRoot, "Lib", sdkVersion, "ucrt", "x64", "libucrt.lib");
      const ucrtInclude = join(kitsRoot, "Include", sdkVersion, "ucrt");
      const umInclude = join(kitsRoot, "Include", sdkVersion, "um");
      const sharedInclude = join(kitsRoot, "Include", sdkVersion, "shared");
      if (
        !existsSync(um) ||
        !existsSync(ucrt) ||
        !existsSync(ucrtInclude) ||
        !existsSync(umInclude) ||
        !existsSync(sharedInclude)
      ) {
        continue;
      }
      if (sdk === undefined || byVersionDescending(sdkVersion, sdk.sdkVersion) < 0) {
        sdk = { kitsRoot, sdkVersion };
      }
    }
  }
  if (sdk === undefined) return undefined;

  return {
    vsRoot: tools.vsRoot,
    vcRoot: tools.vcRoot,
    toolsRoot: tools.toolsRoot,
    toolsVersion: tools.toolsVersion,
    kitsRoot: sdk.kitsRoot,
    sdkVersion: sdk.sdkVersion,
    hostBin: join(tools.toolsRoot, "bin", "Hostx64", "x64"),
    libEntries: [
      join(tools.toolsRoot, "lib", "x64"),
      join(sdk.kitsRoot, "Lib", sdk.sdkVersion, "ucrt", "x64"),
      join(sdk.kitsRoot, "Lib", sdk.sdkVersion, "um", "x64"),
    ],
    includeEntries: [
      join(tools.toolsRoot, "include"),
      join(sdk.kitsRoot, "Include", sdk.sdkVersion, "ucrt"),
      join(sdk.kitsRoot, "Include", sdk.sdkVersion, "shared"),
      join(sdk.kitsRoot, "Include", sdk.sdkVersion, "um"),
    ],
  };
}

/**
 * The environment a machine's toolchains need and a contained process cannot
 * work out for itself.
 *
 * Two sources, and the shape is the same for both: a fact the OS normally
 * answers through the registry or through `LOCALAPPDATA`, rebuilt from the
 * disk - because a container has no registry, and its `LOCALAPPDATA` is its
 * own profile rather than the person's.
 *
 * - **Visual Studio**, when it is installed: the variables a `vcvars64.bat`
 *   sets, so `rustc` and `cl` can find the linker's libraries. Measured as
 *   `LNK1181` for the missing `kernel32.lib` and, with the library paths
 *   supplied, `LNK1101` from a mismatched `mspdb140.dll`.
 * - **Node package managers**, when their caches exist: `COREPACK_HOME` and
 *   pnpm's store, pointed at the real directories the node-caches preset
 *   grants. Without this, a contained `pnpm` starts with an empty cupboard —
 *   corepack downloads its own payload again for every profile, and pnpm
 *   downloads every package again — while the shared store sits on the disk.
 *
 * Every path is verified to exist before it is named, so a machine without
 * either contributes only what it has.
 */
export function toolchainEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): Readonly<Record<string, string>> {
  const environment: Record<string, string> = {};
  const msvc = msvcToolchain(env);
  if (msvc !== undefined) {
    const trailing = (path: string): string => (path.endsWith("\\") ? path : `${path}\\`);
    Object.assign(environment, {
      VSINSTALLDIR: trailing(msvc.vsRoot),
      VCINSTALLDIR: trailing(msvc.vcRoot),
      VCToolsInstallDir: trailing(msvc.toolsRoot),
      VCToolsVersion: msvc.toolsVersion,
      WindowsSdkDir: trailing(msvc.kitsRoot),
      WindowsSDKVersion: trailing(msvc.sdkVersion),
      UCRTVersion: msvc.sdkVersion,
      LIB: msvc.libEntries.join(";"),
      INCLUDE: msvc.includeEntries.join(";"),
    });
  }
  if (process.platform === "win32") {
    const corepack = corepackCache(env);
    if (corepack !== undefined && existsSync(corepack)) {
      environment.COREPACK_HOME = corepack;
    }
    const base = home(env);
    const localApp =
      env.LOCALAPPDATA ?? (base === "" ? undefined : join(base, "AppData", "Local"));
    if (localApp !== undefined) {
      const store = join(localApp, "pnpm", "store");
      // `pnpm_config_*`, not `npm_config_*`: measured against pnpm 11, which
      // reads its own prefix. The npm prefix reaches the child and is ignored
      // — `pnpm config get store-dir` answers `undefined` with it set, and the
      // store silently lands under the container's own profile. Under the
      // pnpm prefix the same oracle answers the store that was pointed at.
      if (existsSync(store)) environment.pnpm_config_store_dir = store;
    }
  }
  return environment;
}

/**
 * The sandbox PATH, with the detected toolchains placed where they must be.
 *
 * Most detected directories are appended behind the person's own PATH — it
 * is the environment they curated, and its order decides which toolchain a
 * bare name finds. Two kinds lead instead, each for a measured reason:
 *
 * - A JDK behind a shim directory the container cannot follow (`javapath`),
 *   because the PATH entry that would otherwise win resolves to nothing.
 * - The Visual Studio host tools, because `rustc` cannot find them through
 *   the registry and a bare `link.exe` from the general PATH is the wrong
 *   half of a matched pair.
 *
 * Everything is added once, and a directory already on the PATH keeps its
 * own place in it.
 */
export function withToolchainDirectories(
  searchPath: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const leading: string[] = [];
  if (process.platform === "win32") {
    leading.push(...javaPathEntries(searchPath, env));
    const msvc = msvcToolchain(env);
    if (msvc !== undefined) leading.push(msvc.hostBin);
  }
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const entry of [leading.join(delimiter), searchPath, ...interpreterPathEntries(env)]
    .join(delimiter)
    .split(delimiter)) {
    const trimmed = entry.trim().replace(/^"|"$/g, "");
    const key = trimmed.toLowerCase();
    if (trimmed === "" || seen.has(key)) continue;
    seen.add(key);
    parts.push(trimmed);
  }
  return parts.join(delimiter);
}

