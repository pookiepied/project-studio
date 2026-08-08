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
  /** Forward a wheel delta into the message scroller from an element that
   *  isn't a DOM descendant of it (e.g. the floating composer overlay). */
  forwardWheel: (deltaY: number) => void;
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
  const isStreamingRef       = useRef(isStreaming);
  useEffect(() => { isStreamingRef.current = isStreaming; }, [isStreaming]);

  // Suspend auto-follow only on upward wheel scroll or touch drag upward.
  // Downward scrolling, clicks, and other interactions do not suspend it.
  // Re-enable once the user returns to within 10 px of the bottom — but only
  // once the turn has actually finished. Re-arming on mere proximity mid-stream
  // meant a user who scrolled up got yanked back the moment the growing answer
  // caught up to their scroll position, which felt like scroll never actually
  // disabled. Once suspended during a generating answer, it now stays off for
  // the rest of that answer; only after it settles does hitting the bottom
  // re-arm auto-follow again.
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
      if (isStreamingRef.current) return;
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

  // The floating composer overlay sits as a DOM sibling of the scroll container
  // (positioned on top of it visually), not a descendant — so native wheel
  // scrolling never reaches the container while the cursor is over the
  // composer's interactive column (TurnStatus, approval cards, banner). That
  // made the list feel completely unscrollable while an answer was generating,
  // since that's exactly the area users hover to read it. This replays the
  // same delta + auto-follow bookkeeping the container's own wheel handler
  // does, just triggered from outside the container.
  function forwardWheel(deltaY: number): void {
    const container = messagesContainerRef.current;
    if (!container) return;
    if (deltaY < 0) shouldAutoFollowRef.current = false;
    container.scrollTop += deltaY;
    if (container.scrollHeight - container.scrollTop - container.clientHeight < 10) {
      shouldAutoFollowRef.current = true;
    }
  }

  function isNearBottom(container: HTMLDivElement): boolean {
    return container.scrollHeight - container.scrollTop - container.clientHeight < 24;
  }

  // Single source of truth for "the bottom": the max scrollTop. This lands the
  // last line exactly at the container's paddingBottom edge — i.e. just above the
  // floating composer — instead of behind it (which is what scrollIntoView on the
  // end sentinel did, since the sentinel sits ABOVE the paddingBottom).
  function scrollToBottom(container: HTMLDivElement, smooth: boolean): void {
    const top = container.scrollHeight - container.clientHeight;
    if (smooth) container.scrollTo({ top, behavior: "smooth" });
    else container.scrollTop = top;
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
      if (container) scrollToBottom(container, true);
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
    const jump = () => {
      const container = messagesContainerRef.current;
      if (container) scrollToBottom(container, false);
    };
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
        // Ease toward the true bottom (proportional step, no fixed px/frame cap)
        // — this is what gives the Apple-style "gliding" feel instead of a hard
        // per-frame snap. The old version capped the step at 48px/frame, so on
        // long/fast streams the target kept outrunning it and the view never
        // caught up. A proportional step has no such ceiling: it always closes
        // most of the remaining gap every frame, so it converges immediately
        // even when a lot of text lands in one tick.
        const target = container.scrollHeight - container.clientHeight;
        const diff = target - container.scrollTop;
        if (diff > 0.5) container.scrollTop += diff * 0.35;
        else if (diff > 0) container.scrollTop = target;
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
      const container = messagesContainerRef.current;
      if (container && shouldAutoFollowRef.current) scrollToBottom(container, true);
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

  return { messagesContainerRef, messagesEndRef, messagesContentRef, loadMoreTriggerRef, forwardWheel };
}
