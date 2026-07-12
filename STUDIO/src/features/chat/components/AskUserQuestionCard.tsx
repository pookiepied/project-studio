import { useState, useRef, useEffect, KeyboardEvent, ChangeEvent } from "react";
import { motion } from "framer-motion";
import { ArrowRightIcon as ArrowRight } from "@phosphor-icons/react";
import { Button } from "@/ui/primitives/Button";
import { IconButton } from "@/ui/primitives/IconButton";

interface AskUserQuestionCardProps {
  question: string;
  suggestions?: string[];
  onAnswer: (answer: string) => void;
}

export function AskUserQuestionCard({
  question,
  suggestions,
  onAnswer,
}: AskUserQuestionCardProps) {
  const [answer, setAnswer] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 120);
    return () => clearTimeout(t);
  }, []);

  const submit = () => {
    const trimmed = answer.trim();
    if (trimmed) onAnswer(trimmed);
  };

  const handleKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  const handleAnswerChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    setAnswer(e.target.value);
    e.target.style.height = "auto";
    e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 14, scale: 0.985 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 10, scale: 0.99 }}
      transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
      className="w-full overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-[0_18px_50px_-32px_rgba(15,23,42,0.5)] dark:border-surface-border dark:bg-surface-base dark:shadow-[0_18px_50px_-28px_rgba(0,0,0,0.8)]"
    >
      <div className="px-4 py-4 sm:px-5">
        <div className="text-2xs font-medium uppercase tracking-[0.2em] text-gray-400 dark:text-gray-500">
          Needs your answer
        </div>

        <p className="mt-2 text-base font-medium leading-relaxed text-gray-900 dark:text-gray-100">
          {question}
        </p>

        {suggestions && suggestions.length > 0 && (
          <div className="mt-3 space-y-1.5">
            {suggestions.map((s) => (
              <Button
                key={s}
                variant="ghost"
                onClick={() => onAnswer(s)}
                className="h-auto w-full justify-start rounded-xl border border-gray-200 bg-gray-50/60 px-3 py-2.5 text-left text-sm font-medium leading-relaxed text-gray-700 transition-colors hover:border-gray-300 hover:bg-white active:bg-gray-50 dark:border-surface-border dark:bg-surface-raised/40 dark:text-gray-300 dark:hover:border-white/20 dark:hover:bg-surface-raised focus-visible:ring-gray-400 focus-visible:ring-offset-white dark:focus-visible:ring-gray-600 dark:focus-visible:ring-offset-surface-base"
              >
                {s}
              </Button>
            ))}
          </div>
        )}

        <div className="mt-3 flex items-end gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 transition-colors focus-within:border-gray-300 focus-within:bg-white dark:border-surface-border dark:bg-[#111] dark:focus-within:border-white/20">
          <textarea
            ref={inputRef}
            value={answer}
            onChange={handleAnswerChange}
            onKeyDown={handleKey}
            rows={2}
            placeholder="Type your answer..."
            className="max-h-[120px] min-h-10 flex-1 resize-none bg-transparent py-1 text-sm leading-5 text-gray-900 outline-none placeholder:text-gray-400 dark:text-gray-100 dark:placeholder:text-gray-600"
          />
          <IconButton
            onClick={submit}
            disabled={!answer.trim()}
            aria-label="Send answer"
            className="mb-1 h-8 w-8 bg-gray-900 text-white hover:bg-gray-700 active:scale-[0.97] disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-400 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-white dark:disabled:bg-surface-selected dark:disabled:text-gray-600 focus-visible:ring-gray-400 focus-visible:ring-offset-white dark:focus-visible:ring-gray-600 dark:focus-visible:ring-offset-surface-base"
          >
            <ArrowRight size={14} weight="bold" />
          </IconButton>
        </div>
      </div>
    </motion.div>
  );
}
