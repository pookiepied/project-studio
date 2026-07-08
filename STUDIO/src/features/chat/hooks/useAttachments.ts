import { useState, useRef, useCallback, type ChangeEvent } from "react";
import { processFile } from "@/services/files/fileAttachmentService";
import { validateAttachments } from "@/services/files/attachmentLimits";
import type { FileAttachment } from "@/services/files/fileAttachmentService";
import { useRecentFiles, recentEntryToAttachment } from "@/hooks/useRecentFiles";
import type { RecentFileEntry } from "@/hooks/useRecentFiles";
import { useOnClickOutside } from "@/hooks/useOnClickOutside";
import { getCachedFile, dataUrlToFile } from "@/services/files/imageCacheService";
import { uploadDocument } from "@/services/files/documentUploadService";

type ModelsParam = Parameters<typeof validateAttachments>[1];

interface UseAttachmentsOptions {
  models: ModelsParam;
  currentModel: string;
}

export function useAttachments({ models, currentModel }: UseAttachmentsOptions) {
  const [attachments,    setAttachments]    = useState<FileAttachment[]>([]);
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const attachMenuRef = useRef<HTMLDivElement>(null);
  const fileInputRef  = useRef<HTMLInputElement>(null);

  // Pending document upload state — set when the user picks a non-image file.
  // The DocumentStorageModal renders while this is non-null.
  const [pendingFiles,    setPendingFiles]    = useState<File[]>([]);
  const [isDocUploading, setIsDocUploading] = useState(false);

  const { recentFiles, addRecentFile } = useRecentFiles();

  useOnClickOutside(attachMenuRef, () => setShowAttachMenu(false), showAttachMenu);

  const handleTriggerFileInput = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  // ── Shared helper: process + optionally upload, then add to attachments ──────
  const processAndAdd = useCallback(async (
    files: File[],
    permanent: boolean | null, // null = skip server upload
  ) => {
    const newAttachments: FileAttachment[] = [];
    const failed: { name: string; error: string }[] = [];

    for (const file of files) {
      try {
        const attachment = await processFile(file);

        if (permanent !== null && !attachment.isImage) {
          try {
            const result = await uploadDocument(file, permanent);
            newAttachments.push({
              ...attachment,
              serverDoc: {
                docId:     result.docId,
                permanent: result.permanent,
                expiresAt: result.expiresAt ?? undefined,
              },
            });
          } catch {
            // Server upload failed — still attach inline
            newAttachments.push(attachment);
          }
        } else {
          newAttachments.push(attachment);
        }
      } catch (err) {
        failed.push({ name: file.name, error: err instanceof Error ? err.message : String(err) });
      }
    }

    if (failed.length > 0) {
      alert(`Upload Error:\n\n${failed.map(f => `• ${f.name}: ${f.error}`).join("\n")}`);
    }
    if (newAttachments.length === 0) return;

    const all        = [...attachments, ...newAttachments];
    const validation = validateAttachments(all, models, currentModel);
    if (!validation.isValid) { alert(`Validation Error: ${validation.error}`); return; }

    setAttachments(all);
    newAttachments.forEach(a => addRecentFile(a));
  }, [attachments, models, currentModel, addRecentFile]);

  // ── Shared entry point: split images (inline) from documents (storage modal) ──
  // Used by the file picker, paste, and drag-and-drop alike.
  const addFiles = useCallback(async (files: File[]) => {
    if (files.length === 0) return;

    const images: File[]    = [];
    const documents: File[] = [];

    const imgExts = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"]);
    for (const f of files) {
      const ext = f.name.toLowerCase().match(/\.[^.]+$/)?.[0] ?? "";
      // Pasted/dropped images often have an empty or generic name — trust the
      // MIME type first, fall back to extension.
      if (f.type.startsWith("image/") || imgExts.has(ext)) {
        images.push(f);
      } else {
        documents.push(f);
      }
    }

    // Images go straight through — no storage modal
    if (images.length > 0) {
      const imgAttachments: FileAttachment[] = [];
      for (const img of images) {
        try { imgAttachments.push(await processFile(img)); } catch { /* skip */ }
      }
      if (imgAttachments.length > 0) {
        const all = [...attachments, ...imgAttachments];
        const v   = validateAttachments(all, models, currentModel);
        if (v.isValid) {
          setAttachments(all);
          imgAttachments.forEach(a => addRecentFile(a));
        } else {
          alert(`Validation Error: ${v.error}`);
        }
      }
    }

    // Documents → show the storage choice modal
    if (documents.length > 0) {
      setPendingFiles(documents);
    }
  }, [attachments, models, currentModel, addRecentFile]);

  // ── File input change handler ─────────────────────────────────────────────────
  const handleFileSelect = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    await addFiles(Array.from(files));
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  // ── Modal callbacks ───────────────────────────────────────────────────────────
  const confirmDocUpload = useCallback(async (permanent: boolean | null) => {
    const files = pendingFiles;
    setPendingFiles([]);
    setIsDocUploading(true);
    try {
      await processAndAdd(files, permanent);
    } finally {
      setIsDocUploading(false);
    }
  }, [pendingFiles, processAndAdd]);

  const cancelDocUpload = useCallback(() => {
    setPendingFiles([]);
  }, []);

  // ── Recent files ──────────────────────────────────────────────────────────────
  const handleSelectRecentFile = useCallback(async (entry: RecentFileEntry) => {
    let attachment: FileAttachment;

    if (!entry.content) {
      const cached = await getCachedFile(entry.name, entry.size);
      if (!cached) {
        alert(`"${entry.name}" is not cached. Please upload the file again.`);
        return;
      }
      if (cached.kind === "image") {
        attachment = {
          ...recentEntryToAttachment(entry),
          file: dataUrlToFile(cached.dataUrl, entry.name, entry.type),
        };
      } else if (cached.kind === "pdf-pages") {
        attachment = {
          ...recentEntryToAttachment(entry),
          pdfPageImages: cached.pageImages,
        };
      } else {
        alert(`"${entry.name}" is not cached. Please upload the file again.`);
        return;
      }
    } else {
      attachment = recentEntryToAttachment(entry);
    }

    const all        = [...attachments, attachment];
    const validation = validateAttachments(all, models, currentModel);
    if (!validation.isValid) { alert(`Validation Error: ${validation.error}`); return; }
    setAttachments(all);
  }, [attachments, models, currentModel]);

  return {
    attachments,
    setAttachments,
    showAttachMenu,
    setShowAttachMenu,
    attachMenuRef,
    fileInputRef,
    recentFiles,
    handleTriggerFileInput,
    handleFileSelect,
    handleSelectRecentFile,
    addFiles,
    // Document storage modal state
    pendingFiles,
    isDocUploading,
    confirmDocUpload,
    cancelDocUpload,
  };
}
