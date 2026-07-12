import { memo, type ComponentPropsWithoutRef } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

function resolveLocalImage(source: string | undefined, documentPath: string) {
  if (!source || /^(?:https?:|data:|blob:|\/\/|#)/i.test(source)) return source;
  const [pathPart, suffix = ""] = source.split(/(?=[?#])/u, 2);
  const decoded = decodeURIComponent(pathPart);
  if (/^(?:[A-Za-z]:[\\/]|\/)/.test(decoded)) return `${convertFileSrc(decoded)}${suffix}`;
  const separator = documentPath.includes("\\") ? "\\" : "/";
  const base = documentPath.replace(/[\\/][^\\/]*$/, "");
  const segments = `${base}${separator}${decoded}`.split(/[\\/]+/);
  const resolved: string[] = [];
  for (const segment of segments) {
    if (segment === "..") resolved.pop();
    else if (segment && segment !== ".") resolved.push(segment);
  }
  const prefix = /^[A-Za-z]:/.test(resolved[0] ?? "") ? "" : separator;
  return `${convertFileSrc(prefix + resolved.join(separator))}${suffix}`;
}

const components: Components = {
  h1: ({ children }) => <h1 className="mb-5 mt-1 border-b border-surface-divider pb-3 text-2xl font-semibold text-primary">{children}</h1>,
  h2: ({ children }) => <h2 className="mb-3 mt-7 text-lg font-semibold text-primary">{children}</h2>,
  h3: ({ children }) => <h3 className="mb-2 mt-5 text-sm font-semibold text-primary">{children}</h3>,
  p: ({ children }) => <p className="my-3 text-sm leading-6 text-secondary">{children}</p>,
  ul: ({ children }) => <ul className="my-3 list-disc space-y-1 pl-6 text-sm leading-6 text-secondary">{children}</ul>,
  ol: ({ children }) => <ol className="my-3 list-decimal space-y-1 pl-6 text-sm leading-6 text-secondary">{children}</ol>,
  blockquote: ({ children }) => <blockquote className="my-4 border-l-2 border-amber-500/70 pl-4 text-muted">{children}</blockquote>,
  a: ({ children, href }) => <a href={href} className="text-sky-500 underline underline-offset-2">{children}</a>,
  code: ({ children, className }) => className ? (
    <code className="block overflow-x-auto rounded-md border border-surface-divider bg-surface-base p-4 font-mono text-xs leading-5 text-secondary scrollbar-files">{children}</code>
  ) : <code className="rounded bg-surface-base px-1 py-0.5 font-mono text-[0.9em] text-primary">{children}</code>,
  table: ({ children }) => <div className="my-4 overflow-x-auto scrollbar-files"><table className="w-full border-collapse text-left text-sm">{children}</table></div>,
  th: ({ children }) => <th className="border border-surface-divider bg-surface-base px-3 py-2 font-semibold text-primary">{children}</th>,
  td: ({ children }) => <td className="border border-surface-divider px-3 py-2 text-secondary">{children}</td>,
  hr: () => <hr className="my-6 border-surface-divider" />,
};

const MarkdownDocumentPreview = memo(function MarkdownDocumentPreview({ content, path }: { content: string; path: string }) {
  const image = ({ src, alt, ...props }: ComponentPropsWithoutRef<"img">) => (
    <img {...props} src={resolveLocalImage(src, path)} alt={alt ?? ""} className="my-5 max-w-full rounded border border-surface-divider" />
  );
  return (
    <div className="scrollbar-files h-full overflow-auto overscroll-contain px-7 py-7">
      <article className="mx-auto w-full max-w-3xl min-w-0 break-words">
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ ...components, img: image }}>
          {content || "_Empty file_"}
        </ReactMarkdown>
      </article>
    </div>
  );
});

export default MarkdownDocumentPreview;
