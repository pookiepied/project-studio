import { Light as SyntaxHighlighter } from 'react-syntax-highlighter'
import bash from 'react-syntax-highlighter/dist/esm/languages/hljs/bash'
import css from 'react-syntax-highlighter/dist/esm/languages/hljs/css'
import diff from 'react-syntax-highlighter/dist/esm/languages/hljs/diff'
import go from 'react-syntax-highlighter/dist/esm/languages/hljs/go'
import json from 'react-syntax-highlighter/dist/esm/languages/hljs/json'
import markdown from 'react-syntax-highlighter/dist/esm/languages/hljs/markdown'
import python from 'react-syntax-highlighter/dist/esm/languages/hljs/python'
import rust from 'react-syntax-highlighter/dist/esm/languages/hljs/rust'
import sql from 'react-syntax-highlighter/dist/esm/languages/hljs/sql'
import typescript from 'react-syntax-highlighter/dist/esm/languages/hljs/typescript'
import xml from 'react-syntax-highlighter/dist/esm/languages/hljs/xml'
import yaml from 'react-syntax-highlighter/dist/esm/languages/hljs/yaml'

/**
 * Languages, registered explicitly.
 *
 * The `Light` build with a hand-picked set, not the full one: the default
 * export of `react-syntax-highlighter` bundles nearly two hundred grammars, and
 * a local-first desktop app has no business shipping a megabyte of parsers for
 * languages nobody in it will open.
 *
 * Adding one is an import and a register line. Anything unregistered still
 * renders -- it just renders unhighlighted, which is the correct failure.
 */
const GRAMMARS: Record<string, unknown> = {
  bash,
  css,
  diff,
  go,
  json,
  markdown,
  python,
  rust,
  sql,
  typescript,
  xml,
  yaml,
}

for (const [name, grammar] of Object.entries(GRAMMARS)) {
  SyntaxHighlighter.registerLanguage(name, grammar)
}

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
}

/** The label shown in a block's header. */
const DISPLAY: Record<string, string> = {
  bash: 'Shell',
  css: 'CSS',
  diff: 'Diff',
  go: 'Go',
  json: 'JSON',
  markdown: 'Markdown',
  python: 'Python',
  rust: 'Rust',
  sql: 'SQL',
  typescript: 'TypeScript',
  xml: 'HTML',
  yaml: 'YAML',
}

export function resolveLanguage(fence: string): string {
  const lower = fence.trim().toLowerCase()
  const resolved = ALIASES[lower] ?? lower
  return resolved in GRAMMARS ? resolved : 'text'
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

export { SyntaxHighlighter }
