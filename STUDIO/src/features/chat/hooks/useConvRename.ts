import { useState, useEffect } from "react";
import type { ChatConversation } from "@/types";

interface UseConvRenameInput {
  conversation: ChatConversation | null;
  updateTitle: (title: string) => Promise<void>;
  reloadConversations: () => Promise<void>;
}

interface UseConvRenameResult {
  isEditingTitle: boolean;
  titleInput: string;
  setIsEditingTitle: (editing: boolean) => void;
  setTitleInput: (title: string) => void;
  handleSaveTitle: () => Promise<void>;
}

export function useConvRename({
  conversation,
  updateTitle,
  reloadConversations,
}: UseConvRenameInput): UseConvRenameResult {
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleInput,     setTitleInput]     = useState("");

  useEffect(() => {
    if (isEditingTitle && conversation) setTitleInput(conversation.title);
  }, [isEditingTitle, conversation]);

  const handleSaveTitle = async () => {
    if (!titleInput.trim()) return;
    await updateTitle(titleInput.trim());
    await reloadConversations();
    setIsEditingTitle(false);
  };

  return { isEditingTitle, titleInput, setIsEditingTitle, setTitleInput, handleSaveTitle };
}
