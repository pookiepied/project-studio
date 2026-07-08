import { useMemo } from "react";
import katex from "katex";
import "katex/dist/katex.min.css";

interface LatexRendererProps {
  code: string;
}

/**
 * LLMs sometimes output full LaTeX documents or wrapped expressions.
 * Strip all of that down to a bare math expression KaTeX can render.
 */
function extractMathExpression(raw: string): string {
  let code = raw.trim();

  // Strip full LaTeX document (everything before \begin{document} content)
  const docBodyMatch = code.match(/\\begin\{document\}([\s\S]*?)\\end\{document\}/);
  if (docBodyMatch) {
    code = docBodyMatch[1].trim();
  }

  // Strip \documentclass, \usepackage, \title, etc. preamble lines if still present
  code = code
    .split("\n")
    .filter((line) => !/^\\(documentclass|usepackage|title|author|date|maketitle|pagestyle|setlength|geometry|newcommand|renewcommand)\b/.test(line.trim()))
    .join("\n")
    .trim();

  // Strip display math delimiters: \[ ... \]
  if (code.startsWith("\\[") && code.endsWith("\\]")) {
    return code.slice(2, -2).trim();
  }

  // Strip inline math delimiters: \( ... \)
  if (code.startsWith("\\(") && code.endsWith("\\)")) {
    return code.slice(2, -2).trim();
  }

  // Strip $$ ... $$
  const dblDollar = code.match(/^\$\$([\s\S]+)\$\$$/);
  if (dblDollar) return dblDollar[1].trim();

  // Strip $ ... $
  const snglDollar = code.match(/^\$([\s\S]+)\$$/);
  if (snglDollar) return snglDollar[1].trim();

  // Strip \begin{equation} ... \end{equation} (and align, gather, etc.)
  const envMatch = code.match(/\\begin\{(?:equation|align|gather|multline|eqnarray)\*?\}([\s\S]*?)\\end\{(?:equation|align|gather|multline|eqnarray)\*?\}/);
  if (envMatch) return envMatch[1].trim();

  return code;
}

export function LatexRenderer({ code }: LatexRendererProps) {
  const { html, error } = useMemo(() => {
    const expr = extractMathExpression(code);
    try {
      return {
        html: katex.renderToString(expr, {
          displayMode: true,
          throwOnError: true,
          trust: false,
          // Allow common LaTeX environments
          macros: {},
        }),
        error: null,
      };
    } catch (e: any) {
      // KaTeX error messages are verbose — extract just the useful part
      const msg = (e?.message ?? "Failed to render formula")
        .replace(/KaTeX parse error: /, "")
        .split("\n")[0];
      return { html: null, error: msg };
    }
  }, [code]);

  if (error) {
    return (
      <div className="px-4 py-3 space-y-1.5">
        <p className="text-xs text-secondary dark:text-secondary font-medium">Formula error: {error}</p>
        <pre className="text-xs text-gray-400 dark:text-gray-500 font-mono whitespace-pre-wrap">{code}</pre>
      </div>
    );
  }

  return (
    <div
      className="flex items-center justify-center px-6 py-5 overflow-x-auto text-gray-800 dark:text-gray-200"
      dangerouslySetInnerHTML={{ __html: html! }}
    />
  );
}
