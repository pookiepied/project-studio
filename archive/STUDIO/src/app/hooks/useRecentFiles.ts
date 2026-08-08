import { useState, useCallback } from "react";
import type { FileAttachment } from "@/features/chat/attachments/fileAttachmentService";
import { cacheImageFile, cachePDFPages } from "@/features/chat/attachments/imageCacheService";

const STORAGE_KEY    = "studio_recent_files";
const MAX_FILES      = 5;
const MAX_CONTENT    = 300_000; // chars — skip caching images/large PDFs

export interface RecentFileEntry {
  id:            string;
  name:          string;
  type:          string;
  extension:     string;
  size:          number;
  contextPrompt: string;
  isImage?:      boolean;
  isPDF?:        boolean;
  content?:      string; // undefined when file was too large or binary
  lastUsed:      number;
}

function load(): RecentFileEntry[] {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]"); }
  catch { return []; }
}

function persist(entries: RecentFileEntry[]) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(entries)); }
  catch { /* quota exceeded — silently skip */ }
}

export function useRecentFiles() {
  const [recentFiles, setRecentFiles] = useState<RecentFileEntry[]>(load);

  const addRecentFile = useCallback((att: FileAttachment) => {
    const entry: RecentFileEntry = {
      id:            att.id,
      name:          att.name,
      type:          att.type,
      extension:     att.extension,
      size:          att.size,
      contextPrompt: att.contextPrompt,
      isImage:       att.isImage,
      isPDF:         att.isPDF,
      // Only cache text content — skip images and oversized docs
      content:       (!att.isImage && att.content && att.content.length < MAX_CONTENT)
                       ? att.content
                       : undefined,
      lastUsed:      Date.now(),
    };
    // Cache binary data in IndexedDB (fire and forget)
    if (att.isImage && att.file) {
      cacheImageFile(att.name, att.size, att.file);
    } else if (att.isPDF && att.pdfPageImages?.length) {
      cachePDFPages(att.name, att.size, att.pdfPageImages);
    }

    setRecentFiles(prev => {
      // Deduplicate by name+size
      const filtered = prev.filter(f => !(f.name === att.name && f.size === att.size));
      const next     = [entry, ...filtered].slice(0, MAX_FILES);
      persist(next);
      return next;
    });
  }, []);

  return { recentFiles, addRecentFile };
}

export function recentEntryToAttachment(entry: RecentFileEntry): FileAttachment {
  return {
    id:            `${entry.id}-r-${Date.now()}`,
    name:          entry.name,
    type:          entry.type,
    extension:     entry.extension,
    size:          entry.size,
    contextPrompt: entry.contextPrompt,
    isImage:       entry.isImage,
    isPDF:         entry.isPDF,
    content:       entry.content,
  };
}
