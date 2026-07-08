import { useState, useRef, useEffect } from "react";

interface Message {
  id: string;
  role: string;
  content: string | unknown;
}

interface UseMessageEditOptions {
  messages: Message[];
  editMessage: (id: string, content: string) => Promise<void>;
  editMessageAndRegenerate: (id: string, content: string) => Promise<void>;
}

export function useMessageEdit({ messages, editMessage, editMessageAndRegenerate }: UseMessageEditOptions) {
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingContent,   setEditingContent]   = useState("");
  const editTextareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (editTextareaRef.current) {
      editTextareaRef.current.style.height = "auto";
      editTextareaRef.current.style.height = `${editTextareaRef.current.scrollHeight}px`;
    }
  }, [editingContent]);

  const handleEditMessage = (id: string, content: string) => {
    setEditingMessageId(id);
    setEditingContent(content.replace(/```text\n([\s\S]*?)\n```/g, "$1").trim());
  };

  const handleSaveEdit = async () => {
    if (!editingMessageId || !editingContent.trim()) return;
    const msg = messages.find(m => m.id === editingMessageId);
    if (msg?.role === "user") {
      await editMessageAndRegenerate(editingMessageId, editingContent.trim());
    } else {
      await editMessage(editingMessageId, editingContent.trim());
    }
    setEditingMessageId(null);
    setEditingContent("");
  };

  const handleCancelEdit = () => {
    setEditingMessageId(null);
    setEditingContent("");
  };

  return {
    editingMessageId,
    editingContent,
    setEditingContent,
    editTextareaRef,
    handleEditMessage,
    handleSaveEdit,
    handleCancelEdit,
  };
}
