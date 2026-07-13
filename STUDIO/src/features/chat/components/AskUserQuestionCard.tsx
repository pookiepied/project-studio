import { useState, useRef, useEffect, KeyboardEvent, ChangeEvent } from "react";
import { motion } from "framer-motion";
import { Forward } from "@/ui/icons";
import { Button } from "@/ui/primitives/Button";
import { IconButton } from "@/ui/primitives/IconButton";
import { Textarea } from "@/ui/primitives/Textarea";

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
      className="w-full overflow-hidden rounded-2xl border border-surface-border bg-surface-page shadow-lg dark:bg-surface-base"
    >
      <div className="px-4 py-4 sm:px-5">
        <div className="text-2xs font-medium uppercase tracking-[0.2em] text-disabled dark:text-muted">
          Needs your answer
        </div>

        <p className="mt-2 text-base font-medium leading-relaxed text-primary dark:text-primary">
          {question}
        </p>

        {suggestions && suggestions.length > 0 && (
          <div className="mt-3 space-y-1.5">
            {suggestions.map((s) => (
              <Button
                key={s}
                variant="ghost"
                onClick={() => onAnswer(s)}
                className="h-auto w-full justify-start rounded-xl border border-surface-border bg-surface-base/60 px-3 py-2.5 text-left text-sm font-medium leading-relaxed text-secondary transition-colors hover:border-surface-border hover:bg-surface-page active:bg-surface-base dark:bg-surface-raised/40 dark:hover:bg-surface-raised focus-visible:ring-2 focus-visible:ring-focus"
              >
                {s}
              </Button>
            ))}
          </div>
        )}

        <div className="mt-3 flex items-end gap-2 rounded-xl border border-surface-border bg-surface-base px-3 py-2 transition-colors focus-within:border-surface-border focus-within:bg-surface-page dark:bg-surface-deep dark:focus-within:border-surface-border">
          <Textarea
            ref={inputRef}
            value={answer}
            onChange={handleAnswerChange}
            onKeyDown={handleKey}
            rows={2}
            placeholder="Type your answer..."
            className="max-h-[120px] min-h-10 flex-1 resize-none border-0 bg-transparent px-0 py-1 text-sm leading-5 text-primary placeholder:text-muted focus-visible:ring-0"
          />
          <IconButton
            onClick={submit}
            disabled={!answer.trim()}
            aria-label="Send answer"
            className="mb-1 h-8 w-8 bg-primary text-on-emphasis hover:bg-secondary active:scale-[0.97] disabled:cursor-not-allowed disabled:bg-surface-selected disabled:text-disabled dark:disabled:bg-surface-selected focus-visible:ring-2 focus-visible:ring-focus"
          >
            <Forward size="sm" />
          </IconButton>
        </div>
      </div>
    </motion.div>
  );
}
