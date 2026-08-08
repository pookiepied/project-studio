import { useCallback, useMemo } from "react";
import { Close } from "@/ui/icons";
import { motion } from "framer-motion";
import { IconButton } from "@/ui/primitives/IconButton";
import { FileAttachment } from "@/features/chat/attachments/fileAttachmentService";
import { DOC_RAG_THRESHOLD } from "@/features/chat/attachments/docIndexService";

const CODE_EXTS = new Set([
  '.js','.ts','.jsx','.tsx','.py','.go','.rs','.java','.c','.cpp','.cs',
  '.rb','.php','.sh','.html','.htm','.css','.xml','.yaml','.yml','.toml','.json',
]);

function getDocBadge(ext: string): string {
  const e = ext.toLowerCase();
  if (e === '.pdf') return 'PDF';
  if (e === '.md' || e === '.markdown') return 'MD';
  if (CODE_EXTS.has(e)) return '</>';
  return e.replace('.', '').toUpperCase().slice(0, 4) || 'DOC';
}

interface AttachmentInputProps {
  attachments: FileAttachment[];
  onAttachmentsChange: (attachments: FileAttachment[]) => void;
  disabled?: boolean;
}

interface AttachmentThumbnailProps {
  attachment: FileAttachment;
  onRemove?: () => void;
}

const AttachmentThumbnail = ({ attachment, onRemove }: AttachmentThumbnailProps) => {
  // Safe memoization of object URL to avoid memory leaks on re-renders
  const objectUrl = useMemo(() => {
    if (attachment.isImage && attachment.file) {
      return URL.createObjectURL(attachment.file);
    }
    return null;
  }, [attachment.file, attachment.isImage]);

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      className="relative group"
    >
      <div className={`w-14 h-14 rounded-xl overflow-hidden border ${
        attachment.isPDF
          ? 'bg-surface-raised dark:bg-surface-raised/30 border-surface-border dark:border-surface-border/40'
          : 'bg-surface-base dark:bg-surface-raised border-surface-border dark:border-surface-border'
      }`}>
        {objectUrl ? (
          <img
            src={objectUrl}
            alt={attachment.name}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center gap-1 px-1">
            <span className={`text-xs font-bold font-mono leading-none ${
              attachment.isPDF
                ? 'text-secondary dark:text-secondary'
                : 'text-muted dark:text-disabled'
            }`}>
              {getDocBadge(attachment.extension)}
            </span>
            {attachment.isPDF && attachment.pdfPageCount ? (
              <span className="text-3xs text-secondary dark:text-secondary leading-none">
                {attachment.pdfPageCount}p
              </span>
            ) : null}
            {!attachment.isImage && !attachment.isPDF && attachment.content && attachment.content.length > DOC_RAG_THRESHOLD ? (
              <span className="text-3xs font-bold text-secondary dark:text-secondary leading-none tracking-wide">
                RAG
              </span>
            ) : null}
            <span className="text-3xs text-disabled dark:text-muted w-full text-center leading-none truncate px-0.5">
              {attachment.name.length > 9 ? attachment.name.slice(0, 8) + '…' : attachment.name}
            </span>
          </div>
        )}
      </div>
      
      {onRemove && (
        <IconButton
          onClick={onRemove}
          aria-label="Remove"
          title="Remove"
          className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-surface-raised dark:bg-secondary transition-opacity"
        >
          <Close size="xs" className="text-on-emphasis" />
        </IconButton>
      )}
    </motion.div>
  );
};

export const AttachmentInput = ({
  attachments,
  onAttachmentsChange,
  disabled = false
}: AttachmentInputProps) => {
  const removeAttachment = useCallback((id: string) => {
    const filtered = attachments.filter(a => a.id !== id);
    onAttachmentsChange(filtered);
  }, [attachments, onAttachmentsChange]);

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {attachments.map((attachment) => (
        <AttachmentThumbnail 
          key={attachment.id}
          attachment={attachment}
          onRemove={disabled ? undefined : () => removeAttachment(attachment.id)}
        />
      ))}
    </div>
  );
};
