import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import markdownComponents from '@/features/markdown/MarkdownComponents';

interface StreamingTextProps {
  content: string;
  showCursor?: boolean;
  className?: string;
}

function normalizeStreamingMarkdown(input: string): string {
  let result = input;

  // Close unclosed code fences — prevents everything after ``` from rendering as a raw code block
  const fenceMatches = result.match(/```/g) || [];
  if (fenceMatches.length % 2 === 1) {
    result = result + '\n```';
  }

  // Hide dangling bold marker at end of stream — prevents raw ** from showing mid-token
  const boldMarkerCount = (result.match(/\*\*/g) || []).length;
  if (boldMarkerCount % 2 === 1) {
    const lastOpen = result.lastIndexOf('**');
    if (lastOpen >= 0) {
      result = result.slice(0, lastOpen) + result.slice(lastOpen + 2);
    }
  }

  return result;
}

export const StreamingText = ({
  content,
  showCursor = true,
  className = 'prose-chat'
}: StreamingTextProps) => {
  const [displayedContent, setDisplayedContent] = useState(content);
  const targetContentRef = useRef(content);
  const displayedContentRef = useRef(content);
  const animationFrameRef = useRef<number | null>(null);
  const lastFrameTimeRef = useRef<number | null>(null);

  useEffect(() => {
    targetContentRef.current = content;

    // Reset immediately when content shrinks (new stream / regen swap).
    if (content.length < displayedContentRef.current.length) {
      displayedContentRef.current = content;
      setDisplayedContent(content);
    }

    if (animationFrameRef.current !== null) return;

    const tick = (timestamp: number) => {
      const last = lastFrameTimeRef.current ?? timestamp;
      const deltaMs = Math.max(0, timestamp - last);
      lastFrameTimeRef.current = timestamp;

      const current = displayedContentRef.current;
      const target = targetContentRef.current;

      if (current.length >= target.length) {
        animationFrameRef.current = null;
        return;
      }

      const lag = target.length - current.length;
      const baseCharsPerSecond = 90;
      const boostedCharsPerSecond = Math.min(320, baseCharsPerSecond + lag * 0.5);
      const charsThisFrame = Math.max(1, Math.floor((boostedCharsPerSecond * deltaMs) / 1000));
      const nextLength = Math.min(target.length, current.length + charsThisFrame);
      const next = target.slice(0, nextLength);

      displayedContentRef.current = next;
      setDisplayedContent(next);
      animationFrameRef.current = window.requestAnimationFrame(tick);
    };

    animationFrameRef.current = window.requestAnimationFrame(tick);

    return () => {
      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      lastFrameTimeRef.current = null;
    };
  }, [content]);

  const normalized = normalizeStreamingMarkdown(displayedContent);

  return (
    <div className={className}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
        {normalized}
      </ReactMarkdown>
      {showCursor && displayedContent.length > 0 && (
        <motion.span
          animate={{ opacity: [0, 0.55, 0] }}
          transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
          className="inline-block w-[2px] h-[0.72em] rounded-full bg-gray-400 dark:bg-gray-500 ml-[3px] align-middle"
        />
      )}
    </div>
  );
};
