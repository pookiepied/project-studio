import { Component, ReactNode } from "react";
import { motion } from "framer-motion";
import {
  Check,
  Copy,
  Error,
  Redo,
} from "@/ui/icons";
import { Button } from "@/ui/primitives/Button";
import { IconButton } from "@/ui/primitives/IconButton";
import { reportError } from "../core/errors/errorReporting";
import { logger } from "@/core/logging/logger";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onReset?: () => void;
}

interface State {
  hasError: boolean;
  error?: Error;
  errorInfo?: string;
  copied: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, copied: false };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    logger.error("ErrorBoundary", "Error caught by boundary", { error, errorInfo });
    reportError(error, { componentStack: errorInfo.componentStack, errorBoundary: true });
    this.setState({ errorInfo: errorInfo.componentStack || undefined });
  }

  handleReset = () => {
    this.setState({ hasError: false, error: undefined, errorInfo: undefined, copied: false });
    this.props.onReset?.();
  };

  handleCopy = () => {
    const { error, errorInfo } = this.state;
    const text = [error?.toString(), errorInfo].filter(Boolean).join("\n\n");
    navigator.clipboard.writeText(text).then(() => {
      this.setState({ copied: true });
      setTimeout(() => this.setState({ copied: false }), 2000);
    }).catch(() => {});
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      const { error, copied } = this.state;

      return (
        <div
          className="min-h-screen flex items-center justify-center bg-surface-page p-6 transition-colors duration-300"
          onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); }}
        >
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
            className="w-full max-w-[300px] flex flex-col items-center text-center gap-5"
          >
            {/* Icon */}
            <motion.div
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ duration: 0.3, delay: 0.06, ease: [0.16, 1, 0.3, 1] }}
              className="w-10 h-10 rounded-2xl bg-gray-100 dark:bg-surface-raised border border-gray-200 dark:border-surface-border flex items-center justify-center"
            >
              <Error size="lg" className="text-gray-400 dark:text-gray-500" />
            </motion.div>

            {/* Text */}
            <div className="space-y-1.5">
              <h1 className="text-base font-semibold text-gray-800 dark:text-gray-200 font-sans tracking-tight">
                Something went wrong
              </h1>
              <p className="text-sm text-gray-400 dark:text-gray-500 leading-relaxed">
                An unexpected error occurred. It's been logged and we'll look into it.
              </p>
            </div>

            {/* Error chip + copy */}
            {error && (
              <div className="w-full flex items-start gap-2 px-3 py-2.5 bg-gray-50 dark:bg-surface-base border border-gray-100 dark:border-surface-border rounded-xl text-left">
                <p className="flex-1 text-xs font-mono text-gray-500 dark:text-gray-500 break-words leading-relaxed">
                  {error.message}
                </p>
                <IconButton
                  onClick={this.handleCopy}
                  aria-label={copied ? "Copied!" : "Copy error details"}
                  className="shrink-0 mt-0.5 h-auto w-auto p-1 rounded-md text-gray-400 dark:text-gray-600 hover:text-gray-600 dark:hover:text-gray-400 hover:bg-gray-200 dark:hover:bg-surface-border"
                >
                  {copied
                    ? <Check size="xs" className="text-gray-500 dark:text-gray-400" />
                    : <Copy size="xs" />
                  }
                </IconButton>
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center gap-3 text-sm">
              <Button
                onClick={this.handleReset}
                variant="ghost"
                className="h-auto gap-1 px-0 py-0 text-gray-500 dark:text-gray-400 hover:bg-transparent hover:text-gray-700 dark:hover:text-gray-200"
              >
                <Redo size="xs" />
                Try again
              </Button>
              <span className="text-gray-200 dark:text-gray-700">·</span>
              <Button
                onClick={() => window.location.reload()}
                variant="ghost"
                className="h-auto gap-2 px-0 py-0 text-gray-400 dark:text-gray-600 hover:bg-transparent hover:text-gray-600 dark:hover:text-gray-400"
              >
                Reload
              </Button>
            </div>
          </motion.div>
        </div>
      );
    }

    return this.props.children;
  }
}
