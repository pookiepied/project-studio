import Editor, { type Monaco } from "@monaco-editor/react";
import { useCallback } from "react";

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  c: "c", cc: "cpp", cpp: "cpp", cxx: "cpp", h: "c", hpp: "cpp",
  cs: "csharp", css: "css", csv: "plaintext", go: "go", graphql: "graphql",
  htm: "html", html: "html", java: "java", js: "javascript", jsx: "javascript",
  json: "json", jsonc: "json", less: "less", lua: "lua", md: "markdown",
  mdx: "markdown", php: "php", prisma: "graphql", py: "python", rb: "ruby",
  rs: "rust", sass: "scss", scss: "scss", sh: "shell", sql: "sql",
  svelte: "html", swift: "swift", toml: "ini", ts: "typescript", tsx: "typescript",
  vue: "html", xml: "xml", yaml: "yaml", yml: "yaml",
};

function languageFor(path: string) {
  const name = path.replace(/\\/g, "/").split("/").pop()?.toLowerCase() ?? "";
  if (name === "dockerfile") return "dockerfile";
  if (name === "makefile") return "plaintext";
  return LANGUAGE_BY_EXTENSION[name.includes(".") ? name.split(".").pop()! : ""] ?? "plaintext";
}

export default function MonacoSourceView({ content, path }: { content: string; path: string }) {
  const defineTheme = useCallback((monaco: Monaco) => {
    monaco.editor.defineTheme("studio-files-dark", {
      base: "vs-dark",
      inherit: true,
      rules: [],
      colors: {
        "editor.background": "#00000000",
        "editorGutter.background": "#00000000",
        "editorLineNumber.foreground": "#737373",
        "editorLineNumber.activeForeground": "#b8b8b8",
        "scrollbar.shadow": "#00000000",
      },
    });
  }, []);

  return (
    <Editor
      beforeMount={defineTheme}
      height="100%"
      language={languageFor(path)}
      path={path}
      theme="studio-files-dark"
      value={content}
      options={{
        readOnly: true,
        domReadOnly: true,
        automaticLayout: true,
        minimap: { enabled: false },
        lineNumbers: "on",
        lineNumbersMinChars: 3,
        folding: true,
        glyphMargin: false,
        renderLineHighlight: "line",
        scrollBeyondLastLine: false,
        smoothScrolling: true,
        fontFamily: "'Cascadia Code Variable', 'Cascadia Code', monospace",
        fontSize: 12,
        lineHeight: 20,
        padding: { top: 12, bottom: 12 },
        wordWrap: "off",
        find: { addExtraSpaceOnTop: false },
        scrollbar: {
          verticalScrollbarSize: 10,
          horizontalScrollbarSize: 10,
          alwaysConsumeMouseWheel: false,
        },
      }}
    />
  );
}
