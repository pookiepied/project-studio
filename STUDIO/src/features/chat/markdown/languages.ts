/**
 * What a fence says, and what it means.
 *
 * Pure: the aliases, the display names and the set of grammars the app
 * highlights, with no grammar loaded. The block's header reads these the
 * moment it renders; the highlighter itself (`highlighter.ts`, the grammars
 * and the renderer) is a chunk that arrives when the first block asks.
 * Anything not in `GRAMMARS` still renders - unhighlighted, which is the
 * correct failure.
 */

/**
 * The bar for entry is demand, not fame: a language the model is actually
 * asked to write. The nine mainstream ones joined when a reader who asked for
 * Java got a block wearing the Java mark and no color - an economy
 * indistinguishable from breakage. Perl, Haskell, Lua, Objective-C, MATLAB
 * and Fortran stay out: rare here, and plain text under the right mark is the
 * honest state for them. Adding one is a name here and an import in
 * `highlighter.ts`.
 */
export const GRAMMARS = [
  'bash',
  'c',
  'cpp',
  'csharp',
  'css',
  'diff',
  'go',
  'java',
  'json',
  'kotlin',
  'markdown',
  'php',
  'python',
  'ruby',
  'rust',
  'scala',
  'sql',
  'swift',
  'typescript',
  'xml',
  'yaml',
] as const

const GRAMMAR_SET: ReadonlySet<string> = new Set(GRAMMARS)

/**
 * What the fence says, mapped to a registered grammar.
 *
 * `svg` and `html` both parse as `xml`, which is why SVG in a fence highlights
 * at all rather than falling through as plain text.
 */
const ALIASES: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  js: 'typescript',
  jsx: 'typescript',
  javascript: 'typescript',
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  py: 'python',
  rs: 'rust',
  html: 'xml',
  svg: 'xml',
  yml: 'yaml',
  md: 'markdown',
  patch: 'diff',
  'c++': 'cpp',
  'c#': 'csharp',
  cs: 'csharp',
  kt: 'kotlin',
  rb: 'ruby',
}

/** The label shown in a block's header. */
const DISPLAY: Record<string, string> = {
  bash: 'Shell',
  c: 'C',
  cpp: 'C++',
  csharp: 'C#',
  css: 'CSS',
  diff: 'Diff',
  go: 'Go',
  java: 'Java',
  json: 'JSON',
  kotlin: 'Kotlin',
  markdown: 'Markdown',
  php: 'PHP',
  python: 'Python',
  ruby: 'Ruby',
  rust: 'Rust',
  scala: 'Scala',
  sql: 'SQL',
  swift: 'Swift',
  typescript: 'TypeScript',
  xml: 'HTML',
  yaml: 'YAML',
}

export function resolveLanguage(fence: string): string {
  const lower = fence.trim().toLowerCase()
  const resolved = ALIASES[lower] ?? lower
  return GRAMMAR_SET.has(resolved) ? resolved : 'text'
}

export function displayName(fence: string): string {
  const lower = fence.trim().toLowerCase()
  // The fence wins for display even when it aliases: someone who wrote ```svg
  // is told SVG, not HTML, because that is what they meant.
  if (lower === 'svg') return 'SVG'
  if (lower === 'html') return 'HTML'
  const resolved = resolveLanguage(fence)
  return DISPLAY[resolved] ?? (lower ? lower.toUpperCase() : 'Text')
}

