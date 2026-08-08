const DOC_CODE_EXTS = new Set([
  '.js','.ts','.jsx','.tsx','.py','.go','.rs','.java','.c','.cpp','.cs',
  '.rb','.php','.sh','.html','.htm','.css','.xml','.yaml','.yml','.toml','.json',
]);

function getDocLabel(ext: string): string {
  const e = ext.toLowerCase();
  if (e === '.md' || e === '.markdown') return 'MD';
  if (DOC_CODE_EXTS.has(e)) return '</>';
  return e.replace('.', '').toUpperCase().slice(0, 4) || 'DOC';
}

interface DocumentAttachmentChipProps {
  name: string;
  extension: string;
}

export const DocumentAttachmentChip = ({ name, extension }: DocumentAttachmentChipProps) => (
  <div className="flex items-center gap-2 px-3 py-2 bg-surface-base dark:bg-surface-raised rounded-xl border border-surface-border dark:border-surface-border max-w-[220px]">
    <div className="w-7 h-7 rounded-lg bg-surface-raised dark:bg-surface-border flex items-center justify-center flex-shrink-0">
      <span className="text-2xs font-bold font-mono text-secondary dark:text-disabled">
        {getDocLabel(extension)}
      </span>
    </div>
    <span className="text-xs font-medium text-secondary dark:text-disabled truncate">{name}</span>
  </div>
);
