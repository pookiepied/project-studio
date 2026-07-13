import { useCallback, useEffect, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type { MessageSegment } from "@/types";
import type { ActiveToolCall } from "./types";

interface StreamingLifecycleDeps {
  screenshotUrlsRef: MutableRefObject<string[]>;
  harnessSegmentsRef: MutableRefObject<MessageSegment[]>;
  pendingSegmentTextRef: MutableRefObject<string>;
  setError: Dispatch<SetStateAction<string | null>>;
  setIsLoading: Dispatch<SetStateAction<boolean>>;
  setIsStreaming: Dispatch<SetStateAction<boolean>>;
  setStreamingContent: Dispatch<SetStateAction<string>>;
  setStreamingMessageId: Dispatch<SetStateAction<string | null>>;
  setActiveToolCalls: Dispatch<SetStateAction<ActiveToolCall[]>>;
  setHarnessSegments: Dispatch<SetStateAction<MessageSegment[]>>;
  setThinkingContent: Dispatch<SetStateAction<string>>;
}

export function useStreamingLifecycle({
  screenshotUrlsRef,
  harnessSegmentsRef,
  pendingSegmentTextRef,
  setError,
  setIsLoading,
  setIsStreaming,
  setStreamingContent,
  setStreamingMessageId,
  setActiveToolCalls,
  setHarnessSegments,
  setThinkingContent,
}: StreamingLifecycleDeps) {
  const latestStreamingContentRef = useRef("");
  const thinkingContentRef = useRef("");
  const pendingStreamingFrameRef = useRef<number | null>(null);

  const scheduleStreamingContentUpdate = useCallback((next: string) => {
    latestStreamingContentRef.current = next;
    if (pendingStreamingFrameRef.current !== null) return;
    pendingStreamingFrameRef.current = window.requestAnimationFrame(() => {
      pendingStreamingFrameRef.current = null;
      setStreamingContent(latestStreamingContentRef.current);
    });
  }, [setStreamingContent]);

  const flushStreamingContentUpdate = useCallback(() => {
    if (pendingStreamingFrameRef.current !== null) {
      window.cancelAnimationFrame(pendingStreamingFrameRef.current);
      pendingStreamingFrameRef.current = null;
    }
    setStreamingContent(latestStreamingContentRef.current);
  }, [setStreamingContent]);

  useEffect(() => () => {
    if (pendingStreamingFrameRef.current !== null) {
      window.cancelAnimationFrame(pendingStreamingFrameRef.current);
    }
  }, []);

  const finishStreamingTurn = useCallback(() => {
    setIsStreaming(false);
    setStreamingContent("");
    latestStreamingContentRef.current = "";
    setStreamingMessageId(null);
    setActiveToolCalls([]);
    screenshotUrlsRef.current = [];
    harnessSegmentsRef.current = [];
    pendingSegmentTextRef.current = "";
    setHarnessSegments([]);
    thinkingContentRef.current = "";
    setThinkingContent("");
  }, [
    harnessSegmentsRef,
    pendingSegmentTextRef,
    screenshotUrlsRef,
    setActiveToolCalls,
    setHarnessSegments,
    setIsStreaming,
    setStreamingContent,
    setStreamingMessageId,
    setThinkingContent,
  ]);

  const failStreamingTurn = useCallback((message: string) => {
    setError(message);
    setIsLoading(false);
    setIsStreaming(false);
    setStreamingContent("");
    latestStreamingContentRef.current = "";
    setStreamingMessageId(null);
    setActiveToolCalls([]);
    thinkingContentRef.current = "";
    setThinkingContent("");
  }, [
    setActiveToolCalls,
    setError,
    setIsLoading,
    setIsStreaming,
    setStreamingContent,
    setStreamingMessageId,
    setThinkingContent,
  ]);

  return {
    latestStreamingContentRef,
    thinkingContentRef,
    scheduleStreamingContentUpdate,
    flushStreamingContentUpdate,
    finishStreamingTurn,
    failStreamingTurn,
  };
}
