import { useEffect, useLayoutEffect, useRef } from "react";

interface UseChatScrollOptions {
  conversationId?: string;
  messageCount:    number;
  isStreaming:     boolean;
  hasMoreMessages: boolean;
  isLoadingMore:   boolean;
  loadMoreMessages: () => void | Promise<void>;
}

interface UseChatScrollReturn {
  messagesContainerRef: React.RefObject<HTMLDivElement | null>;
  messagesEndRef:       React.RefObject<HTMLDivElement | null>;
  messagesContentRef:   React.RefObject<HTMLDivElement | null>;
  loadMoreTriggerRef:   React.RefObject<HTMLDivElement | null>;
}

/**
 * Manages scroll behaviour for the chat message list.
 *
 *   - Auto-follows new messages appended to the bottom.
 *   - Smooth rAF-driven scroll during streaming.
 *   - Suspends auto-follow only when the user explicitly scrolls up (wheel
 *     deltaY < 0 or touch drag). Clicks and downward scrolls do not suspend it.
 *   - Auto-follow resets when the user returns to within 10 px of the bottom.
 *   - Triggers infinite-scroll load when the top sentinel becomes visible.
 */
export function useChatScroll({
  conversationId,
  messageCount,
  isStreaming,
  hasMoreMessages,
  isLoadingMore,
  loadMoreMessages,
}: UseChatScrollOptions): UseChatScrollReturn {
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const messagesEndRef       = useRef<HTMLDivElement>(null);
  const messagesContentRef   = useRef<HTMLDivElement>(null);
  const loadMoreTriggerRef   = useRef<HTMLDivElement>(null);

  const shouldAutoFollowRef  = useRef(true);
  const streamScrollFrameRef = useRef<number | null>(null);
  const prevMessageCountRef  = useRef(0);
  const touchStartYRef       = useRef<number | null>(null);
  const prependAnchorRef     = useRef<{ scrollHeight: number; scrollTop: number } | null>(null);

  // Suspend auto-follow only on upward wheel scroll or touch drag upward.
  // Downward scrolling, clicks, and other interactions do not suspend it.
  // Re-enable once the user returns to within 10 px of the bottom.
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;

    const onWheel = (e: WheelEvent) => {
      if (e.deltaY < 0) shouldAutoFollowRef.current = false;
    };

    const onTouchStart = (e: TouchEvent) => {
      touchStartYRef.current = e.touches[0]?.clientY ?? null;
    };

    const onTouchMove = (e: TouchEvent) => {
      const startY = touchStartYRef.current;
      if (startY === null) return;
      const currentY = e.touches[0]?.clientY ?? startY;
      if (currentY > startY) shouldAutoFollowRef.current = false; // dragging up = scrolling up
    };

    const onScroll = () => {
      const d = container.scrollHeight - container.scrollTop - container.clientHeight;
      if (d < 10) shouldAutoFollowRef.current = true;
    };

    const SCROLL_KEYS = new Set(["ArrowUp", "PageUp", "Home"]);
    const onKeyDown = (e: KeyboardEvent) => {
      if (SCROLL_KEYS.has(e.key)) shouldAutoFollowRef.current = false;
    };

    container.addEventListener("wheel",      onWheel,      { passive: true });
    container.addEventListener("touchstart", onTouchStart, { passive: true });
    container.addEventListener("touchmove",  onTouchMove,  { passive: true });
    container.addEventListener("scroll",     onScroll,     { passive: true });
    document.addEventListener("keydown",     onKeyDown,    { passive: true });

    return () => {
      container.removeEventListener("wheel",      onWheel);
      container.removeEventListener("touchstart", onTouchStart);
      container.removeEventListener("touchmove",  onTouchMove);
      container.removeEventListener("scroll",     onScroll);
      document.removeEventListener("keydown",     onKeyDown);
    };
  }, []);

  function isNearBottom(container: HTMLDivElement): boolean {
    return container.scrollHeight - container.scrollTop - container.clientHeight < 24;
  }

  useLayoutEffect(() => {
    const anchor = prependAnchorRef.current;
    const container = messagesContainerRef.current;
    if (!anchor || !container) return;

    const nextTop = anchor.scrollTop + (container.scrollHeight - anchor.scrollHeight);
    container.scrollTop = Math.max(0, nextTop);
    prependAnchorRef.current = null;
  }, [messageCount]);

  // Auto-scroll to bottom on initial load, or when the user is already following.
  useEffect(() => {
    const container = messagesContainerRef.current;
    const previousCount = prevMessageCountRef.current;
    if (messageCount > previousCount && (previousCount === 0 || shouldAutoFollowRef.current || (container && isNearBottom(container)))) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
      shouldAutoFollowRef.current = true;
    }
    prevMessageCountRef.current = messageCount;
  }, [messageCount]);

  // Entering a conversation: jump to the bottom once its messages have laid out,
  // so the latest message and the ready line sit above the floating composer.
  // Keyed on the conversation id (not just message count) — switching between
  // two same-length chats otherwise never re-scrolled, leaving the bottom hidden
  // and seemingly unscrollable.
  useEffect(() => {
    if (!conversationId) return;
    shouldAutoFollowRef.current = true;
    const jump = () => messagesEndRef.current?.scrollIntoView({ block: "end" });
    const raf = requestAnimationFrame(() => requestAnimationFrame(jump));
    const t = setTimeout(jump, 120); // fallback for late async message layout
    return () => { cancelAnimationFrame(raf); clearTimeout(t); };
  }, [conversationId]);

  // rAF-driven smooth follow during streaming.
  useEffect(() => {
    if (!isStreaming) return;
    const container = messagesContainerRef.current;
    if (!container) return;

    const follow = () => {
      if (shouldAutoFollowRef.current) {
        const target = container.scrollHeight - container.clientHeight;
        const diff   = target - container.scrollTop;
        if (diff > 0.5) {
          container.scrollTop += Math.min(Math.max(1, diff * 0.22), 48);
        } else if (diff > 0) {
          container.scrollTop = target;
        }
      }
      streamScrollFrameRef.current = window.requestAnimationFrame(follow);
    };

    streamScrollFrameRef.current = window.requestAnimationFrame(follow);

    return () => {
      if (streamScrollFrameRef.current !== null) {
        window.cancelAnimationFrame(streamScrollFrameRef.current);
        streamScrollFrameRef.current = null;
      }
    };
  }, [isStreaming]);

  // After streaming stops, snap back to bottom so collapsed tool chains
  // don't leave a scroll vacuum.
  useEffect(() => {
    if (isStreaming) return;
    const t = setTimeout(() => {
      if (shouldAutoFollowRef.current) {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
      }
    }, 300);
    return () => clearTimeout(t);
  }, [isStreaming]);

  // Infinite scroll: load earlier messages when the top sentinel is visible.
  useEffect(() => {
    if (!loadMoreTriggerRef.current || !hasMoreMessages || isLoadingMore) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0].isIntersecting) return;
        const container = messagesContainerRef.current;
        if (container) {
          prependAnchorRef.current = {
            scrollHeight: container.scrollHeight,
            scrollTop: container.scrollTop,
          };
          shouldAutoFollowRef.current = false;
        }
        void loadMoreMessages();
      },
      { root: messagesContainerRef.current, rootMargin: "100px", threshold: 0.1 }
    );

    observer.observe(loadMoreTriggerRef.current);
    return () => observer.disconnect();
  }, [hasMoreMessages, isLoadingMore, loadMoreMessages]);

  return { messagesContainerRef, messagesEndRef, messagesContentRef, loadMoreTriggerRef };
}
