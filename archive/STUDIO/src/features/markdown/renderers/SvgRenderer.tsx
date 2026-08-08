interface SvgRendererProps {
  code: string;
}

export function SvgRenderer({ code }: SvgRendererProps) {
  const isSvg = code.trim().toLowerCase().startsWith("<svg");

  if (!isSvg) {
    return (
      <div className="px-4 py-3 text-xs text-muted dark:text-muted font-mono whitespace-pre-wrap">
        {code}
      </div>
    );
  }

  return (
    <div
      className="flex items-center justify-center px-6 py-6 overflow-x-auto [&_svg]:max-w-full [&_svg]:h-auto"
      dangerouslySetInnerHTML={{ __html: code }}
    />
  );
}
