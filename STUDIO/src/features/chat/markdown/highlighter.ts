import { Light as SyntaxHighlighter } from 'react-syntax-highlighter'
import bash from 'react-syntax-highlighter/dist/esm/languages/hljs/bash'
import c from 'react-syntax-highlighter/dist/esm/languages/hljs/c'
import cpp from 'react-syntax-highlighter/dist/esm/languages/hljs/cpp'
import csharp from 'react-syntax-highlighter/dist/esm/languages/hljs/csharp'
import css from 'react-syntax-highlighter/dist/esm/languages/hljs/css'
import diff from 'react-syntax-highlighter/dist/esm/languages/hljs/diff'
import go from 'react-syntax-highlighter/dist/esm/languages/hljs/go'
import java from 'react-syntax-highlighter/dist/esm/languages/hljs/java'
import json from 'react-syntax-highlighter/dist/esm/languages/hljs/json'
import kotlin from 'react-syntax-highlighter/dist/esm/languages/hljs/kotlin'
import markdown from 'react-syntax-highlighter/dist/esm/languages/hljs/markdown'
import php from 'react-syntax-highlighter/dist/esm/languages/hljs/php'
import python from 'react-syntax-highlighter/dist/esm/languages/hljs/python'
import ruby from 'react-syntax-highlighter/dist/esm/languages/hljs/ruby'
import rust from 'react-syntax-highlighter/dist/esm/languages/hljs/rust'
import scala from 'react-syntax-highlighter/dist/esm/languages/hljs/scala'
import sql from 'react-syntax-highlighter/dist/esm/languages/hljs/sql'
import swift from 'react-syntax-highlighter/dist/esm/languages/hljs/swift'
import typescript from 'react-syntax-highlighter/dist/esm/languages/hljs/typescript'
import xml from 'react-syntax-highlighter/dist/esm/languages/hljs/xml'
import yaml from 'react-syntax-highlighter/dist/esm/languages/hljs/yaml'

/**
 * The renderer and its grammars, registered explicitly.
 *
 * The `Light` build with a hand-picked set, not the full one: the default
 * export of `react-syntax-highlighter` bundles nearly two hundred grammars,
 * and a local-first desktop app has no business shipping a megabyte of
 * parsers for languages nobody in it will open. Which languages, and why, is
 * `languages.ts`; this file is the part that costs, and it is imported
 * lazily by the one component that draws highlighted code.
 */
const GRAMMARS: Record<string, unknown> = {
  bash,
  c,
  cpp,
  csharp,
  css,
  diff,
  go,
  java,
  json,
  kotlin,
  markdown,
  php,
  python,
  ruby,
  rust,
  scala,
  sql,
  swift,
  typescript,
  xml,
  yaml,
}

for (const [name, grammar] of Object.entries(GRAMMARS)) {
  SyntaxHighlighter.registerLanguage(name, grammar)
}

export { SyntaxHighlighter }
