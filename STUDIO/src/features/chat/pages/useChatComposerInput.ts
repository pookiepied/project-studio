import { useEffect, useRef } from "react";

interface UseChatComposerInputOptions {
  conversationId: string | undefined;
  isEmptyConversation: boolean;
  setInputMessage: (value: string | ((prev: string) => string)) => void;
  handleAtMentionInput: (
    value: string,
    cursor: number,
    ref: React.RefObject<HTMLTextAreaElement>
  ) => void;
  onSend: () => void;
}

export function useChatComposerInput({
  conversationId,
  isEmptyConversation,
  setInputMessage,
  handleAtMentionInput,
  onSend,
}: UseChatComposerInputOptions) {
  const emptyInputRef = useRef<HTMLTextAreaElement>(null);
  const conversationInputRef = useRef<HTMLTextAreaElement>(null);
  const activeInputRef = isEmptyConversation ? emptyInputRef : conversationInputRef;

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.currentTarget.value;
    setInputMessage(value);
    handleAtMentionInput(value, e.currentTarget.selectionStart ?? value.length, { current: e.currentTarget });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  };

  useEffect(() => {
    if (!conversationId) return;
    const raf = requestAnimationFrame(() => activeInputRef.current?.focus());
    return () => cancelAnimationFrame(raf);
  }, [conversationId, activeInputRef]);

  useEffect(() => {
    const handler = (e: Event) => {
      const text = (e as CustomEvent<{ text: string }>).detail?.text;
      if (text) {
        setInputMessage(text);
        setTimeout(() => activeInputRef.current?.focus(), 50);
      }
    };
    const focusHandler = () => {
      setTimeout(() => activeInputRef.current?.focus(), 50);
    };

    window.addEventListener("inject-chat-text", handler);
    window.addEventListener("focus-chat-input", focusHandler);
    return () => {
      window.removeEventListener("inject-chat-text", handler);
      window.removeEventListener("focus-chat-input", focusHandler);
    };
  }, [activeInputRef, setInputMessage]);

  return {
    emptyInputRef,
    conversationInputRef,
    activeInputRef,
    handleInputChange,
    handleKeyDown,
  };
}
