/**
 * Fence-language handling for code blocks.
 *
 * Two separate jobs, deliberately kept apart:
 *   - `LANGUAGE_ALIASES` normalises what models actually write (`py`, `ts`,
 *     `sh`) into the names the highlighter knows;
 *   - `DISPLAY_NAMES` is what the reader sees in the block header, so it says
 *     "TypeScript" rather than "typescript".
 *
 * `RICH_LANGUAGES` are the fences that do not go to the highlighter at all —
 * they have dedicated renderers. Their entries are listed here so the set stays
 * in one place, but the renderers land with their own slice.
 */

export const LANGUAGE_ALIASES: Readonly<Record<string, string>> = {
  js: 'javascript',
  jsx: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  py: 'python',
  rb: 'ruby',
  rs: 'rust',
  sh: 'bash',
  zsh: 'bash',
  shell: 'bash',
  yml: 'yaml',
  md: 'markdown',
  tf: 'hcl',
  tex: 'latex',
  math: 'latex',
}

export const DISPLAY_NAMES: Readonly<Record<string, string>> = {
  javascript: 'JavaScript',
  typescript: 'TypeScript',
  python: 'Python',
  ruby: 'Ruby',
  rust: 'Rust',
  go: 'Go',
  java: 'Java',
  kotlin: 'Kotlin',
  swift: 'Swift',
  php: 'PHP',
  perl: 'Perl',
  scala: 'Scala',
  r: 'R',
  html: 'HTML',
  css: 'CSS',
  scss: 'SCSS',
  sass: 'SCSS',
  json: 'JSON',
  yaml: 'YAML',
  xml: 'XML',
  sql: 'SQL',
  csv: 'CSV',
  bash: 'Bash',
  powershell: 'PowerShell',
  shell: 'Shell',
  markdown: 'Markdown',
  hcl: 'HCL',
  dockerfile: 'Dockerfile',
  latex: 'LaTeX',
  c: 'C',
  cpp: 'C++',
  cs: 'C#',
  diff: 'Diff',
  mermaid: 'Diagram',
  svg: 'SVG',
  text: 'Text',
}

/**
 * Fences with a dedicated renderer rather than syntax highlighting. The
 * renderers themselves arrive with the rich-content slice; until then these
 * fall through to highlighted source, which is a correct if plainer reading of
 * the same content.
 */
export const RICH_LANGUAGES: ReadonlySet<string> = new Set([
  'mermaid',
  'latex',
  'svg',
  'csv',
  'json',
])

/** Normalises a raw fence tag to a highlighter language. */
export function resolveLanguage(raw: string | undefined): string {
  const tag = raw?.toLowerCase() ?? 'text'
  return LANGUAGE_ALIASES[tag] ?? tag
}

/** The label shown in a block's header. */
export function displayName(language: string): string {
  const known = DISPLAY_NAMES[language]
  if (known) return known
  if (language.length <= 4) return language.toUpperCase()
  return language.charAt(0).toUpperCase() + language.slice(1)
}
