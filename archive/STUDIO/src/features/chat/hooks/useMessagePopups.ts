import { useState, useEffect } from "react";

export function useMessagePopups() {
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [ttsMenuId,       setTtsMenuId]       = useState<string | null>(null);

  useEffect(() => {
    if (!ttsMenuId) return;
    const close = () => setTtsMenuId(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setTtsMenuId(null); };
    document.addEventListener("click",   close);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("click", close); document.removeEventListener("keydown", onKey); };
  }, [ttsMenuId]);

  const handleCopyMessage = async (content: string, id: string) => {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedMessageId(id);
      setTimeout(() => setCopiedMessageId(null), 2000);
    } catch { /* silent */ }
  };

  return {
    copiedMessageId,
    ttsMenuId,
    setTtsMenuId,
    handleCopyMessage,
  };
}
