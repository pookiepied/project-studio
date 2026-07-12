import { motion, AnimatePresence } from "framer-motion";
import {
  CheckCircleIcon as CheckCircle,
  CircleDashedIcon as CircleDashed,
  CircleIcon as Circle,
} from "@phosphor-icons/react";
import type { TaskItem } from "@/features/chat/context";

interface TaskWriteCardProps {
  todos: TaskItem[];
  isRunning?: boolean;
}

function StatusIcon({ status }: { status: TaskItem["status"] }) {
  if (status === "completed") {
    return (
      <CheckCircle
        size={14}
        weight="fill"
        className="text-gray-300 dark:text-gray-600 flex-shrink-0 mt-px"
      />
    );
  }
  if (status === "in_progress") {
    return (
      <motion.div
        animate={{ rotate: 360 }}
        transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
        className="flex-shrink-0 mt-px"
      >
        <CircleDashed size={14} weight="bold" className="text-gray-500 dark:text-gray-400" />
      </motion.div>
    );
  }
  return (
    <Circle
      size={14}
      weight="regular"
      className="text-gray-200 dark:text-gray-700 flex-shrink-0 mt-px"
    />
  );
}

function progressStats(todos: TaskItem[]) {
  const total = todos.length;
  const done = todos.filter((t) => t.status === "completed").length;
  const active = todos.find((t) => t.status === "in_progress");
  return { total, done, active };
}

export function TaskWriteCard({ todos, isRunning = false }: TaskWriteCardProps) {
  if (todos.length === 0) return null;

  const { total, done, active } = progressStats(todos);
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, ease: "easeOut" }}
      className="py-0.5"
    >
      {/* Progress header */}
      <div className="flex items-center gap-2 mb-2">
        <div className="flex-1 h-[2px] rounded-full bg-gray-100 dark:bg-surface-selected overflow-hidden">
          <motion.div
            className="h-full rounded-full bg-gray-300 dark:bg-gray-600"
            initial={{ width: 0 }}
            animate={{ width: `${pct}%` }}
            transition={{ duration: 0.5, ease: "easeOut" }}
          />
        </div>
        <span className="text-2xs text-gray-400 dark:text-gray-500 tabular-nums flex-shrink-0">
          {done}/{total}
        </span>
      </div>

      {/* Task list — no boxes, just clean rows */}
      <div className="space-y-1">
        <AnimatePresence initial={false}>
          {todos.map((todo, i) => (
            <motion.div
              key={`${todo.content}-${i}`}
              initial={{ opacity: 0, x: -4 }}
              animate={{ opacity: todo.status === "completed" ? 0.4 : 1, x: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15, delay: i * 0.02 }}
              className="flex items-start gap-2"
            >
              <StatusIcon status={todo.status} />
              <span
                className={`text-sm leading-snug ${
                  todo.status === "completed"
                    ? "line-through text-gray-400 dark:text-gray-600"
                    : todo.status === "in_progress"
                    ? "text-gray-700 dark:text-gray-200 font-medium"
                    : "text-gray-500 dark:text-gray-400"
                }`}
              >
                {todo.status === "in_progress" ? todo.activeForm : todo.content}
              </span>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* Running indicator */}
      {isRunning && active && (
        <div className="flex items-center gap-1 mt-1.5 pl-5">
          <motion.span
            animate={{ opacity: [1, 0.2, 1] }}
            transition={{ duration: 1.1, repeat: Infinity }}
            className="text-2xs text-gray-400 dark:text-gray-500"
          >
            ▌
          </motion.span>
          <span className="text-2xs text-gray-400 dark:text-gray-500">working…</span>
        </div>
      )}
    </motion.div>
  );
}
